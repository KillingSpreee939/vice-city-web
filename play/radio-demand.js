const BLOCK=256*1024;

export function createRadioDemand(bytes,streamer){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  if(decoder.decode(bytes.subarray(0,8))!=='VCRADIO1'||view.getUint32(8,true)!==9||view.getUint32(12,true)!==64)throw Error('Índice de rádio incompatível.');
  const rows=new Map();let offset=16;
  for(let i=0;i<9;i++){
    const name=decoder.decode(bytes.subarray(offset,offset+16)).split('\0')[0];offset+=16;
    const rate=view.getUint32(offset,true),samples=view.getUint32(offset+4,true),frames=view.getUint32(offset+8,true),count=view.getUint32(offset+12,true);offset+=16;
    const positions=Array.from({length:count},()=>{const value=view.getUint32(offset,true);offset+=4;return value;});
    rows.set(name,{rate,samples,frames,positions});
  }
  if(offset!==bytes.length)throw Error('Índice de rádio inválido.');
  return (path,milliseconds)=>{
    const name=path.split(/[\\/]/).pop().toLowerCase(),row=rows.get(name);
    if(!row)return 1;
    const entry=streamer.byName.get(name);
    if(!entry||entry.file)return 1;
    const frame=Math.floor(Math.fround(Math.fround(milliseconds/1000)*row.rate)/row.samples);
    const index=Math.min(row.positions.length-1,Math.floor(Math.max(0,frame-16)/64));
    const start=row.positions[index],end=Math.min(entry.size,start+BLOCK*2);
    return Number([streamer.ensure(name,0,1),streamer.ensure(name,entry.size-1,1),streamer.ensure(name,start,end-start)].every(value=>value===1));
  };
}

export function prepareRadioContinuation(streamer,node,name,size){
  const read=node.stream_ops.read;
  let last=-1;
  node.stream_ops.read=(stream,buffer,offset,length,position)=>{
    const written=read(stream,buffer,offset,length,position);
    const next=Math.floor((position+written)/BLOCK)+1;
    if(written>0&&next!==last&&next*BLOCK<size){
      last=next;
      streamer.ensure(name,next*BLOCK,Math.min(BLOCK*2,size-next*BLOCK));
    }
    return written;
  };
}
