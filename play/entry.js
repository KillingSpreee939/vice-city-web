const play=document.querySelector('#play');
const saveHelp=document.querySelector('#save-help');
document.querySelector('#save-help-open').addEventListener('click',()=>saveHelp.showModal());
document.querySelector('#save-help-close').addEventListener('click',()=>saveHelp.close());
document.querySelector('#save-protect').addEventListener('click',async()=>{
  const status=document.querySelector('#save-storage-status');
  try{
    const protectedStorage=await navigator.storage?.persist?.();
    status.textContent=protectedStorage?'Kayıtlar tarayıcı hafızasında kalıcı olarak koruma altına alındı.':'Tarayıcı ekstra koruma vermedi ama kayıtlar yerel olarak saklanmaya devam ediyor.';
  }catch{
    status.textContent='Kayıtlar yerel hafızada saklanıyor.';
  }
});

play.addEventListener('click',async()=>{
  play.disabled=true;
  document.querySelector('#status').textContent='Vice City hazırlanıyor…';
  try{
    await import('./classic.js');
    play.disabled=false;
    play.click();
  }catch(err){
    console.error('Oyun yükleme hatası:', err);
    document.querySelector('#status').textContent='Oyun yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.';
    play.hidden=true;
    const retry=document.querySelector('#retry');
    if (retry) {
      retry.hidden=false;
      retry.style.display='inline-block';
      retry.addEventListener('click',()=>location.reload(),{once:true});
    }
  }
},{once:true});
