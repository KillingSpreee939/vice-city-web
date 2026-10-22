export function createNativeComparison(getNative){
  const errors={[-1]:'stale-generation',[-3]:'invalid-value',[-4]:'busy',[-5]:'not-ready'};
  function command(name,generation,value){
    if(!Number.isInteger(generation)||generation<0||generation>0xffffffff)throw RangeError('Invalid comparison generation.');
    const code=getNative()?.['_ViceViewerMirror'+name]?.(generation,...(value===undefined?[]:[value]))??-5;
    return code>0?{accepted:true,ticket:code,generation}:{accepted:false,error:errors[code]??'native-error',code,generation};
  }
  return {
    available:()=>typeof getNative()?._ViceViewerMirrorRequest==='function',
    select(generation,model){
      if(!Number.isInteger(model)||model<0||model>294)throw RangeError('Invalid comparison model.');
      return command('Request',generation,model);
    },
    clear:generation=>command('Clear',generation),
    split(generation,enabled){
      if(typeof enabled!=='boolean')throw TypeError('Comparison enabled must be boolean.');
      return command('Split',generation,Number(enabled));
    },
    snapshot(){
      const native=getNative();
      if(typeof native?._ViceViewerMirrorSnapshot!=='function')return null;
      const value=native.ccall('ViceViewerMirrorSnapshot','string',[],[]);
      return value?JSON.parse(value):null;
    },
  };
}
