const foot=[['attack','Atirar',1],['target','Mirar',5],['enter','Entrar',3],['jump','Pular',2],['run','Correr',0],['use','Usar / fone',4],['previous','Arma −',6],['next','Arma +',7],['duck','Agachar',10]];
const vehicle=[['accelerate','Acelerar',0],['brake','Frear / ré',2],['enter','Sair',3],['handbrake','Freio mão',5],['horn','Buzina',10],['attack','Atirar',1],['previous','Olhar ←',6],['next','Olhar →',7],['use','Rádio',4]];
const menu=[['up','↑',12],['confirm','OK',0],['back','Voltar',3],['left','←',14],['down','↓',13],['right','→',15]];
const icons={
  attack:'<path d="m5 19 10-14 5-3-1 6L9 22Z"/><path d="m6 17 5 4M13 8l4 3" fill="none"/>',
  target:'<path d="M3 10a9 9 0 0 1 7-7v3a6 6 0 0 0-4 4Zm11-7a9 9 0 0 1 7 7h-3a6 6 0 0 0-4-4ZM21 14a9 9 0 0 1-7 7v-3a6 6 0 0 0 4-4ZM10 21a9 9 0 0 1-7-7h3a6 6 0 0 0 4 4Z"/><circle cx="12" cy="12" r="2"/>',
  enter:'<path d="m3 13 3-5h9l4 5h2v6H3Zm4 0h8l-2-3H8Z" fill-rule="evenodd"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="18" r="2.5"/>',
  jump:'<path d="m3 9 4 2 3-4 4 5 6 2q2 1 2 4v2H2v-5Z"/><path d="m10 11 3 2m-5 0 3 2M3 17h18" fill="none"/>',
  run:'<circle cx="15" cy="4" r="2"/><path d="m5 8 5-2 5 6 5 1M12 9l-3 6-5 4m5-4 5 2 1 5"/>',
  use:'<path d="M6 3 3 6c1 8 7 14 15 15l3-3-5-4-3 3-6-6 3-3Z"/>',
  previous:'<path d="m13 4-10 8 10 8v-5h8V9h-8Z"/>',
  next:'<path d="m11 4 10 8-10 8v-5H3V9h8Z"/>',
  duck:'<circle cx="14" cy="4" r="2.5"/><path d="m9 7 4-1 3 6 5 2-1 3-7-3-2-3-3 4 9 2-3 6h-4l2-4-9-1v-4Z"/>',
  accelerate:'<rect x="7" y="2" width="11" height="20" rx="2"/><path d="M10 5v14m4-14v14" fill="none"/>',
  brake:'<rect x="2" y="7" width="20" height="12" rx="2"/><path d="M5 10h14M5 14h14" fill="none"/>',
  handbrake:'<path d="m6 3 10-1 4 13-10 3Z"/><path d="m9 5 6-1 2 5-6 2Zm3 10 5-1" fill="none"/><path d="m6 14-3 4 4-1-3 5m15-5-2 3 4-1-2 4" fill="none"/>',
  horn:'<path d="M3 9h7l6-5v16l-6-5H3Z"/><path d="M19 8q4 4 0 8" fill="none"/>',
  radio:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="m6 7 11-5M6 11h12m-2 5h2"/><circle cx="8" cy="16" r="2"/>',
  camera:'<rect x="3" y="6" width="18" height="15" rx="3"/><circle cx="12" cy="13" r="4"/><path d="m7 6 2-3h6l2 3"/>',
  special:'<path d="m8 3-7 7 7 7v-4h6a4 4 0 0 1 0 8h3a7 7 0 0 0 0-14H8Z"/>',
  pause:'<path d="M5 4h5v16H5Zm9 0h5v16h-5Z"/>',
  fullscreen:'<path d="M2 2h7v3H5v4H2Zm13 0h7v7h-3V5h-4ZM2 15h3v4h4v3H2Zm17 0h3v7h-7v-3h4Z"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
function icon(name){
  if(name==='camera')return '<img src="/play/touch-assets/camera.png" alt="" draggable="false">';
  if(name==='run'||name==='use')return `<span class="touch-native-icon touch-native-${name}" aria-hidden="true"></span>`;
  const glyph=`<svg viewBox="0 0 24 24" fill="url(#touch-color-${name})" stroke="#151923" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><defs><linearGradient id="touch-color-${name}" x2="0" y2="1"><stop stop-color="#46c5ef"/><stop offset=".52" stop-color="#8da6e9"/><stop offset="1" stop-color="#ec9fd6"/></linearGradient></defs>${icons[name]}</svg>`;
  if(name==='attack')return `<img class="touch-fist" src="/play/touch-assets/fist.png" alt="" draggable="false">${glyph}`;
  return name==='target'?`${glyph}<img class="touch-aim-weapon" src="/play/touch-assets/gun.png" alt="" draggable="false">`:glyph;
}

export function mountTouchControls({canvas,state}){
  const root=document.createElement('section');
  root.id='touch-controls';root.hidden=true;root.setAttribute('aria-label','Controles de toque');
  root.innerHTML=`<div class="touch-toolbar"><button type="button" data-touch="camera" data-button="8" aria-label="Mudar câmera">${icon('camera')}</button><button type="button" data-touch="special" data-button="11" aria-label="Olhar para trás ou missão do veículo">${icon('special')}</button><button type="button" data-touch="pause" data-button="9" aria-label="Pausar ou continuar">${icon('pause')}</button><button type="button" data-touch="fullscreen" aria-label="Tela cheia">${icon('fullscreen')}</button></div><div class="touch-look" data-touch="look" aria-label="Arraste para olhar"><span>Arraste para olhar</span></div><div class="touch-stick" data-touch="move" aria-label="Analógico de movimento"><span></span></div><div id="touch-actions" class="touch-actions"></div><button type="button" class="touch-more" data-touch="more" aria-label="Mais ações" aria-controls="touch-actions" aria-expanded="false">${icon('more')}</button><p class="touch-rotate">Melhor em paisagem · gire o celular</p>`;
  for(const button of root.querySelectorAll('button'))button.title=button.getAttribute('aria-label');
  document.body.append(root);
  root.querySelector('[data-touch=fullscreen]').hidden=!document.fullscreenEnabled;
  const physicalPads=navigator.getGamepads?.bind(navigator);
  const pad={id:'Xbox 360 Controller (Vice City Touch)',index:0,mapping:'standard',connected:true,timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0,pressed:false,touched:false}))};
  const axes=[0,0,0,0],pointers=new Map(),pulses=new Map();
  let mode='',active=false;
  function physical(){try{return Array.from(physicalPads?.()??[]).find(item=>item?.connected&&item.mapping==='standard');}catch{return undefined;}}
  // SDL sees one stable logical controller; Bluetooth hotplug must not replace its handle mid-gesture.
  const hardwareEvent=event=>event.stopImmediatePropagation();
  addEventListener('gamepadconnected',hardwareEvent,true);addEventListener('gamepaddisconnected',hardwareEvent,true);
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'getGamepads');
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{
    const hardware=physical(),held=new Set([...pointers.values()].filter(item=>item.button!==undefined).map(item=>item.button));
    for(const [button,until] of pulses){if(performance.now()<until)held.add(button);else pulses.delete(button);}
    const focused=!document.hidden&&document.hasFocus();
    for(let index=0;index<4;index++){
      const touch=active&&focused?axes[index]:0,real=focused?(hardware?.axes[index]??0):0;
      pad.axes[index]=Math.abs(touch)>=Math.abs(real)?touch:real;
    }
    for(let index=0;index<17;index++){
      const value=Math.max(active&&focused&&held.has(index)?1:0,focused?(hardware?.buttons[index]?.value??0):0);
      Object.assign(pad.buttons[index],{value,pressed:value>.5,touched:value>0});
    }
    pad.timestamp=performance.now();return [pad];
  }});
  const stick=root.querySelector('.touch-stick'),knob=stick.querySelector('span'),actions=root.querySelector('.touch-actions');
  const more=root.querySelector('[data-touch=more]');
  function expand(){
    const expanded=root.toggleAttribute('data-expanded');more.setAttribute('aria-expanded',String(expanded));
    more.setAttribute('aria-label',expanded?'Fechar outras ações':'Mais ações');
    if(!expanded)for(const [id,entry] of pointers)if(Number(entry.target.dataset.slot)>=5){pointers.delete(id);pulses.delete(entry.button);delete entry.target.dataset.held;}
  }
  more.addEventListener('click',event=>{if(event.detail===0)expand();});
  function clear(){
    pointers.clear();pulses.clear();axes.fill(0);knob.style.translate='0 0';
    for(const button of root.querySelectorAll('[data-held]'))delete button.dataset.held;
  }
  function render(next){
    clear();mode=next;root.dataset.mode=next;root.removeAttribute('data-expanded');more.setAttribute('aria-expanded','false');more.setAttribute('aria-label','Mais ações');
    const buttons=next==='menu'?menu:next==='scene'?[['confirm','Pular cena',0]]:next==='vehicle'?vehicle:foot;
    actions.replaceChildren(...buttons.map(([name,label,index])=>{
      const button=document.createElement('button');button.type='button';button.dataset.touch=name;button.dataset.button=index;
      button.setAttribute('aria-label',name==='attack'?'Atirar ou atacar':name==='confirm'&&next==='menu'?'Confirmar':label);button.title=button.getAttribute('aria-label');
      if(next==='menu'||next==='scene')button.textContent=label;
      else{
        button.innerHTML=icon(next==='vehicle'&&name==='use'?'radio':name);
        button.dataset.slot=String((next==='vehicle'?[0,2,1,3,8,4,5,6,7]:[0,4,3,2,1,7,5,6,8])[buttons.findIndex(item=>item[0]===name)]);
      }
      return button;
    }));
  }
  function position(event,entry){
    const dx=event.clientX-entry.x,dy=event.clientY-entry.y,scale=Math.max(1,Math.hypot(dx,dy)/entry.radius);
    const x=dx/entry.radius/scale,y=dy/entry.radius/scale;
    axes[entry.axis]=x;axes[entry.axis+1]=y;
    if(entry.axis===0)knob.style.translate=`${x*entry.radius}px ${y*entry.radius}px`;
  }
  root.addEventListener('pointerdown',event=>{
    if(!active||event.pointerType==='mouse'&&event.button!==0)return;
    const target=event.target.closest('[data-touch]');if(!target)return;
    event.preventDefault();canvas.focus({preventScroll:true});
    if(target===more){expand();return;}
    if(target.dataset.touch==='fullscreen'){
      if(document.fullscreenElement)void document.exitFullscreen?.().catch(()=>{});
      else void document.documentElement.requestFullscreen?.().catch(()=>{});
      return;
    }
    if(target.dataset.button!==undefined){
      pointers.set(event.pointerId,{button:Number(target.dataset.button),started:performance.now(),target});target.dataset.held='true';
    }else{
      const axis=target===stick?0:2;if([...pointers.values()].some(item=>item.axis===axis))return;
      const rect=target.getBoundingClientRect(),radius=axis===0?rect.width*.3:Math.min(70,root.clientHeight*.18);
      const entry={axis,radius,x:axis===0?rect.x+rect.width/2:event.clientX,y:axis===0?rect.y+rect.height/2:event.clientY,target};
      pointers.set(event.pointerId,entry);position(event,entry);
    }
    target.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove',event=>{
    const entry=pointers.get(event.pointerId);if(!entry)return;event.preventDefault();
    if(entry.axis!==undefined){position(event,entry);if(entry.axis===2)root.dataset.looked='true';}
  });
  function release(event){
    const entry=pointers.get(event.pointerId);if(!entry)return;event.preventDefault();pointers.delete(event.pointerId);
    // A short tap can finish between two SDL polls; retain only its remaining 100ms pulse.
    if(entry.button!==undefined&&event.type==='pointerup'&&entry.started+100>performance.now())pulses.set(entry.button,Math.max(pulses.get(entry.button)??0,entry.started+100));
    if(entry.axis!==undefined){axes[entry.axis]=axes[entry.axis+1]=0;if(entry.axis===0)knob.style.translate='0 0';}
    if(![...pointers.values()].some(item=>item.target===entry.target))delete entry.target.dataset.held;
  }
  for(const name of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(name,release);
  root.addEventListener('contextmenu',event=>event.preventDefault());
  root.addEventListener('touchstart',event=>event.preventDefault(),{passive:false});
  root.addEventListener('touchmove',event=>event.preventDefault(),{passive:false});
  function refresh(){
    const current=state();
    root.toggleAttribute('data-armed',current.weaponType>=17);
    const visible=current.phase==='running'&&(current.state===7||current.state===9)&&!document.hidden;
    if(!visible){clear();active=false;root.hidden=true;return;}
    const next=current.menu||current.state===7?'menu':current.blocked?'scene':current.inVehicle?'vehicle':'foot';
    if(next!==mode)render(next);
    active=true;root.hidden=false;
  }
  const viewport=window.visualViewport;
  function layout(){
    clear();
    const width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
    Object.assign(root.style,{left:(viewport?.offsetLeft??0)+'px',top:(viewport?.offsetTop??0)+'px',width:width+'px',height:height+'px'});
    if(height>=width)root.dataset.portrait='';else delete root.dataset.portrait;
    document.body.toggleAttribute('data-touch-portrait',height>=width);
    const top=Math.max(76,(height-width*9/16-270)/2+60);
    root.style.setProperty('--touch-frame-top',top+'px');
    root.style.setProperty('--touch-frame-height',width*9/16+'px');
    document.body.style.setProperty('--touch-frame-top',((viewport?.offsetTop??0)+top)+'px');
  }
  layout();
  addEventListener('blur',clear);addEventListener('pagehide',clear);addEventListener('resize',layout);
  viewport?.addEventListener('resize',layout);viewport?.addEventListener('scroll',layout);
  const visibility=()=>{clear();refresh();};
  document.addEventListener('visibilitychange',visibility);
  const timer=setInterval(refresh,100);refresh();
  return {dispose(){
    clear();clearInterval(timer);root.remove();document.body.removeAttribute('data-touch-portrait');document.body.style.removeProperty('--touch-frame-top');
    removeEventListener('blur',clear);removeEventListener('pagehide',clear);removeEventListener('resize',layout);
    viewport?.removeEventListener('resize',layout);viewport?.removeEventListener('scroll',layout);
    document.removeEventListener('visibilitychange',visibility);
    removeEventListener('gamepadconnected',hardwareEvent,true);removeEventListener('gamepaddisconnected',hardwareEvent,true);
    if(descriptor)Object.defineProperty(navigator,'getGamepads',descriptor);else delete navigator.getGamepads;
  }};
}
