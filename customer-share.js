(function(global){
  'use strict';
  var modal,previousFocus,revision=0;
  function build(){
    modal=document.createElement('div');modal.className='customer-share-modal';modal.hidden=true;
    modal.innerHTML='<section class="customer-share-card" role="dialog" aria-modal="true" aria-labelledby="customer-share-title"><h2 id="customer-share-title">Compartir seguimiento</h2><p>Elegí dónde compartir el enlace del cliente.</p><div class="customer-share-options"><a class="customer-share-whatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="customer-share-respond" href="https://app.respond.io/" target="_blank" rel="noopener noreferrer">Respond</a><button type="button" class="customer-share-other">Otras aplicaciones</button></div><p class="customer-share-help">Respond: copiamos el mensaje y abrimos la app o la web. Elegí la conversación y pegalo.</p><label for="customer-share-text">Mensaje para compartir</label><textarea id="customer-share-text" readonly></textarea><div class="customer-share-status" role="status" aria-live="polite"></div><a class="customer-share-open" href="https://app.respond.io/" target="_blank" rel="noopener noreferrer" hidden>Abrir Respond</a><button type="button" class="customer-share-close">Cerrar</button></section>';
    document.body.appendChild(modal);
    modal.querySelector('.customer-share-close').addEventListener('click',close);
    modal.addEventListener('click',function(e){if(e.target===modal)close();});
    modal.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){
        var nodes=Array.from(modal.querySelectorAll('a[href],button,textarea')).filter(function(n){return !n.hidden&&!n.disabled;});
        var first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
  }
  function close(){revision++;modal.hidden=true;document.body.classList.remove('customer-share-opened');if(previousFocus&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});}
  function show(title,url){
    if(!modal)build();revision++;var current=revision,text=title+'\n'+url;
    previousFocus=document.activeElement;modal.hidden=false;document.body.classList.add('customer-share-opened');
    var status=modal.querySelector('.customer-share-status'),area=modal.querySelector('textarea'),respond=modal.querySelector('.customer-share-respond'),open=modal.querySelector('.customer-share-open');
    status.textContent='';area.value=text;open.hidden=true;
    var whatsapp=modal.querySelector('.customer-share-whatsapp');whatsapp.href='https://wa.me/?text='+encodeURIComponent(text);
    respond.onclick=function(event){
      // Synchronous copying keeps the original link tap available to iOS/Android App Links.
      area.focus();area.select();area.setSelectionRange(0,area.value.length);
      var copied=false;try{copied=document.execCommand&&document.execCommand('copy');}catch(error){}
      if(copied){status.textContent='Mensaje copiado. Pegalo en la conversación de Respond.';open.hidden=false;respond.focus({preventScroll:true});return;}
      // Never switch apps with an unconfirmed clipboard operation.
      event.preventDefault();
      if(navigator.clipboard&&navigator.clipboard.writeText){
        status.textContent='Copiando mensaje…';
        navigator.clipboard.writeText(text).then(function(){
          if(current!==revision)return;status.textContent='Mensaje copiado. Tocá «Abrir Respond» y pegalo en la conversación.';open.hidden=false;open.focus();
        }).catch(function(){if(current===revision)manualCopy();});
      }else manualCopy();
      function manualCopy(){status.textContent='No se pudo copiar automáticamente. Copiá el texto seleccionado y después tocá «Abrir Respond».';open.hidden=false;area.focus();area.select();area.setSelectionRange(0,area.value.length);}
    };
    var other=modal.querySelector('.customer-share-other');other.hidden=!navigator.share;
    other.onclick=async function(){
      try{await navigator.share({title:title,text:title,url:url});}
      catch(error){if(current===revision&&error.name!=='AbortError')status.textContent='No se pudo abrir el menú. Elegí WhatsApp o Respond, o copiá el mensaje.';}
    };
    whatsapp.focus();
  }
  global.GanaderaCustomerShare={show:show};
})(window);
