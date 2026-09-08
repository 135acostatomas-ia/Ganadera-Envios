(function(global){
  'use strict';
  function meters(a,b){
    var lat=(a[1]+b[1])*Math.PI/360;
    return Math.hypot((a[0]-b[0])*111320*Math.cos(lat),(a[1]-b[1])*111320);
  }
  function instruction(step){
    var m=step.maneuver||{},type=m.type,mod=m.modifier||'',text='Continuá';
    if(type==='arrive')return 'Llegás al destino';
    if(type==='roundabout'||type==='rotary')text=m.exit?'En la rotonda, tomá la salida '+m.exit:'Entrá a la rotonda';
    else if(type==='exit roundabout'||type==='exit rotary')text='Salí de la rotonda';
    else if(mod==='uturn')text='Hacé un giro en U';
    else if(type==='merge')text='Incorporate'+(mod.includes('left')?' por la izquierda':mod.includes('right')?' por la derecha':'');
    else if(type==='off ramp')text='Tomá la salida'+(mod.includes('left')?' a la izquierda':mod.includes('right')?' a la derecha':'');
    else if(type==='fork')text='Mantenete'+(mod.includes('left')?' a la izquierda':mod.includes('right')?' a la derecha':' derecho');
    else if(mod.includes('left'))text=mod==='slight left'?'Continuá hacia la izquierda':'Doblá a la izquierda';
    else if(mod.includes('right'))text=mod==='slight right'?'Continuá hacia la derecha':'Doblá a la derecha';
    else if(type==='on ramp')text='Tomá la rampa';
    else text='Seguí derecho';
    return text+(step.name?' por '+step.name:'');
  }
  function routeModel(route){
    var points=[],offsets=[],turns=[],distance=0;
    (route.legs||[]).forEach(function(leg){(leg.steps||[]).forEach(function(step){
      var coords=step.geometry&&step.geometry.coordinates||[];
      coords.forEach(function(p,i){
        if(points.length)distance+=meters(points[points.length-1],p);
        points.push(p);offsets.push(distance);
        if(i===0&&step.maneuver&&step.maneuver.type!=='depart')turns.push({at:distance,step:step});
      });
    });});
    return {points:points,offsets:offsets,turns:turns,progress:0};
  }
  function project(model,p){
    var best={distance:Infinity,along:model.progress};
    for(var i=1;i<model.points.length;i++){
      if(model.offsets[i]<model.progress-35||model.offsets[i-1]>model.progress+350)continue;
      var a=model.points[i-1],b=model.points[i],scale=111320*Math.cos(p[1]*Math.PI/180);
      var ax=(a[0]-p[0])*scale,ay=(a[1]-p[1])*111320,bx=(b[0]-p[0])*scale,by=(b[1]-p[1])*111320;
      var dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;
      var d=Math.hypot(ax+t*dx,ay+t*dy);
      if(d<best.distance)best={distance:d,along:model.offsets[i-1]+t*(model.offsets[i]-model.offsets[i-1])};
    }
    return best;
  }
  function distanceText(value){return value>=1000?(value/1000).toFixed(1)+' km':Math.max(0,Math.round(value/10)*10)+' m';}

  function create(map,options){
    var active=false,sharing=false,confirmed=false,offered=false,following=true,voice=false;
    var position=null,model=null,line=null,lastFetch=0,request=null,generation=0,timer=null,lastSpoken='',routeFailed=false;
    var el=function(id){return document.getElementById(id);};
    var manual=document.createElement('button');manual.type='button';manual.className='primary gps-manual';manual.textContent='Iniciar navegación';manual.hidden=true;
    el('btn-toggle').parentNode.appendChild(manual);
    var dialog=document.createElement('div');dialog.className='gps-prompt';dialog.hidden=true;
    dialog.innerHTML='<div class="gps-prompt-card" role="dialog" aria-modal="true" aria-labelledby="gps-question"><h2 id="gps-question">¿Iniciar navegación?</h2><p>Tu ubicación ya se está compartiendo con el cliente. ¿Querés abrir el GPS hacia esta entrega?</p><button type="button" class="primary" data-gps-start>Iniciar navegación</button><button type="button" class="gps-later" data-gps-later>Ahora no</button></div>';
    document.body.appendChild(dialog);
    var previousFocus=null;
    function closePrompt(){dialog.hidden=true;if(previousFocus&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});}
    dialog.querySelector('[data-gps-start]').addEventListener('click',function(){closePrompt();start();});
    dialog.querySelector('[data-gps-later]').addEventListener('click',closePrompt);
    dialog.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePrompt();}
      if(event.key==='Tab'){var first=dialog.querySelector('[data-gps-start]'),last=dialog.querySelector('[data-gps-later]');if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    });
    var panel,turn,detail,notice,voiceButton,centerButton;
    var control=L.control({position:'bottomleft'});
    control.onAdd=function(){
      panel=L.DomUtil.create('div','gps-panel');panel.hidden=true;
      panel.innerHTML='<div class="gps-mode">Navegación · Norte arriba</div><strong class="gps-turn"></strong><div class="gps-detail"></div><div class="gps-notice" role="status"></div><div class="gps-buttons"><button type="button" data-gps-center>Mi ubicación</button><button type="button" data-gps-voice aria-pressed="false">Activar voz</button><button type="button" data-gps-stop>Finalizar GPS</button></div>';
      turn=panel.querySelector('.gps-turn');detail=panel.querySelector('.gps-detail');notice=panel.querySelector('.gps-notice');voiceButton=panel.querySelector('[data-gps-voice]');centerButton=panel.querySelector('[data-gps-center]');
      L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
      centerButton.addEventListener('click',function(){following=true;follow();});
      panel.querySelector('[data-gps-stop]').addEventListener('click',function(){stop();if(options.collapse)options.collapse();});
      voiceButton.disabled=!('speechSynthesis' in global&&'SpeechSynthesisUtterance' in global);
      if(voiceButton.disabled)voiceButton.textContent='Voz no disponible';
      voiceButton.addEventListener('click',function(){voice=!voice;voiceButton.textContent=voice?'Silenciar':'Activar voz';voiceButton.setAttribute('aria-pressed',String(voice));cancelSpeech();lastSpoken='';render();});
      return panel;
    };control.addTo(map);
    map.on('dragstart',function(){if(active){following=false;centerButton.textContent='Volver a seguirme';}});
    function cancelSpeech(){if(global.speechSynthesis)global.speechSynthesis.cancel();}
    function say(text,key){if(!voice||key===lastSpoken||document.hidden)return;lastSpoken=key;cancelSpeech();var speech=new global.SpeechSynthesisUtterance(text);speech.lang='es-AR';speech.rate=1;global.speechSynthesis.speak(speech);}
    function usable(){return position&&Date.now()-position.updatedAt<20000&&position.accuracy<=60;}
    function follow(){if(!active||!following||!usable())return;map.panTo([position.lat,position.lng],{animate:false});centerButton.textContent='Mi ubicación';}
    function prompt(){
      if(!sharing||!confirmed||!options.destination()||offered)return;
      offered=true;previousFocus=document.activeElement;dialog.hidden=false;dialog.querySelector('[data-gps-start]').focus();
    }
    function start(){
      if(!sharing||!confirmed||!position||!options.destination())return;
      active=true;following=true;panel.hidden=false;manual.hidden=true;
      if(options.expand)options.expand();map.setView([position.lat,position.lng],17,{animate:false});
      lastFetch=0;render();fetchRoute();if(timer)clearInterval(timer);timer=setInterval(render,2000);
    }
    function stop(){active=false;panel.hidden=true;manual.hidden=!confirmed||!sharing;cancelSpeech();if(timer)clearInterval(timer);timer=null;}
    function clearRoute(){generation++;if(request)request.abort();request=null;model=null;lastFetch=0;routeFailed=false;lastSpoken='';if(line){map.removeLayer(line);line=null;}cancelSpeech();}
    function render(){
      if(!active)return;
      if(!usable()){turn.textContent='Esperando señal GPS precisa';detail.textContent='Las indicaciones se reanudan al recuperar la señal.';notice.textContent=position&&position.accuracy>60?'Precisión aproximada: '+Math.round(position.accuracy)+' m':'Ubicación sin actualizar';cancelSpeech();return;}
      var dest=options.destination();if(!dest){turn.textContent='Destino no disponible';detail.textContent='Coordinación debe cargar una dirección.';notice.textContent='';cancelSpeech();return;}
      if(!model||routeFailed){turn.textContent=routeFailed?'No se pudo calcular el recorrido':'Calculando recorrido…';detail.textContent=routeFailed?'Se volverá a intentar con la próxima ubicación.':'';notice.textContent='La navegación necesita conexión a internet.';cancelSpeech();return;}
      var projection=project(model,[position.lng,position.lat]);
      if(projection.distance>Math.max(45,position.accuracy*1.5)){
        turn.textContent='Recalculando recorrido…';detail.textContent='Buscando el camino desde tu ubicación.';notice.textContent='';cancelSpeech();fetchRoute();return;
      }
      model.progress=Math.max(model.progress,projection.along);
      var next=model.turns.find(function(t){return t.at>=model.progress-8;});
      if(!next){turn.textContent='Estás cerca del destino';detail.textContent='Verificá la dirección y finalizá el GPS para registrar la entrega.';notice.textContent='La entrega requiere ubicación y firma.';cancelSpeech();return;}
      var remaining=Math.max(0,next.at-model.progress),text=instruction(next.step);
      if(next.step.maneuver.type==='arrive'&&remaining<25){turn.textContent='Estás cerca del destino';detail.textContent=dest.direccion||'Verificá la dirección antes de entregar.';notice.textContent='Finalizá el GPS para registrar la firma y la entrega.';say('Estás cerca del destino','arrive');return;}
      turn.textContent=(remaining<20?'Ahora: ':'En '+distanceText(remaining)+': ')+text;
      detail.textContent=el('rep-dist').textContent+' · '+el('rep-eta').textContent+' estimados';notice.textContent=following?'Siguiendo tu ubicación':'Mapa libre · Tocá «Volver a seguirme»';
      var key=JSON.stringify(next.step.maneuver.location)+text+(remaining<40?':near':':ahead');
      if(remaining<=300)say((remaining<20?'Ahora, ':'En '+Math.round(remaining/10)*10+' metros, ')+text,key);
    }
    async function fetchRoute(){
      var dest=options.destination();if(!sharing||!position||!dest||!usable()||request||Date.now()-lastFetch<8000)return;
      var token=generation,controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},12000);request=controller;lastFetch=Date.now();
      var from={lat:position.lat,lng:position.lng},destinationKey=dest.lat+','+dest.lng;
      try{
        var url='https://router.project-osrm.org/route/v1/driving/'+from.lng+','+from.lat+';'+dest.lng+','+dest.lat+'?overview=full&geometries=geojson&steps=true';
        var response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);
        var data=await response.json();if(data.code!=='Ok'||!data.routes||!data.routes.length)throw new Error('NoRoute');
        var current=options.destination();if(token!==generation||!sharing||!current||destinationKey!==current.lat+','+current.lng)return;
        var route=data.routes[0],nextModel=routeModel(route);if(!nextModel.points.length||!nextModel.turns.length)throw new Error('MissingSteps');
        model=nextModel;routeFailed=false;
        el('rep-dist').textContent=(route.distance/1000).toFixed(1)+' km';el('rep-eta').textContent=Math.max(1,Math.round(route.duration/60))+' min';
        if(line)map.removeLayer(line);line=L.polyline(route.geometry.coordinates.map(function(p){return [p[1],p[0]];}),{color:'#1F6ED4',weight:6,opacity:.9}).addTo(map);
        render();
      }catch(error){if(token===generation&&sharing){routeFailed=true;el('rep-dist').textContent='—';el('rep-eta').textContent='—';render();console.warn('[driver-navigation] route unavailable',error.name);}}
      finally{clearTimeout(timeout);if(request===controller)request=null;}
    }
    manual.addEventListener('click',start);
    document.addEventListener('visibilitychange',function(){if(document.hidden)cancelSpeech();else if(active){render();fetchRoute();}});
    return {
      sharingStarted:function(){sharing=true;confirmed=false;offered=false;position=null;clearRoute();},
      sharingStopped:function(){var wasActive=active;sharing=false;confirmed=false;stop();closePrompt();clearRoute();position=null;if(wasActive&&options.collapse)options.collapse();},
      position:function(value){position=value;if(active)follow();else map.panTo([value.lat,value.lng]);render();fetchRoute();},
      confirmed:function(){if(!sharing)return;confirmed=true;manual.hidden=active;prompt();},
      destinationChanged:function(){clearRoute();prompt();render();fetchRoute();},
      gpsError:function(){if(position)position.updatedAt=0;render();},
      stop:stop
    };
  }
  global.GanaderaNavigation={create:create,meters:meters,instruction:instruction,routeModel:routeModel,project:project};
})(window);
