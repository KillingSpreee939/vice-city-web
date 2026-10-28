import createReVC from '/assets/classic/engine/reVC.js';
import {createViewerInspector} from './viewer-inspector.js';
import {createNativeComparison} from './native-comparison.js';
import {createNativeRecipes} from './native-recipes.js';
import {inspectionNames} from './model-resource.js';
import {createRadioDemand,prepareRadioContinuation} from './radio-demand.js';
import {ArchiveStreamer} from '/assets/classic/runtime/streaming.js';

const canvas = document.querySelector('#canvas');
const gate = document.querySelector('#gate');
const status = document.querySelector('#status');
const play = document.querySelector('#play');
const retry = document.querySelector('#retry');
const loading = document.querySelector('#loading');
const fps = document.querySelector('#fps');
const viewer = document.body.dataset.viewer === 'true';
const inspectionQuery = new URL(location.href).searchParams;
const specialName = inspectionQuery.get('special');
const wardrobeName = inspectionQuery.get('roupa');
const inspectionName = specialName ?? wardrobeName;
let namedInspections=[];
const portMenuTextKeys = ["FEC_FRC","FED_AAS","FED_CLF","FED_FLS","FED_MBL","FED_WND","FEM_2PR","FEM_AUT","FEM_CAR","FEM_CSB","FEM_HIG","FEM_ISL","FEM_LOW","FEM_MED","FEM_MOB","FEM_NON","FEM_NRM","FEM_PED","FEM_SCF","FEM_SIM","FESZ_RM","FET_GFX"];
function fitCanvas() {
  const stage = viewer && document.querySelector('#stage');
  const viewport = !viewer && window.visualViewport;
  const width = stage ? stage.clientWidth : (viewport?.width ?? innerWidth) - (viewer && innerWidth > 800 ? 340 : 0);
  const height = stage ? stage.clientHeight : (viewport?.height ?? innerHeight) - (viewer && innerWidth <= 800 ? 250 : 0);
  const scale = Math.min(width/canvas.width,height/canvas.height);
  const fittedWidth = stage ? Math.floor(canvas.width*scale) : canvas.width*scale;
  const fittedHeight = stage ? Math.floor(canvas.height*scale) : canvas.height*scale;
  canvas.style.width = fittedWidth+'px';
  canvas.style.height = fittedHeight+'px';
  if (stage) {
    // Bordas em subpixel misturam o fundo da página à imagem nativa.
    canvas.style.transform = 'none';
    canvas.style.left = Math.floor((width-fittedWidth)/2)+'px';
    canvas.style.top = Math.floor((height-fittedHeight)/2)+'px';
  } else if (!viewer) {canvas.style.left = ((viewport?.offsetLeft ?? 0)+width/2)+'px';canvas.style.top = ((viewport?.offsetTop ?? 0)+height/2)+'px';}
}
addEventListener('resize',fitCanvas);
if (!viewer) {window.visualViewport?.addEventListener('resize',fitCanvas);window.visualViewport?.addEventListener('scroll',fitCanvas);}
new MutationObserver(fitCanvas).observe(canvas,{attributes:true,attributeFilter:['width','height']});
if (viewer && document.querySelector('#stage')) new ResizeObserver(fitCanvas).observe(document.querySelector('#stage'));
fitCanvas();
const logs = [], errors = [];
function log(line) {logs.push(String(line));if (logs.length > 200) logs.shift();}
let native, phase = 'ready', loaded = 0, count = 0, started = false, touchControls;
let fpsSample;
function resetFps() {
  fpsSample = undefined;
  if (!fps) return;
  fps.hidden = true;fps.textContent = 'FPS —';
  delete fps.dataset.frames;delete fps.dataset.elapsedMs;
}
function updateFps() {
  if (!fps) return;
  if (phase !== 'running' || document.hidden || native._ViceGameState() !== 9) {resetFps();return;}
  fps.hidden = false;
  const sample = {time:performance.now(),frames:native._VicePresentedFrames()>>>0};
  if (fpsSample && sample.time-fpsSample.time >= 1000) {
    const frames = (sample.frames-fpsSample.frames)>>>0,elapsed = sample.time-fpsSample.time;
    fps.textContent = 'FPS '+Math.round(frames*1000/elapsed);
    fps.dataset.frames = String(frames);fps.dataset.elapsedMs = String(elapsed);
    fpsSample = sample;
  } else if (!fpsSample) fpsSample = sample;
}
if (fps) {
  setInterval(updateFps,250);
  document.addEventListener('visibilitychange',resetFps);
}
function nativeInteger(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}
function readModels(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Model IDs must be an array.');
  for (const id of ids) if (!nativeInteger(id)) throw new TypeError('Model IDs must fit signed 32-bit integers.');
  if (!native) return [];
  return ids.map(id => ({id,name:native.ccall('ViceModelName','string',['number'],[id])||null,
    type:native._ViceModelType(id),textureDictionary:native.ccall('ViceModelTxdName','string',['number'],[id])||null,
    atomicCount:native._ViceModelAtomicCount(id)}));
}
function readSurface(id) {
  if (!nativeInteger(id)) throw new TypeError('Model ID must fit signed 32-bit integers.');
  if (!native) return null;
  const lods=[];
  for(let lod=0;lod<Math.min(native._ViceModelAtomicCount(id),3);lod++) {
    const count=native._ViceModelMaterialCount(id,lod);
    const materials=[];
    for(let slot=0;slot<count;slot++) {
      const color=native._ViceModelMaterialValue(id,lod,slot,0)>>>0;
      const name=native.ccall('ViceModelMaterialTexture','string',['number','number','number'],[id,lod,slot])||null;
      materials.push({slot,color:[color&255,(color>>>8)&255,(color>>>16)&255,color>>>24],
        meshIndices:native._ViceModelMaterialValue(id,lod,slot,4),
        texture:native._ViceModelMaterialValue(id,lod,slot,1)?{name,
          width:native._ViceModelMaterialValue(id,lod,slot,2),height:native._ViceModelMaterialValue(id,lod,slot,3)}:null});
    }
    lods.push({lod,present:count>=0,vertices:native._ViceModelAtomicVertices(id,lod),
      triangles:native._ViceModelAtomicTriangles(id,lod),materials});
  }
  return {id,cdPosition:native._ViceModelCdPosition(id),cdSectors:native._ViceModelCdSectors(id),lods};
}
function readVehicle(handle) {
  if(!nativeInteger(handle))throw new TypeError('Vehicle handle must fit a signed 32-bit integer.');
  if(handle<0)throw new RangeError('Vehicle handle must not be negative.');
  if(!native?._ViceVehicleValue(handle,0))return null;
  const value=field=>native._ViceVehicleValue(handle,field);
  return {handle,model:value(1),type:value(2),status:value(3),position:[4,5,6].map(value),
    forward:[7,8,9].map(value),right:[10,11,12].map(value),up:[13,14,15].map(value),
    velocity:[16,17,18].map(value),turnSpeed:[19,20,21].map(value),
    driverIsPlayer:!!value(22),playerIsDriving:!!value(23),
    inputs:{handbrake:!!value(24),steerInput:value(25),steerAngle:value(26),gas:value(27),brake:value(28)},
    health:value(29),playerPedState:value(30),playerInVehicle:!!value(31)};
}
function failed(error) {
  const text = error?.message ?? String(error);
  errors.push(text);phase = 'failed';
  touchControls?.dispose();
  resetFps();
  gate.hidden = false;play.hidden = true;retry.hidden = false;loading.hidden = true;
  status.textContent = 'Não foi possível abrir o jogo. Recarregue para tentar novamente.';
}
function warmInitialCutscenesAndAudio(streamer) {
  if (viewer) return;
  // 1. Pre-warm ALL intro cutscene audio tracks (Marco's Bistro, Airport, Dock Deal, Hotel Escape)
  for (const name of ['int_m.mp3', 'int_a.mp3', 'int_d.mp3', 'int_b.mp3']) {
    const entry = streamer.byName.get(name);
    if (entry) {
      const total = Math.ceil(entry.size / (256 * 1024));
      streamer.warmRange(entry, 0, total - 1, 4);
    }
  }
  // 2. Pre-warm entire intro cutscene sequence in anim/cuts.img (chunks 246 to 285)
  const cuts = streamer.byName.get('cuts.img');
  if (cuts) {
    streamer.warmRange(cuts, 246, 285, 4);
  }
  // 3. Pre-warm ALL cutscene character & vehicle models from models/gta3.img (chunks 0 to 290)
  const gta3 = streamer.byName.get('gta3.img');
  if (gta3) {
    streamer.warmRange(gta3, 0, 290, 4);
  }
}

