import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import core from '../playlist.js';
const source=await readFile(new URL('../script.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

class Element {
 constructor(id){this.id=id;this.textContent='';this.disabled=false;this.style={};this.attributes={};this.children=[];this.events={};this.hidden=false;const set=new Set();this.classList={add:(...v)=>v.forEach(x=>set.add(x)),remove:(...v)=>v.forEach(x=>set.delete(x)),toggle:(v,on)=>{if(on===undefined)on=!set.has(v);on?set.add(v):set.delete(v);return on;},contains:v=>set.has(v)};}
 setAttribute(k,v){this.attributes[k]=v;}
 getAttribute(k){return this.attributes[k];}
 addEventListener(name,fn){this.events[name]=fn;}
 append(child){this.children=this.children.filter(v=>v!==child);this.children.push(child);}
 appendChild(child){this.append(child);}
 replaceChildren(...children){this.children=children;}
 contains(child){return this.children.includes(child);}
 matches(){return false;}
 focus(){}
 scrollIntoView(){}
 remove(){}
 getContext(){return null;}
}
function harness({withAPI=true,collection,cache,offline=false}={}){
 let time=0,serial=0;const jobs=new Map(),elements=new Map(),players=[];
 for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],new Element(match[1]));
 elements.get('shuffleZone').children=['mysteryButton','loadingButton','bonusButton'].map(id=>elements.get(id));
 const events={},store=new Map();
 if(cache)store.set('diwali-approved-playlist',JSON.stringify(cache));
 const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
 const document={hidden:false,body:new Element('body'),activeElement:null,head:new Element('head'),
  getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),
  querySelector:()=>new Element('video-player'),addEventListener:(name,fn)=>{events[name]=fn;}};
 function schedule(fn,ms,repeat){const id=++serial;jobs.set(id,{fn,at:time+ms,repeat});return id;}
 class Player {
  constructor(host,options){this.options=options;this.loads=[];this.destroyed=false;this.stops=0;this.videoId='';this.muted=true;this.volume=60;players.push(this);}
  ready(){this.options.events.onReady({target:this});}
  loadVideoById({videoId}){this.videoId=videoId;this.loads.push(videoId);}
  getVideoData(){return {video_id:this.videoId};}
  getIframe(){return {};}
  setVolume(value){this.volume=value;}
  getVolume(){return this.volume;}
  isMuted(){return this.muted;}
  mute(){this.muted=true;}
  unMute(){this.muted=false;}
  pauseVideo(){this.stops++;}
  playVideo(){this.emit(1);}
  destroy(){this.destroyed=true;}
  emit(data){this.options.events.onStateChange({data,target:this});}
  fail(data){this.options.events.onError({data,target:this});}
 }
 const sandbox={console,document,GiftPlaylist:core,matchMedia:()=>({matches:true,addEventListener(){}}),
  performance:{now:()=>time},setInterval:(fn,ms)=>schedule(fn,ms,ms),clearInterval:id=>jobs.delete(id),
  setTimeout:(fn,ms)=>schedule(fn,ms,0),clearTimeout:id=>jobs.delete(id),
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},innerWidth:1280,innerHeight:900,devicePixelRatio:1,
  location:{origin:'http://localhost:3000'},AbortSignal,AbortController,localStorage:storage,
  fetch:async()=>{if(offline)throw new Error('Offline');return {ok:true,json:async()=>({videos:collection||core.ORIGINAL_IDS.map(id=>({id,title:id,availability:'unknown'}))})};},
  addEventListener:(name,fn)=>{events[name]=fn;}};
 sandbox.window=sandbox;if(withAPI)sandbox.YT={Player};
 const context=vm.createContext(sandbox);vm.runInContext(source,context);
 function advance(ms){
  const target=time+ms;let iterations=0;
  while(true){
    const next=[...jobs.entries()].filter(([,job])=>job.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;if(++iterations>10000)throw new Error('Timer loop');
    const [id,job]=next;time=job.at;
    if(job.repeat)job.at+=job.repeat;else jobs.delete(id);
    job.fn();
  }time=target;
 }
 const click=id=>{const el=elements.get(id);if(!el.disabled)el.events.click?.({target:el});};
 const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
 async function openToPlayer(){
  await flush();click('giftButton');advance(15000);assert.equal(players.length,0);
  advance(1750);await flush();assert.equal(players.length,1);players[0].ready();return players[0];
 }
 return {elements,players,jobs,events,context,advance,click,flush,openToPlayer};
}
test('gift double click has one countdown; reveal follows a full 15 seconds',async()=>{
 const h=harness();await h.flush();h.click('giftButton');h.click('giftButton');
 assert.equal([...h.jobs.values()].filter(job=>job.repeat).length,1);
 h.advance(14750);assert.equal(h.elements.get('countdown').textContent,'1');
 assert.equal(h.players.length,0);h.advance(250);assert.equal(h.elements.get('countdown').textContent,'0');
 h.advance(1750);await h.flush();assert.equal(h.players.length,1);
});
test('pause and resume freeze countdown, stop cancels timers, restart is a fresh attempt',async()=>{
 const h=harness();await h.flush();h.click('giftButton');h.advance(5000);
 const count=h.elements.get('countdown').textContent;h.click('pauseButton');h.advance(20000);
 assert.equal(h.elements.get('countdown').textContent,count);
 h.click('pauseButton');h.advance(10000);h.click('stopButton');h.advance(20000);await h.flush();
 assert.equal(h.players.length,0);assert.equal(h.jobs.size,0);
 h.click('restartButton');assert.equal(h.elements.get('countdown').textContent,'15');
 assert.equal(h.elements.get('giftButton').disabled,false);
});
test('one player cycles on ended, counts only actual starts and obeys pause/stop',async()=>{
 const h=harness();const player=await h.openToPlayer();
 assert.equal(player.loads.length,1);assert.equal(h.elements.get('playCount').textContent,'');
 player.emit(1);player.emit(1);assert.equal(h.elements.get('playCount').textContent,'1');
 const first=player.loads[0];player.emit(0);player.emit(0);h.advance(500);
 assert.equal(player.loads.length,2);assert.notEqual(player.loads[1],first);
 player.emit(1);h.click('pauseButton');player.emit(0);h.advance(5000);
 assert.equal(player.loads.length,2);h.click('pauseButton');h.click('stopButton');
 player.emit(0);player.fail(101);h.advance(20000);
 assert.equal(player.destroyed,true);assert.equal(h.jobs.size,0);
 assert.equal(h.players.length,1);
});
test('errors skip each unavailable clip once, then show fallback instead of looping forever',async()=>{
 const h=harness();const player=await h.openToPlayer();
 for(let i=0;i<7;i++){player.fail(101);player.fail(101);h.advance(1100);}
 assert.equal(new Set(player.loads).size,7);assert.equal(player.loads.length,7);
 assert.match(h.elements.get('playerStatus').textContent,/No playable clips/);
 h.click('stopButton');h.advance(10000);assert.equal(h.jobs.size,0);
});
test('autoplay blocking exposes manual play without changing the clip',async()=>{
 const h=harness();const player=await h.openToPlayer();
 player.options.events.onAutoplayBlocked();h.advance(25000);
 assert.equal(player.loads.length,1);assert.match(h.elements.get('playerStatus').textContent,/needs a tap/);
 h.click('playButton');assert.equal(h.elements.get('playCount').textContent,'1');
});
test('late API readiness after stop cannot create or start a player',async()=>{
 const h=harness({withAPI:false});await h.flush();h.click('giftButton');h.advance(16750);await h.flush();
 h.click('stopButton');h.context.YT={Player:class{constructor(){throw new Error('Must not create player');}}};
 h.context.onYouTubeIframeAPIReady();await h.flush();h.advance(20000);
 assert.equal(h.players.length,0);assert.equal(h.jobs.size,0);
});
test('a changed approved collection joins future playback without reloading the current clip',async()=>{
 const h=harness({collection:[...core.ORIGINAL_IDS,{id:'AbCdEfGhI01'}].map(item=>typeof item==='string'?{id:item,availability:'available'}:item)});
 const player=await h.openToPlayer();player.emit(1);
 for(let i=0;i<20;i++){player.emit(0);h.advance(500);player.emit(1);}
 assert.ok(player.loads.includes('AbCdEfGhI01'));assert.equal(h.players.length,1);
});
test('stopping during a delayed advance prevents playback from restarting',async()=>{
 const h=harness();const player=await h.openToPlayer();player.emit(0);h.click('stopButton');h.advance(60000);
 assert.equal(player.loads.length,1);assert.equal(h.jobs.size,0);
});
test('YouTube API network errors produce a clear fallback and allow retry',async()=>{
 const h=harness({withAPI:false});await h.flush();h.click('giftButton');h.advance(16750);await h.flush();
 const apiTag=h.context.document.head.children[0];apiTag.onerror();await h.flush();
 assert.match(h.elements.get('playerStatus').textContent,/YouTube could not load/);
 h.click('stopButton');assert.equal(h.jobs.size,0);
});
test('errors advance even when YouTube still exposes metadata for the previous clip',async()=>{
 const h=harness();const player=await h.openToPlayer();player.emit(1);
 const original=player.videoId;h.click('skipButton');player.videoId=original;
 player.fail(100);h.advance(1100);assert.equal(player.loads.length,3);
 h.click('stopButton');
});
test('late readiness from a destroyed player cannot affect a retry instance',async()=>{
 const h=harness();const oldPlayer=await h.openToPlayer();
 h.click('stopButton');h.click('restartButton');h.click('giftButton');h.advance(16750);await h.flush();
 const newPlayer=h.players[1];oldPlayer.ready();assert.equal(oldPlayer.destroyed,true);
 newPlayer.ready();assert.equal(newPlayer.loads.length,1);
 h.click('stopButton');assert.equal(h.jobs.size,0);
});
test('raw metadata never enters recipient loading text or the saved public cache',async()=>{
 const collection=core.ORIGINAL_IDS.map(id=>({id,availability:'available',title:'Bobby Raj video',channel:'Bobby Raj',thumbnail:'secret-metadata'}));
 const h=harness({collection});await h.openToPlayer();
 assert.ok(!/bobby|secret-metadata/i.test(h.elements.get('playerStatus').textContent));
 assert.ok(!/bobby|secret-metadata/i.test(h.context.localStorage.getItem('diwali-approved-playlist')));
 h.click('stopButton');
});
test('old browser metadata caches are scrubbed even when the backend is unreachable',async()=>{
 const h=harness({offline:true,cache:{savedAt:Date.now(),videos:[{id:'AbCdEfGhI01',title:'Bobby Raj',channel:'Bobby Raj',availability:'available'}]}});
 await h.flush();
 const saved=JSON.parse(h.context.localStorage.getItem('diwali-approved-playlist'));
 assert.deepEqual(Object.keys(saved.videos[0]).sort(),['availability','id']);
 const player=await h.openToPlayer();
 for(let i=0;i<20;i++){player.emit(0);h.advance(500);}
 assert.ok(player.loads.includes('AbCdEfGhI01'));h.click('stopButton');
});
