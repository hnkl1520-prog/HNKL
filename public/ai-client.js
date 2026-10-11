/* Shared context, bounded conversation history and explicit navigation links. */
(() => {
  const key='hnkl-ai-conversation-v1';
  let history=[];
  try { const saved=JSON.parse(sessionStorage.getItem(key)||'[]'); if(Array.isArray(saved))history=saved.filter(m=>m&&['user','model'].includes(m.role)&&typeof m.text==='string').slice(-8); } catch {}
  function context() {
    const sections=[...document.querySelectorAll('main section[id]')];
    const visible=sections.map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.bottom>80&&r.top<innerHeight).sort((a,b)=>Math.abs(a.r.top-100)-Math.abs(b.r.top-100));
    return {path:location.pathname,section:visible[0]?.e.id||'',category:document.querySelector('#btn-labs')?.classList.contains('active')?'labs':'projects',mobile:matchMedia('(max-width:768px)').matches,language:document.body.dataset.lang==='en'?'en':'ko'};
  }
  const allowed=new Set(['/index.html','/about.html','/works.html','/works/projects/hnkl/hnkl.html','/works/projects/vibra/vibra.html','/experiments/page-states/soon-stone/']);
  function appendActions(container,actions) {
    if(!Array.isArray(actions))return;
    const row=document.createElement('div');row.className='ai-actions';
    for(const action of actions.slice(0,3)){
      if(!action||typeof action.href!=='string'||typeof action.label!=='string')continue;
      let url;try{url=new URL(action.href,location.origin)}catch{continue}
      if(url.origin!==location.origin||!allowed.has(url.pathname))continue;
      const a=document.createElement('a');a.className='ai-action';a.href=url.href;a.textContent=action.label+' ↗';
      row.append(a);
    }
    if(row.childNodes.length)container.append(row);
  }
  async function ask(prompt,signal) {
    const response=await fetch('https://us-central1-hnkl-49a5f.cloudfunctions.net/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,page:context(),history}),signal});
    if(!response.ok)throw new Error('Chat unavailable');
    const data=await response.json();
    const reply=data.reply||data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
    if(typeof reply!=='string'||!reply.trim())throw new Error('Empty reply');
    history.push({role:'user',text:prompt.slice(0,2000)},{role:'model',text:reply.slice(0,2000)});history=history.slice(-8);
    try{sessionStorage.setItem(key,JSON.stringify(history))}catch{}
    return {reply,actions:data.actions||[]};
  }
  window.HNKLAI={ask,appendActions,context};
})();