function warmSecondaryAssets(streamer) {
  if (viewer) return;
  const gta3 = streamer.byName.get('gta3.img');
  if (gta3) {
    streamer.warmRange(gta3, 291, 450, 4);
  }
}

retry.onclick = () => location.reload();
const streamer = new ArchiveStreamer(message => {failed(message);throw new Error(message);}, failed);
window.viceStreamer = streamer;
window.viceClassic = {viewer:{
  inspect:createViewerInspector(()=>native),
  comparison:createNativeComparison(()=>native),
  recipes:createNativeRecipes(()=>native),
  select(id) {
    if (!nativeInteger(id)) throw new TypeError('Model ID must fit signed 32-bit integers.');
    return !!native?._ViceViewerSelectModel(id);
  },
  target:()=>native?._ViceViewerTarget()??-1,
  variant(index) {
    if(!nativeInteger(index))throw new TypeError('Viewer variant must fit signed 32-bit integers.');
    if(index!==0&&index!==1)throw new RangeError('Viewer variant must be intact0 or damaged1.');
    return !!native?._ViceViewerSetVariant(index);
  },
  damageState() {
    const id=native?._ViceViewerDamageValue(0)??-2;
    if(id<0)return null;
    const value=field=>native._ViceViewerDamageValue(field);
    const sourceObjectId=value(1),sourceAtomicCount=value(5),mask=value(6);
    return {id,sourceObjectId,firstDamaged:value(2),renderDamaged:!!value(3),usesCollision:!!value(4),
      sourceAtomicCount,activeGeometrySourceAtomicMask:mask,
      activeGeometrySourceAtomics:Array.from({length:sourceAtomicCount},(_,index)=>index).filter(index=>mask&(1<<index)),
      sourceIsDamaged:!!value(7),modelType:value(8),collisionDamageEffect:null,collisionDamageMultiplier:null,
      damageFieldsStatus:sourceObjectId<0?'not-read-unregistered-profile':'not-read-profile-initialization-unproven'};
  },
  state:()=>native&&native._ViceViewerTarget()>=0?{
    position:[0,1,2].map(field=>native._ViceViewerValue(field)),
    rwPosition:[3,4,5].map(field=>native._ViceViewerValue(field)),
    radius:native._ViceViewerValue(6),distance:native._ViceViewerValue(7),
    generationDistanceMultiplier:native._ViceViewerValue(8),vehicleLodSquared:native._ViceViewerValue(9),
    pointLights:native._ViceViewerValue(10),
    deferredAlphaAtomics:native._ViceViewerValue(11),deferredBoatAlphaAtomics:native._ViceViewerValue(12),
    vehicleDistanceSquared:native._ViceViewerValue(13),
    farClip:native._ViceViewerValue(14),nearClip:native._ViceViewerValue(15),
    depthOffset:native._ViceViewerValue(16),
  }:null,
  camera(angle,zoom) {
    if (![angle,zoom].every(value=>typeof value==='number'&&Number.isFinite(Math.fround(value)))) throw new TypeError('Viewer camera requires finite Float32 values.');
    return !!native?._ViceViewerCamera(angle,zoom);
  },
},models:readModels,modelSurface:readSurface,controlTransitions:()=>{
  const count=native?._ViceControlTransitionCount()??0;
  return Array.from({length:count},(_,index)=>{
    const value=field=>native._ViceControlTransitionValue(index,field);
    return {sequence:value(0),nextIp:value(1),caller:value(16),frame:value(2),time:value(3),enabled:!!value(4),position:[5,6,7].map(value),script:String.fromCharCode(...Array.from({length:8},(_,i)=>value(8+i))).split('\0')[0]};
  });
},missionRetryQuestion:()=>native?{
  language:native._ViceMenuLanguage(),
  codes:Array.from({length:32},(_,index)=>native._ViceRetryQuestionCode(index)).filter(code=>code!==0),
}:null,portMenuText:key=>{
  const id=portMenuTextKeys.indexOf(key);
  if(!native||id<0)return null;
  return {language:native._ViceMenuLanguage(),codes:Array.from({length:32},(_,index)=>native._VicePortMenuTextCode(id,index)).filter(code=>code!==0)};
},vehicle:readVehicle,playerVehicle:()=>{
  const handle=native?._VicePlayerVehicleHandle()??-1;
  return handle<0?null:readVehicle(handle);
},ped:handle=>{
  if(!nativeInteger(handle))throw new TypeError('Ped handle must fit a signed 32-bit integer.');
  if(handle<0)throw new RangeError('Ped handle must not be negative.');
  if(!native?._VicePedValue(handle,0))return null;
  return {handle,position:[1,2,3].map(field=>native._VicePedValue(handle,field)),health:native._VicePedValue(handle,4),model:native._VicePedValue(handle,5),inVehicle:!!native._VicePedValue(handle,6),leaderIsPlayer:!!native._VicePedValue(handle,7)};
},pedCombat:handle=>{
  if(!nativeInteger(handle))throw new TypeError('Ped handle must fit a signed 32-bit integer.');
  if(handle<0)throw new RangeError('Ped handle must not be negative.');
  if(!native?._VicePedValue(handle,24))return null;
  const value=field=>native._VicePedValue(handle,field);
  let target=null;
  if(value(17)){
    const pedHandle=value(20);
    target={type:value(18),model:value(19),position:[21,22,23].map(value),pedHandle:pedHandle<0?null:pedHandle};
  }
  return {handle,state:value(8),moveState:value(9),forward:[10,11,12].map(value),
    weapon:{type:value(13),state:value(14),ammoInClip:value(15),ammoTotal:value(16)},target};
},auditGroundAndWater:target=>{
  if(!Array.isArray(target)||target.length!==3||[...target].some(v=>typeof v!=='number'||!Number.isFinite(Math.fround(v))))throw new TypeError('Surface target must contain three finite Float32 coordinates.');
  if((native?._ViceAuditGroundAndWater(...target)??-1)<0)throw new Error('Surface query requires active unpaused gameplay within 100 units of the player.');
  const value=field=>native._ViceGroundAndWaterValue(field);
  return {buildingGround:value(0)?{z:value(1),modelId:value(2)}:null,water:value(3)?{z:value(4)}:null,queryScanScratchChanged:true};
},auditPedRoute:target=>{
  if(!Array.isArray(target)||target.length!==3||[...target].some(v=>typeof v!=='number'||!Number.isFinite(Math.fround(v))))throw new TypeError('Route target must contain three finite Float32 coordinates.');
  const count=native?._ViceAuditPedRoute(...target)??-1;
  if(count<0)throw new Error('Native route search requires an active, unpaused game.');
  const nodes=Array.from({length:count},(_,index)=>({id:native._VicePedRouteNodeId(index),position:[0,1,2].map(axis=>native._VicePedRouteNodeValue(index,axis))}));
  return {nodes,complete:!!native._VicePedRouteComplete(),pathSearchScratchChanged:true,
    pathType:native._ViceRouteEndpointValue(0),capacity:native._ViceRouteEndpointValue(7),
    start:{id:native._ViceRouteEndpointValue(1),group:native._ViceRouteEndpointValue(3),distanceFromPoint:native._ViceRouteEndpointValue(5)},
    target:{id:native._ViceRouteEndpointValue(2),group:native._ViceRouteEndpointValue(4),distanceFromPoint:native._ViceRouteEndpointValue(6)}};
},auditCarRoute:target=>{
  if(!Array.isArray(target)||target.length!==3||[...target].some(v=>typeof v!=='number'||!Number.isFinite(Math.fround(v))))throw new TypeError('Route target must contain three finite Float32 coordinates.');
  const count=native?._ViceAuditCarRoute(...target)??-1;
  if(count<0)throw new Error('Native car route search requires the player driving in active unpaused gameplay.');
  const nodes=Array.from({length:count},(_,index)=>({id:native._VicePedRouteNodeId(index),position:[0,1,2].map(axis=>native._VicePedRouteNodeValue(index,axis))}));
  return {nodes,complete:!!native._VicePedRouteComplete(),pathSearchScratchChanged:true,
    pathType:native._ViceRouteEndpointValue(0),capacity:native._ViceRouteEndpointValue(7),
    start:{id:native._ViceRouteEndpointValue(1),group:native._ViceRouteEndpointValue(3),distanceFromPoint:native._ViceRouteEndpointValue(5)},
    target:{id:native._ViceRouteEndpointValue(2),group:native._ViceRouteEndpointValue(4),distanceFromPoint:native._ViceRouteEndpointValue(6)}};
},scriptState:()=>native?{
  globalBytes:native._ViceScriptGlobalBytes(),missionActive:!!native._ViceScriptMissionActive(),
  progress:native._ViceScriptProgress(),cameraOrientation:native._ViceCameraOrientation(),area:native._ViceCurrentArea(),
  money:native._VicePlayerMoney(),missionsPassed:native._ViceMissionsPassed(),missionScriptBase:native._ViceMissionScriptBase(),
  lastMission:String.fromCharCode(...Array.from({length:8},(_,index)=>native._ViceLastMissionByte(index))).split('\0')[0],
}:null,scriptGlobals:offsets=>{
  if(!Array.isArray(offsets))throw new TypeError('Script offsets must be an array.');
  const size=native?._ViceScriptGlobalBytes()??0;
  for(const offset of offsets)if(!nativeInteger(offset)||offset<8||offset%4||offset>size-4)throw new RangeError('Script offset must address an aligned global cell in the loaded program.');
  return offsets.map(offset=>({offset,int32:native._ViceScriptGlobalValue(offset)}));
},auditLoadModel:id=> {
  if (!nativeInteger(id)) throw new TypeError('Model ID must fit signed 32-bit integers.');
  return native?._ViceAuditLoadModel(id)??-1;
},modelAtomic:(id,lod)=> {
  if (!nativeInteger(id) || !nativeInteger(lod)) throw new TypeError('Model ID and LOD must fit signed 32-bit integers.');
  return native ? {vertices:native._ViceModelAtomicVertices(id,lod),triangles:native._ViceModelAtomicTriangles(id,lod)} : null;
},setResolution:(width,height)=> {
  if (!nativeInteger(width) || !nativeInteger(height)) throw new TypeError('Resolution must fit signed 32-bit integers.');
  return native?._ViceSetResolution(width,height);
},observe:() => ({phase,loaded,count,errors:[...errors],logs:logs.slice(-40),isolated:crossOriginIsolated,state:native?._ViceGameState?.(),menu:native?._ViceMenuActive?.(),menuPage:native?._ViceMenuScreen?.(),frames:native?._ViceLogicFrame?.(),renderedFrames:native ? native._VicePresentedFrames()>>>0 : null,screen:native ? [native._ViceScreenWidth(),native._ViceScreenHeight()] : null,mouse:native ? [native._ViceMouseX(),native._ViceMouseY()] : null,clock:native ? [native._ViceClockHours(),native._ViceClockMinutes()] : null,player:native?._VicePlayerPresent() ? {position:[native._VicePlayerX(),native._VicePlayerY(),native._VicePlayerZ()],inVehicle:!!native._VicePlayerInVehicle(),controlsDisabled:!!native._ViceControlsDisabled(),cutscene:!!native._ViceCutsceneRunning(),intro:!!native._ViceIntroPlaying()} : null})};

