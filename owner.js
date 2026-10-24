(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let token='',snapshot=null,busy=false,authEpoch=0;
  try { token=sessionStorage.getItem('diwali-owner-token')||''; } catch {}
  function feedback(text){$('ownerFeedback').textContent=text;}
  function node(tag,text,className){
    const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;
  }
  async function api(path,data){
    const response=await fetch('/api/owner/'+path,{method:data?'POST':'GET',
      headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},
      body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(120000)});
    if(response.status===401){lock();throw new Error('Owner token was not accepted. Please unlock the collection again.');}
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'The request failed. Your saved collection is unchanged.');
    return result;
  }
  function date(value){return value?new Date(value).toLocaleString():'Never';}
  function render(data){
    snapshot=data;$('dashboard').classList.remove('hidden');$('loginForm').classList.add('hidden');$('logout').classList.remove('hidden');
    for(const key of ['total','originals','discovered','pending','approved','unavailable'])$(key+'Count').textContent=String(data.counts[key]);
    $('searchStatus').textContent=({configuration_required:'Discovery needs configuration',success:'Search complete',error:'Search failed',idle:'Ready for discovery',searching:'Searching YouTube…',quota_wait:'Daily search limit reached',warning:'Saved collection needs attention'})[data.status]||data.status;
    $('searchMessage').textContent=data.message;
    $('lastAttempt').textContent=date(data.lastAttempt);$('lastSuccess').textContent=date(data.lastSuccess);
    $('newCount').textContent=String(data.lastNew);$('budgetCount').textContent=data.searchesToday+' / '+data.dailySearchLimit;
    $('configurationHelp').classList.toggle('hidden',data.configured);
    $('refreshButton').disabled=!data.configured||busy;
    renderCards();
  }
  function renderCards(){
    if(!snapshot)return;
    const filter=$('collectionFilter').value;
    const videos=snapshot.videos.filter(v=>filter==='all'||(filter==='original'?v.source==='original':filter==='unavailable'?v.availability==='unavailable':v.decision===filter));
    const cards=videos.map(video=>{
      const card=node('article',undefined,'video-card glass');
      const image=document.createElement('img');image.src=video.thumbnail;image.alt='Thumbnail: '+video.title;image.loading='lazy';
      image.addEventListener('error',()=>{image.removeAttribute('src');image.alt='Thumbnail unavailable';},{once:true});
      const content=node('div',undefined,'video-card-content');
      content.append(node('span',video.source==='original'?'Original · protected':video.decision+' · identity unverified','card-badge'));
      content.append(node('h3',video.title),node('p',video.channel||'Channel unknown'));
      content.append(node('p','Playback: '+video.availability+(video.duration?' · '+video.duration+' seconds':'')));
      if(video.source!=='original')content.append(node('p',({possible_feature:'Possible feature · needs visual review',commentary:'Possible commentary or reaction · check carefully',uncertain:'Insufficient identity evidence · needs review'})[video.matchType]||'Unverified match · needs review'));
      content.append(node('p',video.reason||'Owner-reviewed discovery'));
      if(video.discoveredAt)content.append(node('p','Discovered '+date(video.discoveredAt)));
      const link=node('a','Review on YouTube ↗','quiet-link');
      link.href='https://www.youtube.com/watch?v='+video.id;link.target='_blank';link.rel='noopener noreferrer';content.append(link);
      if(video.source!=='original'){
        const actions=node('div',undefined,'card-actions');
        const choices=video.decision==='pending'?[['Approve','approved'],['Reject','rejected']]:
          video.decision==='approved'?[['Return to review','pending'],['Remove','removed']]:[['Return to review','pending']];
        for(const [label,decision] of choices){
          const button=node('button',label,'pill');button.type='button';
          button.disabled=busy||(decision==='approved'&&video.availability!=='available');
          button.setAttribute('aria-label',label+': '+video.title);
          button.addEventListener('click',()=>review(video.id,decision));actions.append(button);
        }
        content.append(actions);
      }
      card.append(image,content);return card;
    });
    $('collection').replaceChildren(...cards);
    if(!cards.length)$('collection').append(node('p',filter==='pending'?'No candidates awaiting review. Run a configured search to find more.':'No videos in this view.','empty-state glass'));
  }
  async function run(operation){
    if(busy)return;busy=true;const epoch=authEpoch;
    $('refreshButton').disabled=true;$('reloadButton').disabled=true;renderCards();
    try{
      const data=await operation();if(epoch!==authEpoch)return;render(data);
      try{sessionStorage.setItem('diwali-owner-token',token);}catch{}
    }catch(error){feedback(error.name==='TimeoutError'?'The request timed out. Reload the saved collection to check its status.':error.message);}
    finally{busy=false;$('reloadButton').disabled=false;if(snapshot){$('refreshButton').disabled=!snapshot.configured;renderCards();}}
  }
  function review(id,decision){
    void run(async()=>{
      const data=await api('review',{id,decision});
      feedback(decision==='approved'?'Approved. The clip joins playback on the next playlist cycle.':'Review saved. Original references are unchanged.');
      return data;
    });
  }
  function lock(){
    authEpoch++;token='';snapshot=null;try{sessionStorage.removeItem('diwali-owner-token');}catch{}
    $('dashboard').classList.add('hidden');$('collection').replaceChildren();$('loginForm').classList.remove('hidden');$('logout').classList.add('hidden');$('ownerToken').value='';
    feedback('Collection locked.');
  }
  $('loginForm').addEventListener('submit',event=>{event.preventDefault();token=$('ownerToken').value.trim();$('ownerToken').value='';void run(async()=>{const data=await api('discovery');feedback('Collection unlocked. Review candidates before approving them.');return data;});});
  $('logout').addEventListener('click',lock);
  $('refreshButton').addEventListener('click',()=>{feedback('Searching official YouTube metadata. Saved playback continues.');void run(async()=>{const data=await api('refresh',{});feedback(data.message);return data;});});
  $('reloadButton').addEventListener('click',()=>void run(()=>api('discovery')));
  $('collectionFilter').addEventListener('change',renderCards);
  if(token)void run(()=>api('discovery'));
})();
