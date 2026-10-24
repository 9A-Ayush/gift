import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import core from '../playlist.js';
import {Discovery,assess,seconds} from '../discovery.mjs';
import {createApp} from '../server.mjs';

const goodId='AbCdEfGhI01',otherId='AbCdEfGhI02';
function video(id,title='Bobby Raj maths teacher #shorts',extra={}){
  return {id,snippet:{title,description:'Josh Talks Hindi maths teacher meme',channelTitle:'Test channel',
    channelId:'reference-channel',liveBroadcastContent:'none',thumbnails:{medium:{url:'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'}}},
    contentDetails:{duration:'PT35S'},status:{privacyStatus:'public',embeddable:true,uploadStatus:'processed'},...extra};
}
function mockYouTube(options={}){
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(options.fail)return {ok:false,status:403};
    const endpoint=url.pathname.split('/').pop();
    const items=endpoint==='search'?
      [{id:{videoId:goodId}},{id:{videoId:goodId}},{id:{videoId:otherId}},{id:{videoId:'bad'}},{id:{videoId:core.ORIGINAL_IDS[0]}}]:
      (url.searchParams.get('id')||'').split(',').map(id=>video(id,id===otherId?'Bobby Raj cooking show':'Bobby Raj maths teacher #shorts'));
    return {ok:true,json:async()=>({items:items.map(v=>v.id===otherId?{...v,snippet:{...v.snippet,description:'Unrelated cooking'}}:v)})};
  };
  return {fetcher,calls};
}
test('seven originals are permanent and valid',()=>{
  assert.equal(core.ORIGINAL_IDS.length,7);assert.equal(new Set(core.ORIGINAL_IDS).size,7);
  assert.ok(core.ORIGINAL_IDS.every(core.validId));assert.equal(core.ORIGINAL_IDS[0],'sbgbQOFZxwU');
});
test('shuffles every cycle with no immediate repeats across 200 cycles',()=>{
  const queue=new core.Queue();let previous=null;
  for(let cycle=0;cycle<200;cycle++){
    const seen=new Set();
    for(let n=0;n<7;n++){const id=queue.next();assert.notEqual(id,previous);seen.add(id);previous=id;}
    assert.equal(seen.size,7);
  }
});
test('queue updates do not interrupt a cycle; removed and failed clips are skipped',()=>{
  const queue=new core.Queue();const first=queue.next();queue.update([...core.ORIGINAL_IDS,goodId,goodId,'invalid']);
  assert.equal(queue.last,first);assert.equal(queue.ids.length,8);
  const seen=new Set();for(let i=0;i<25;i++)seen.add(queue.next(new Set([first])));
  assert.ok(seen.has(goodId));assert.ok(!seen.has(first));
  assert.equal(queue.next(new Set(queue.ids)),null);
});
test('relevance rejects unrelated names, long, private, restricted and non-embeddable videos',()=>{
  assert.equal(seconds('PT2M59S'),179);
  assert.ok(assess(video(goodId)).eligible);
  assert.ok(!assess(video(goodId,'Josh Talks inspirational speaker')).eligible);
  assert.ok(!assess(video(goodId,'Bobby Raj cooking',{snippet:{title:'Bobby Raj cooking',channelTitle:'Food',description:'Cooking'}})).eligible);
  assert.ok(!assess(video(goodId,undefined,{contentDetails:{duration:'PT4M'}})).eligible);
  assert.ok(!assess(video(goodId,undefined,{status:{privacyStatus:'private',embeddable:true}})).eligible);
  assert.ok(!assess(video(goodId,undefined,{status:{privacyStatus:'public',embeddable:false}})).eligible);
  assert.ok(!assess(video(goodId,undefined,{contentDetails:{duration:'PT30S',regionRestriction:{blocked:['IN']}}})).eligible);
});
test('missing key is honest and never attempts external requests',async()=>{
  let calls=0;const d=new Discovery({fetcher:()=>{calls++;throw new Error('unexpected');}});
  const data=await d.refresh();assert.equal(data.configured,false);assert.equal(data.status,'configuration_required');
  assert.equal(calls,0);assert.equal(d.publicPlaylist().videos.length,7);
});
test('search deduplicates, queues unverified candidates, enforces approval and persists decisions',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gift-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let now=Date.parse('2026-10-24T00:00:00Z');const mock=mockYouTube();
  const d=new Discovery({apiKey:'test-secret',directory,fetcher:mock.fetcher,now:()=>now});
  await d.refresh();assert.equal(d.snapshot().lastNew,1);assert.equal(d.snapshot().counts.pending,1);
  assert.equal(d.publicPlaylist().videos.length,7);
  assert.ok(mock.calls.filter(u=>u.pathname.endsWith('/search')).every(u=>u.searchParams.get('videoEmbeddable')==='true'));
  assert.equal(d.snapshot().videos.find(v=>v.id===goodId).identity,'unverified');
  await d.review(goodId,'approved');assert.equal(d.publicPlaylist().videos.length,8);
  await assert.rejects(d.review(core.ORIGINAL_IDS[0],'removed'));
  const reloaded=new Discovery({apiKey:'test-secret',directory,fetcher:mock.fetcher,now:()=>now});
  await reloaded.ready;assert.equal(reloaded.publicPlaylist().videos.length,8);
  await reloaded.review(goodId,'removed');assert.equal(reloaded.publicPlaylist().videos.length,7);
  now+=6*3600000+1;await reloaded.refresh();
  assert.equal(reloaded.snapshot().lastNew,0);
  assert.equal(reloaded.snapshot().videos.find(v=>v.id===goodId).decision,'removed');
  assert.ok(!(await readFile(join(directory,'collection.json'),'utf8')).includes('test-secret'));
});
test('automatic cache, manual cooldown, single flight and daily budget protect quota',async()=>{
  let now=Date.parse('2026-10-24T00:00:00Z');const mock=mockYouTube();
  const d=new Discovery({apiKey:'test',fetcher:mock.fetcher,now:()=>now});
  await Promise.all([d.refresh(),d.refresh(),d.refresh({force:true})]);
  assert.equal(mock.calls.filter(u=>u.pathname.endsWith('/search')).length,2);
  await d.refresh({force:true});assert.equal(mock.calls.length,4);
  now+=11*60000;await d.refresh();assert.equal(mock.calls.length,4);
  await d.refresh({force:true});assert.equal(d.snapshot().searchesToday,4);
  now+=11*60000;await d.refresh({force:true});assert.equal(d.snapshot().searchesToday,6);
  now+=11*60000;await d.refresh({force:true});assert.equal(d.snapshot().status,'quota_wait');
  assert.equal(mock.calls.filter(u=>u.pathname.endsWith('/search')).length,6);
});
test('failed discovery retains approved clips, reports failure, and throttles retries',async()=>{
  let now=Date.parse('2026-10-24T00:00:00Z');const mock=mockYouTube();
  const d=new Discovery({apiKey:'test-secret',fetcher:mock.fetcher,now:()=>now});
  await d.refresh();await d.review(goodId,'approved');const success=d.snapshot().lastSuccess;
  d.fetcher=mockYouTube({fail:true}).fetcher;now+=7*3600000;
  const result=await d.refresh();assert.equal(result.status,'error');assert.equal(result.lastSuccess,success);
  assert.equal(d.publicPlaylist().videos.length,8);assert.equal(result.lastNew,0);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});