async function textureHash(data) {
  const digest = await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function install(instance) {
  if (viewer && (inspectionName !== null || inspectionQuery.has('comparar'))) {
    if ((specialName !== null && wardrobeName !== null) || inspectionQuery.getAll('special').length > 1 || inspectionQuery.getAll('roupa').length > 1) throw new Error('Parâmetros de inspeção ambíguos.');
    const response = await fetch('./models.json');
    if (!response.ok) throw new Error('Catálogo de personagens indisponível.');
    const catalog = await response.json();
    const rows = specialName !== null ? catalog.specialModels : catalog.wardrobeModels;
    if (catalog.format !== 'vice-classic-viewer-models/1' || inspectionName !== null && (!Array.isArray(rows) || !rows.some(row => row.name === inspectionName))) throw new Error('Personagem de inspeção não encontrado.');
    namedInspections=inspectionNames(location.href,catalog);
  }
  await streamer.ready;
  const response = await fetch('/assets/classic/install.json');
  if (!response.ok) throw new Error('Manifesto indisponível.');
  const manifest = await response.json();
  if (manifest.format !== 'vice-classic-install/1' || !Array.isArray(manifest.startupFiles)) throw new Error('Manifesto inválido.');
  const campaignStartup = new Set(manifest.startupFiles);
  if (campaignStartup.size !== manifest.startupFiles.length || manifest.startupFiles.some(path => !manifest.files.some(file => file.path === path && file.size < manifest.streamThreshold))) throw new Error('Preparação inicial inválida.');
  const startupFiles = viewer ? new Set(manifest.startupFiles.filter(path =>
    !/\.(ipl|zon)$/i.test(path) && !/^(anim\/cuts\.dir|data\/main\.scm|data\/paths\/|txd\/|models\/fronten[12]\.txd)/i.test(path)
  )) : campaignStartup;
  count = manifest.files.length;
  const FS = instance.FS;
  const loadedSfx = new Set();
  instance.viceSfxReset = () => loadedSfx.clear();
  instance.viceSfxDataReady = (offset,size,target,heap) => {
    const key = `${offset}:${size}:${target}`;
    if (loadedSfx.has(key)) return 1;
    const ready = streamer.ensure('sfx.RAW',offset,size);
    if (ready !== 1) return ready;
    const stream = FS.open('/gtavc/Audio/sfx.RAW','r');
    try {
      if (FS.read(stream,heap,target,size,offset) !== size) throw new Error('Efeito sonoro incompleto.');
    } finally { FS.close(stream); }
    loadedSfx.add(key);
    return 1;
  };
  instance.viceArchiveReady = (archive, offset, size) => streamer.ensure(archive, offset, size);
  FS.mkdirTree('/gtavc/userfiles');
  if (!viewer) {
    FS.mount(instance.IDBFS,{autoPersist:true},'/gtavc/userfiles');
    await new Promise((resolve,reject) => FS.syncfs(true,error => error ? reject(error) : resolve()));
  }
  if (!FS.analyzePath('/gtavc/userfiles/reVC.ini').exists && !FS.analyzePath('/gtavc/userfiles/gta_vc.set').exists) {
    const supported = new Map([['en',0],['fr',1],['de',2],['it',3],['es',4],['pt',8]]);
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    const language = preferred.map(tag=>supported.get(tag.toLowerCase().split('-')[0])).find(id=>id!==undefined) ?? 0;
    FS.writeFile('/gtavc/userfiles/reVC.ini',new TextEncoder().encode(`[General]\nLanguage=${language}\n[Display]\nSubtitles=1\n`));
  }
  const jobs = [];
  FS.mkdirTree('/gtavc/TEXT');
  streamer.mount(instance,{mount:'/gtavc/TEXT',name:'portuguese.gxt',url:'/assets/classic/localization/portuguese.gxt',size:425188,sha256:'803874ce70655da4a80871cd7b83e1ec430a15cae96a980006d7052945071774'});
  FS.mkdirTree('/gtavc/models');
  streamer.mount(instance,{mount:'/gtavc/models',name:'fonts_pt.txd',url:'/assets/classic/localization/fonts_pt.txd',size:2097448,sha256:'250b324f422331efb7a7eec79cafa1c17daf7c7c5ef2e754f7e5799d1ce6a5b8'});
  for (const file of manifest.files) {
    const path = '/gtavc/'+file.path;
    const slash = path.lastIndexOf('/');
    FS.mkdirTree(path.slice(0,slash));
    const url = '/assets/classic/game/'+file.path.split('/').map(encodeURIComponent).join('/');
    // Viewer recipes replace these inputs before native startup; lazy mounts are read-only.
    if (viewer && (file.path === 'data/animviewer.dat' || file.path === 'data/special.txt')) {loaded++;continue;}
    if (!startupFiles.has(file.path)) {
      streamer.mount(instance,{mount:path.slice(0,slash),name:path.slice(slash+1),url,size:file.size,sha256:file.sha256});
      if(!viewer&&file.path.toLowerCase().endsWith('.adf'))prepareRadioContinuation(streamer,FS.lookupPath(path).node,file.path,file.size);
      loaded++;
      loading.textContent = `Vice City Hazırlanıyor · ${Math.round(100*loaded/count)}%`;
    } else jobs.push({file,path,url});
  }
  warmInitialCutscenesAndAudio(streamer);
  const supplementResponse = await fetch('/assets/classic/engine/texture-supplements.json');
  if (!supplementResponse.ok) throw new Error('Manifesto de texturas indisponível.');
  const supplementData = new Uint8Array(await supplementResponse.arrayBuffer());
  if (supplementData.byteLength !== 5909) throw new Error('Manifesto de texturas incompleto.');
  if (await textureHash(supplementData) !== '65b11244053f37f989a0e44f807b854104ff5607de40884086f05bfe9c81425d') throw new Error('Manifesto de texturas sem integridade.');
  const supplements = JSON.parse(new TextDecoder().decode(supplementData));
  FS.mkdirTree('/gtavc/models/texture-supplements');
  const correctedTextures = [...supplements.files];
  const variantResponse = await fetch('/assets/classic/engine/texture-variants.json');
  if (!variantResponse.ok) throw new Error('Manifesto de variantes indisponível.');
  const variantData = new Uint8Array(await variantResponse.arrayBuffer());
  if (variantData.byteLength !== 1183) throw new Error('Manifesto de variantes incompleto.');
  if (await textureHash(variantData) !== 'c595542284f9bb9a75d8a7cd2d2a683afe9c4cb8e67045067699431c806e53ef') throw new Error('Manifesto de variantes sem integridade.');
  const variants = JSON.parse(new TextDecoder().decode(variantData));
  if (variants.format !== 'vice-classic-texture-variants/1' || variants.files.length !== 5) throw new Error('Manifesto de variantes inválido.');
  FS.mkdirTree('/gtavc/models/texture-variants');
  correctedTextures.push(...variants.files);
  const legacyResponse = await fetch('/assets/classic/engine/legacy-textures.json');
  if (!legacyResponse.ok) throw new Error('Manifesto de texturas legadas indisponível.');
  const legacyData = new Uint8Array(await legacyResponse.arrayBuffer());
  if (legacyData.byteLength !== 852) throw new Error('Manifesto de texturas legadas incompleto.');
  if (await textureHash(legacyData) !== '06822ad7078fb4baba99fcb2185f33f8b32ebf29e4a698d857e179932f6a6708') throw new Error('Manifesto de texturas legadas sem integridade.');
  const legacy = JSON.parse(new TextDecoder().decode(legacyData));
  if (legacy.format !== 'vice-classic-legacy-textures/1' || legacy.files.length !== 4) throw new Error('Manifesto de texturas legadas inválido.');
  FS.mkdirTree('/gtavc/models/legacy-textures');
  correctedTextures.push(...legacy.files);
  for (const file of correctedTextures) {
    if (viewer) {
      const slash = file.path.lastIndexOf('/');
      streamer.mount(instance,{mount:'/gtavc/'+file.path.slice(0,slash),name:file.path.slice(slash+1),url:file.url,size:file.size,sha256:file.sha256,verify:true});
    } else jobs.push({file,path:'/gtavc/'+file.path,url:file.url,supplement:true});
  }
  const controller = new AbortController();
  let next = 0, failure;
  async function download() {
    while (!failure && next < jobs.length) {
      const {file,path,url,supplement} = jobs[next++];
      try {
        let response, data;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            response = await fetch(url,{signal:controller.signal});
            if (response.ok) {
              data = new Uint8Array(await response.arrayBuffer());
              if (data.byteLength === file.size) break;
            } else {
              await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            }
          } catch (e) {
            if (controller.signal.aborted || attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
          }
        }
        if (!response || !response.ok) throw new Error('Arquivo indisponível: '+file.path+' ('+(response?.status ?? 'err')+')');
        if (!data || data.byteLength !== file.size) throw new Error('Arquivo incompleto: '+file.path);
        if (supplement && await textureHash(data) !== file.sha256) throw new Error('Arquivo sem integridade: '+file.path);
        if (failure) return;
        FS.writeFile(path,data,{canOwn:true});
        if (!supplement) loaded++;
        loading.textContent = `Vice City Hazırlanıyor · ${Math.round(100*loaded/count)}%`;
        await new Promise(r => setTimeout(r, 15));
      } catch (error) {
        if (!failure) {failure=error;controller.abort();}
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},download));
  if (failure) throw failure;
  // This is the exact table generated by this engine and dataset; without it native boot opens every voice to measure its duration.
  const audioLengthsResponse = await fetch('/assets/classic/engine/audio-lengths.bin');
  if (!audioLengthsResponse.ok) throw new Error('Tabela de áudio indisponível.');
  const audioLengths = new Uint8Array(await audioLengthsResponse.arrayBuffer());
  if (audioLengths.byteLength !== 4896 || await textureHash(audioLengths) !== '40055a73b9f0e79a01563748ee0b256ace82bfc8ef619e479ed2e53977167ddf') throw new Error('Tabela de áudio sem integridade.');
  FS.writeFile('/gtavc/Audio/sound.cache',audioLengths,{canOwn:true});
   if (!viewer) {
   const radioResponse=await fetch('/play/radio-index.bin');
  if(!radioResponse.ok)throw Error('Índice de rádio indisponível.');
  const radioBytes=new Uint8Array(await radioResponse.arrayBuffer());
  if(radioBytes.byteLength!==85572||await textureHash(radioBytes)!=='586b91a4e0fb2ebb1d3b76d1fbca650047dbdfff6f96ec546d5710638e821dc4')throw Error('Índice de rádio sem integridade.');
  FS.writeFile('/gtavc/data/web-radio-index.bin',radioBytes,{canOwn:true});
  instance.viceRadioStreamReady=createRadioDemand(radioBytes,streamer);
   }
  const signsResponse = await fetch('/assets/classic/engine/signs-roadsign.txd');
  if (!signsResponse.ok) throw new Error('Textura de placa indisponível.');
  const signs = new Uint8Array(await signsResponse.arrayBuffer());
  if (signs.byteLength !== 8360) throw new Error('Textura de placa incompleta.');
  const signsHash = await textureHash(signs);
  if (signsHash !== 'cd719b4767c268165039c20feb1abd4176f414a4ce9649b6c3a91766859c2c71') throw new Error('Textura de placa sem integridade.');
  FS.writeFile('/gtavc/models/signs-roadsign.txd',signs,{canOwn:true});
  if (!viewer) {
    // Startup cues cross the first native pause transition, so they must already be resident.
    const menuSfxSamples = [356,357,358,372,373,374,375,376,377,378,379];
    const table = FS.readFile('/gtavc/Audio/sfx.SDT');
    const samples = new DataView(table.buffer,table.byteOffset,table.byteLength);
    const ranges = menuSfxSamples.map(index => ({offset:samples.getUint32(index*20,true),size:samples.getUint32(index*20+4,true)}));
    const start = Math.min(...ranges.map(range => range.offset));
    const end = Math.max(...ranges.map(range => range.offset+range.size));
    for (;;) {
      const ready = streamer.ensure('sfx.RAW',start,end-start);
      if (ready === 1) break;
      if (ready < 0) throw new Error('Sons do menu indisponíveis.');
      await new Promise(resolve => setTimeout(resolve,5));
    }
  }
  if (viewer) {
    const recipe = FS.readFile('/gtavc/data/gta_vc.dat',{encoding:'utf8'}).split(/\r?\n/).filter(line=>/^(IDE|COLFILE)\s/.test(line)).join('\n')+'\n';
    FS.writeFile('/gtavc/data/animviewer.dat',recipe);
    FS.writeFile('/gtavc/data/special.txt',namedInspections.length?namedInspections.map(name=>name+' STD').join('\n')+'\n':'');
  }
  FS.chdir('/gtavc');
}

