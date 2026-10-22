const operations=['camera.frame','camera.rotate','camera.zoom','clip.standard','clip.hierarchy','clip.restart','clip.idle','transport.pause','transport.seek','transport.speed','compare.select','compare.clear'];
const errors={[-1]:'stale-generation',[-2]:'unsupported',[-3]:'invalid-value',[-4]:'busy',[-5]:'not-ready'};

export function createViewerInspector(getNative){
  function read(name){
    const native=getNative();
    if(typeof native?.['_ViceViewerInspect'+name]!=='function')return null;
    const value=native.ccall('ViceViewerInspect'+name,'string',[],[]);
    return value?JSON.parse(value):null;
  }
  return {
    snapshot:()=>read('Snapshot'),
    geometry:()=>read('Geometry'),
    pose:()=>read('Pose'),
    catalog:()=>read('Catalog'),
    command(input){
      if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Inspector command requires an object.');
      const {operation,generation,actor=0}=input;
      if(typeof operation!=='string'||!operations.includes(operation))throw new TypeError('Unknown inspector operation.');
      if(!Number.isInteger(generation)||generation<0||generation>0xffffffff)throw new RangeError('Inspector generation must be an unsigned 32-bit integer.');
      if(!Number.isInteger(actor)||actor<0||actor>0x7fffffff)throw new RangeError('Inspector actor must be a nonnegative 32-bit integer.');
      let index=0,x=0;
      const numeric=(key,min,max)=>{
        const value=input[key];
        if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('Inspector '+key+' must be finite.');
        if(value<min||value>max)throw new RangeError('Inspector '+key+' is out of range.');
        return value;
      };
      if(operation==='camera.rotate')x=numeric('angle',-Math.PI,Math.PI);
      if(operation==='camera.zoom'){
        x=numeric('factor',Number.MIN_VALUE,10);
      }
      if(operation==='transport.seek')x=numeric('seconds',0,Number.MAX_VALUE);
      if(operation==='transport.speed')x=numeric('multiplier',0.25,2);
      if(operation==='transport.pause'){
        if(typeof input.paused!=='boolean')throw new TypeError('Inspector paused must be boolean.');
        x=Number(input.paused);
      }
      if(operation==='clip.standard'||operation==='clip.hierarchy'||operation==='compare.select'){
        index=numeric('index',0,operation==='clip.standard'?172:0x7fffffff);
        if(!Number.isInteger(index))throw new RangeError('Inspector index must be an integer.');
      }
      const ticket=getNative()?._ViceViewerInspectCommand?.(generation,actor,operations.indexOf(operation),index,x,0)??-5;
      return ticket>0?{accepted:true,ticket,generation}:{accepted:false,error:errors[ticket]??'native-error',code:ticket,generation};
    },
  };
}