test('empty searches are successful without invented new discoveries',async()=>{
  const d=new Discovery({apiKey:'test',fetcher:async url=>({ok:true,json:async()=>({items:url.pathname.endsWith('/videos')?(url.searchParams.get('id')||'').split(',').map(id=>video(id)):[]})})});
  await d.refresh();assert.equal(d.snapshot().status,'success');assert.equal(d.snapshot().lastNew,0);assert.equal(d.publicPlaylist().videos.length,7);
});
test('metadata failure midway never overwrites existing collection',async()=>{
  const d=new Discovery({apiKey:'test',fetcher:mockYouTube().fetcher});await d.refresh();await d.review(goodId,'approved');
  const before=JSON.stringify(d.publicPlaylist());
  d.now=()=>Date.now()+7*3600000;
  d.fetcher=async url=>url.pathname.endsWith('/search')?{ok:false,status:500}:mockYouTube().fetcher(url);
  await d.refresh({force:true});assert.equal(JSON.stringify(d.publicPlaylist()),before);
});
test('unavailable approved videos remain recorded and originals cannot disappear',async()=>{
  let now=Date.now();const d=new Discovery({apiKey:'test',fetcher:mockYouTube().fetcher,now:()=>now});
  await d.refresh();await d.review(goodId,'approved');now+=7*3600000;
  d.fetcher=async url=>{
    const result=await mockYouTube().fetcher(url);const data=await result.json();
    return {ok:true,json:async()=>({items:data.items.filter(v=>v.id!==goodId&&v.id!==core.ORIGINAL_IDS[0])})};
  };
  await d.refresh();assert.equal(d.snapshot().videos.find(v=>v.id===goodId).availability,'unavailable');
  assert.equal(d.snapshot().videos.filter(v=>v.source==='original').length,7);
});
test('HTTP routes protect secrets, owner decisions, and cross-origin writes',async t=>{
  const d=new Discovery();await d.ready;
  const server=createApp({discovery:d,token:'owner-test-token'});server.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/playlist')).status,200);
  for(const path of ['/.env','/server.mjs','/discovery.mjs','/.data/owner-token.txt','/.data/collection.json','/tests/core.test.mjs'])
    assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/owner/discovery')).status,401);
  const owner=await fetch(base+'/api/owner/discovery',{headers:{Authorization:'Bearer owner-test-token'}});
  assert.equal(owner.status,200);assert.equal((await owner.json()).counts.total,7);
  assert.equal((await fetch(base+'/api/owner/review',{method:'POST',headers:{Authorization:'Bearer owner-test-token',Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/owner/review',{method:'POST',headers:{Authorization:'Bearer owner-test-token','Content-Type':'application/json'},body:JSON.stringify({id:core.ORIGINAL_IDS[0],decision:'removed'})})).status,400);
});
test('corrupt cache fails safely without silently replacing saved collection',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gift-bad-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'collection.json'),'{bad');
  const mock=mockYouTube();const d=new Discovery({apiKey:'test',directory,fetcher:mock.fetcher});
  await d.refresh();assert.equal(d.snapshot().status,'warning');assert.equal(mock.calls.length,0);assert.equal(d.publicPlaylist().videos.length,7);
});
test('description and tag evidence can qualify a candidate without a name in its title',()=>{
 const byDescription=video(goodId,'An unexpected maths lesson');
 byDescription.snippet.description='A young maths teacher from Bihar, Bobby Raj, from Josh Talks Hindi.';
 assert.ok(assess(byDescription).eligible);
 const byTags=video(otherId,'A little teacher with a big lesson');
 byTags.snippet.description='A young maths teacher';byTags.snippet.tags=['Bobby Raj','Josh Talks Hindi'];
 assert.ok(assess(byTags).eligible);
});
test('reference channel plus child/maths evidence retains uncertain nameless candidates',()=>{
 const item=video(goodId,'This child teaches maths to class 10');
 item.snippet.description='A young boy teaching maths.';item.snippet.channelId='reference-channel';
 const result=assess(item,new Set(['reference-channel']));
 assert.ok(result.eligible);assert.equal(result.matchType,'uncertain');
 assert.ok(!assess(item,new Set(['unrelated-channel'])).eligible);
 item.snippet.title='An adult maths teacher';item.snippet.description='A lesson in calculus';
 assert.ok(!assess(item,new Set(['reference-channel'])).eligible);
});
test('commentary candidates stay distinguishable and never auto-approve',async()=>{
 const fetcher=async url=>{
  const items=url.pathname.endsWith('/search')?[{id:{videoId:goodId}}]:
   (url.searchParams.get('id')||'').split(',').map(id=>video(id,id===goodId?'Bobby Raj reaction and roast':'Bobby Raj maths teacher'));
  return {ok:true,json:async()=>({items})};
 };
 const d=new Discovery({apiKey:'test',fetcher});await d.refresh();
 const candidate=d.snapshot().videos.find(v=>v.id===goodId);
 assert.equal(candidate.matchType,'commentary');assert.equal(candidate.decision,'pending');
 assert.equal(d.publicPlaylist().videos.length,7);
});
test('a search can store twenty new candidates and retain them across server reloads',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gift-twenty-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const ids=Array.from({length:20},(_,i)=>'candidate'+String(i).padStart(2,'0'));
 const fetcher=async url=>({ok:true,json:async()=>({items:url.pathname.endsWith('/search')?ids.map(id=>({id:{videoId:id}})):
  (url.searchParams.get('id')||'').split(',').map(id=>video(id))})});
 const d=new Discovery({apiKey:'test',directory,fetcher});await d.refresh();
 assert.equal(d.snapshot().lastNew,20);assert.equal(d.snapshot().counts.total,27);assert.equal(d.snapshot().counts.originals,7);
 for(const id of ids)await d.review(id,'approved');
 assert.equal(d.publicPlaylist().videos.length,27);
 const reload=new Discovery({apiKey:'test',directory,fetcher});await reload.ready;
 assert.equal(reload.snapshot().counts.discovered,20);assert.equal(reload.publicPlaylist().videos.length,27);
});
test('searches rotate phrases and genuinely alternate relevance/date ordering',async()=>{
 let now=Date.parse('2026-10-24T00:00:00Z');const mock=mockYouTube();
 const d=new Discovery({apiKey:'test',fetcher:mock.fetcher,now:()=>now});
 await d.refresh();now+=11*60000;await d.refresh({force:true});now+=11*60000;await d.refresh({force:true});
 const searches=mock.calls.filter(u=>u.pathname.endsWith('/search'));
 assert.deepEqual(searches.map(u=>u.searchParams.get('order')),['relevance','relevance','date','date','relevance','relevance']);
 assert.equal(new Set(searches.map(u=>u.searchParams.get('q'))).size,6);
});
test('public playlist omits names, titles, channels, thumbnails and search details',async()=>{
 const d=new Discovery();await d.ready;
 d.state.videos[0].title='Bobby Raj reference';d.state.videos[0].channel='Bobby Raj channel';
 const result=d.publicPlaylist();
 assert.ok(result.videos.every(v=>Object.keys(v).sort().join(',')==='availability,id'));
 assert.ok(!/bobby|boby|बॉबी|बोबी/i.test(JSON.stringify(result)));
 assert.equal(d.snapshot().videos[0].title,'Bobby Raj reference');
});
test('restarting after an interrupted search reports it accurately and retains quota',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gift-interrupted-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=new Discovery({directory});await original.ready;
 original.state.status='searching';original.state.budget={day:'2026-10-24',used:2};await original.save();
 const reloaded=new Discovery({directory,apiKey:'test',now:()=>Date.parse('2026-10-24T12:00:00Z')});await reloaded.ready;
 assert.equal(reloaded.snapshot().status,'interrupted');assert.equal(reloaded.snapshot().searchesToday,2);
 assert.equal(reloaded.publicPlaylist().videos.length,7);
});
test('storage-cap status distinguishes unsaved matches from an empty search',async()=>{
 const mock=mockYouTube();const d=new Discovery({apiKey:'test',fetcher:mock.fetcher});await d.ready;
 d.state.videos.push(...Array.from({length:250},(_,i)=>({id:'recordxx'+String(i).padStart(3,'0'),source:'discovered',decision:'rejected',availability:'available'})));
 await d.refresh();assert.equal(d.snapshot().lastNew,0);
 assert.match(d.snapshot().message,/storage limit/);
 assert.equal(d.snapshot().counts.discovered,250);
});