play.addEventListener('click',async () => {
  if (started) return;
  started = true;
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {failed('SharedArrayBuffer indisponível.');return;}
  phase = 'loading';play.hidden = true;gate.hidden = true;loading.hidden = false;
  try {
    if(!viewer&&(navigator.maxTouchPoints>0||matchMedia('(any-pointer: coarse)').matches)){
      const {mountTouchControls}=await import('./touch.js');
      touchControls=mountTouchControls({canvas,state:()=>{
        const player=native?._VicePlayerPresent();
        return {phase,state:native?._ViceGameState(),menu:!!native?._ViceMenuActive(),inVehicle:!!player&&!!native._VicePlayerInVehicle(),
          weaponType:player?native._VicePedValue(native._ViceScriptGlobalValue(12),13):0,
          blocked:!!player&&(!!native._ViceControlsDisabled()||!!native._ViceCutsceneRunning()||!!native._ViceIntroPlaying())};
      }});
    }
    void createReVC({canvas,arguments:viewer?['-animviewer']:[],print:log,printErr:log,
      preRun:[instance => {
        instance.addRunDependency('vice-assets');
        void install(instance).then(() => instance.removeRunDependency('vice-assets')).catch(failed);
      }],
      onRuntimeInitialized(){native = this;phase = 'running';loading.hidden = true;canvas.focus();warmSecondaryAssets(streamer);},
      onAbort:failed,
    }).catch(failed);
  } catch(error) {failed(error);}
});
canvas.addEventListener('click',event => {
  canvas.focus();
  if (event.pointerType!=='touch'&&(event.pointerType==='mouse'||navigator.maxTouchPoints===0)&&native?._ViceGameState() === 9 && !native._ViceMenuActive() && !document.pointerLockElement) void canvas.requestPointerLock();
});
