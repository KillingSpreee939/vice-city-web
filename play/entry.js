const play=document.querySelector('#play');
const saveHelp=document.querySelector('#save-help');
document.querySelector('#save-help-open').addEventListener('click',()=>saveHelp.showModal());
document.querySelector('#save-help-close').addEventListener('click',()=>saveHelp.close());
document.querySelector('#save-protect').addEventListener('click',async()=>{
  const status=document.querySelector('#save-storage-status');
  try{
    const protectedStorage=await navigator.storage?.persist?.();
    status.textContent=protectedStorage?'Armazenamento protegido contra limpeza automática. Apagar os dados do site ainda remove os saves.':'O navegador não concedeu proteção extra. Os saves continuam locais; evite limpar os dados do site.';
  }catch{
    status.textContent='Proteção extra indisponível neste navegador. Os saves continuam locais; evite limpar os dados do site.';
  }
});
play.addEventListener('click',async()=>{
  play.disabled=true;
  document.querySelector('#status').textContent='Preparando Vice City…';
  try{
    await import('./classic.js');
    play.disabled=false;
    play.click();
  }catch{
    document.querySelector('#status').textContent='Falha ao carregar o jogo. Recarregue para tentar novamente.';
    play.hidden=true;
    const retry=document.querySelector('#retry');
    retry.hidden=false;
    retry.addEventListener('click',()=>location.reload(),{once:true});
  }
},{once:true});
