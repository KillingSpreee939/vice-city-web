export function createNativeRecipes(getNative){
  const errors={[-1]:'stale-generation',[-3]:'invalid-value',[-4]:'busy',[-5]:'not-ready'};
  return {
    available:()=>typeof getNative()?._ViceViewerRecipeRestore==='function',
    appliedTicket:()=>getNative()?._ViceViewerRecipeAppliedTicket?.()??0,
    snapshot(){
      const native=getNative();
      if(typeof native?._ViceViewerRecipeSnapshot!=='function')return null;
      const value=native.ccall('ViceViewerRecipeSnapshot','string',[],[]);
      return value?JSON.parse(value):null;
    },
    restore(generation,values){
      if(!Number.isInteger(generation)||generation<0||generation>0xffffffff)throw RangeError('Invalid recipe generation.');
      if(!Array.isArray(values)||!values.length||values.length>16384||values.findIndex(value=>typeof value!=='number'||!Number.isFinite(value))!==-1)throw TypeError('Invalid native recipe values.');
      const native=getNative();
      if(typeof native?._ViceViewerRecipeScratch!=='function')return {accepted:false,error:'not-ready'};
      const pointer=native._ViceViewerRecipeScratch(values.length);
      if(!pointer)return {accepted:false,error:'busy'};
      const memory=new DataView(native.viceRecipeMemory());
      for(let i=0;i<values.length;i++)memory.setFloat64(pointer+i*8,values[i],true);
      const code=native._ViceViewerRecipeRestore(generation,values.length);
      return code>0?{accepted:true,ticket:code,generation}:{accepted:false,error:errors[code]??'native-error',code,generation};
    },
  };
}
