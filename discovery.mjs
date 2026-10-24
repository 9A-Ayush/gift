import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import core from './playlist.js';

export const QUERIES = [
  'Bobby Raj Josh Talks Shorts', 'Bobby Raj maths teacher Shorts',
  'Bobby Raj viral videos', 'Bobby Raj Josh Talks Hindi',
  'Bobby Raj funny edits and memes', 'Bobby Raj meme Shorts'
];
const CACHE_MS = 6 * 3600000, COOLDOWN_MS = 10 * 60000;
const DAILY_SEARCH_LIMIT = 6, MAX_CANDIDATES = 250;
const clean = value => typeof value === 'string' ? value.slice(0,1000).trim() : '';
const normalized = value => typeof value === 'string' ? value.slice(0,12000).normalize('NFKC').toLowerCase() : '';
export function seconds(duration) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration || '');
  return match ? (+match[1]||0)*3600+(+match[2]||0)*60+(+match[3]||0) : 0;
}
export function assess(video, referenceChannels = new Set()) {
  const snippet = video.snippet || {}, title = normalized(snippet.title);
  const text = normalized([snippet.title,snippet.description,...(snippet.tags||[])].join(' '));
  const name = /\bbobby\s*raj\b|\bboby\s*raj\b|बॉबी\s*राज|बोबी\s*राज/i;
  const context = /josh\s*talks|जोश\s*टॉक्स|maths?|mathematics|teacher|गणित|शिक्षक|पढ़ा|meme|funny|मीम/i;
  const child = /\bboy\b|\bchild\b|\bkid\b|\bprodigy\b|junior\s*khan|chot[ae]\s*khan|class\s*(?:3|iii)|बच्च|बालक|छोट[ाे]\s*खान|तीसरी/i;
  const maths = /\bmaths?\b|mathematics|गणित|पहा[ड़ड]|teaches\s*class\s*10|पढ़ा/i;
  const commentary = /\broast\b|\breaction\b|\bexposed\b|\bcommentary\b|\bcontroversy\b|पोल\s*खुल|रोस्ट|प्रतिक्रिया/i;
  const sameChannel = referenceChannels.has(snippet.channelId);
  const duration = seconds(video.contentDetails?.duration);
  const available = video.status?.privacyStatus === 'public'
    && video.status?.embeddable === true && video.status?.uploadStatus === 'processed'
    && snippet.liveBroadcastContent !== 'live'
    && !video.contentDetails?.regionRestriction
    && !video.contentDetails?.contentRating?.ytRating;
  // Metadata is a shortlist, never a claim that a person has been identified.
  const namedInMetadata = name.test(text), namedInTitle = name.test(title);
  const topic = context.test(text), referenceTopic = child.test(text) && maths.test(text);
  // A title is not a keyword gate. Description/tags can supply the name, while
  // a reference-channel + child/maths combination can retain uncertain matches.
  const relevant = (namedInMetadata && topic) || (sameChannel && referenceTopic);
  const score = (namedInTitle?5:namedInMetadata?4:0)+(topic?2:0)+(sameChannel?3:0)+(referenceTopic?2:0);
  const matchType = commentary.test(title) ? 'commentary' : namedInMetadata && referenceTopic ? 'possible_feature' : 'uncertain';
  return { eligible: available && duration > 0 && duration <= 180 && relevant,
    available, duration, score, matchType,
    reason: commentary.test(title) ? 'May discuss or react to the subject without featuring him. Preview carefully before approval.'
      : namedInMetadata ? 'Subject and topic signals across available metadata'+(sameChannel?'; reference-channel match':'')+'. Identity is unverified; human review required.'
      : 'Child/maths topic signals on a reference channel, without a confirmed name match. Identity is uncertain; human review required.' };
}
export function originalRecords() {
  return core.ORIGINAL_IDS.map((id,index)=>({ id,title:'Original reference '+(index+1),channel:'Reference metadata not loaded',
    thumbnail:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',url:'https://www.youtube.com/watch?v='+id,
    source:'original',decision:'approved',availability:'unknown',reason:'Manually supplied reference. Preserved permanently.' }));
}
function record(video, assessment, now) {
  const snippet = video.snippet;
  const thumbnail = snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '';
  return {id:video.id,title:clean(snippet.title),channel:clean(snippet.channelTitle),channelId:clean(snippet.channelId),
    thumbnail:/^https:\/\/i\.ytimg\.com\//.test(thumbnail)?thumbnail:'https://i.ytimg.com/vi/'+video.id+'/hqdefault.jpg',
    url:'https://www.youtube.com/watch?v='+video.id,duration:assessment.duration,source:'discovered',
    decision:'pending',availability:'available',identity:'unverified',score:assessment.score,reason:assessment.reason,matchType:assessment.matchType,
    discoveredAt:new Date(now).toISOString(),validatedAt:new Date(now).toISOString()};
}

export class Discovery {
  constructor({ apiKey = '', directory, fetcher = fetch, now = Date.now } = {}) {
    this.apiKey=apiKey.trim(); this.directory=directory; this.fetcher=fetcher; this.now=now;
    this.state={version:1,videos:originalRecords(),lastSuccess:null,lastAttempt:null,lastNew:0,status:'idle',
      message:'No discovery search yet.',cursor:0,runs:0,budget:{day:'',used:0}};
    this.flight=null; this.writes=Promise.resolve(); this.ready=this.load();
  }
  async load() {
    if (!this.directory) return;
    try {
      const saved=JSON.parse(await readFile(join(this.directory,'collection.json'),'utf8'));
      if(saved.version!==1||!Array.isArray(saved.videos)) throw new Error('Unsupported cache');
      const videos=saved.videos.filter(v=>core.validId(v.id));
      this.state={...this.state,...saved,videos:[...new Map([...originalRecords(),...videos].map(v=>[v.id,v])).values()]};
      // Originals cannot be removed or demoted by stale persisted review data.
      for(const v of this.state.videos)if(core.ORIGINAL_IDS.includes(v.id)){v.source='original';v.decision='approved';}
    } catch(error) {
      if(error.code!=='ENOENT'){this.state.status='warning';this.state.message='Saved collection could not be read. Originals are available; restore your backup before searching.';this.cacheBroken=true;}
    }
  }
  async save() {
    if(!this.directory)return;
    const snapshot=JSON.stringify(this.state,null,2);
    const work=this.writes.catch(()=>{}).then(async()=>{
      await mkdir(this.directory,{recursive:true});
      const file=join(this.directory,'collection.json');
      await writeFile(file+'.tmp',snapshot,{mode:0o600});await rename(file+'.tmp',file);
    });
    this.writes=work;await work;
  }
  publicPlaylist() {
    return { videos:this.state.videos.filter(v=>v.source==='original'||v.decision==='approved')
      .map(({id,availability})=>({id,availability})) };
  }
  snapshot() {
    const s=this.state, discovered=s.videos.filter(v=>v.source==='discovered');
    return { configured:!!this.apiKey,status:!this.apiKey?'configuration_required':s.status,
      message:!this.apiKey?'Discovery is off. Add YOUTUBE_API_KEY to .env and restart the server. The original seven clips remain available.':s.message,
      lastSuccess:s.lastSuccess,lastAttempt:s.lastAttempt,lastNew:s.lastNew,
      nextSearchAt:s.lastAttempt?new Date(Date.parse(s.lastAttempt)+COOLDOWN_MS).toISOString():null,
      counts:{total:s.videos.length,originals:s.videos.filter(v=>v.source==='original').length,
        discovered:discovered.length,pending:discovered.filter(v=>v.decision==='pending').length,
        approved:s.videos.filter(v=>v.decision==='approved').length,
        unavailable:s.videos.filter(v=>v.availability==='unavailable').length},
      searchesToday:s.budget.day===new Date(this.now()).toISOString().slice(0,10)?s.budget.used:0,
      dailySearchLimit:DAILY_SEARCH_LIMIT, videos:[...s.videos].sort((a,b)=>(b.score||0)-(a.score||0)) };
  }
  async request(endpoint,params) {
    const url=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
    // Server-only request: this URL and key are never sent to the browser or logged.
    url.searchParams.set('key',this.apiKey);
    let response;
    try { response=await this.fetcher(url,{signal:AbortSignal.timeout(12000)}); }
    catch { throw new Error('YouTube network request failed or timed out. Saved videos were kept.'); }
    if(!response.ok){
      if(response.status===403||response.status===429)throw new Error('YouTube rejected the request: check API enablement, key restrictions or quota. Saved videos were kept.');
      throw new Error('YouTube returned an API error. Saved videos were kept.');
    }
    let data;try{data=await response.json();}catch{throw new Error('YouTube returned invalid data. Saved videos were kept.');}
    if(!Array.isArray(data.items))throw new Error('YouTube returned invalid metadata. Saved videos were kept.');
    return data.items;
  }
  async refresh({force=false}={}) {
    await this.ready;
    if(!this.apiKey||this.cacheBroken)return this.snapshot();
    if(this.flight)return this.flight;
    const now=this.now(),s=this.state;
    if(s.lastAttempt&&now-Date.parse(s.lastAttempt)<COOLDOWN_MS)return {...this.snapshot(),message:'Saved results reused. Another search is allowed 10 minutes after the last attempt; no new API calls were made.'};
    if(!force&&s.lastSuccess&&now-Date.parse(s.lastSuccess)<CACHE_MS)return this.snapshot();
    this.flight=this.run().finally(()=>{this.flight=null;});
    return this.flight;
  }
  async run() {
    const s=this.state,now=this.now(),day=new Date(now).toISOString().slice(0,10);
    if(s.budget.day!==day)s.budget={day,used:0};
    if(s.budget.used+2>DAILY_SEARCH_LIMIT){s.status='quota_wait';s.message='Local daily limit reached (6 searches). Try after the next UTC day; saved videos remain playable.';return this.snapshot();}
    s.status='searching';s.lastAttempt=new Date(now).toISOString();s.lastNew=0;
    // Reserve calls durably before making any request; restarts do not reset the budget.
    s.budget.used+=2;
    try{
      await this.save();
      const references=await this.request('videos',{part:'snippet,contentDetails,status',id:core.ORIGINAL_IDS.join(',')});
      const channels=new Set(references.map(v=>v.snippet?.channelId).filter(Boolean));
      const candidates=new Set();
      for(let i=0;i<2;i++){
        const query=QUERIES[(s.cursor+i)%QUERIES.length];
        const results=await this.request('search',{part:'snippet',type:'video',q:query,
          videoDuration:'short',videoEmbeddable:'true',videoSyndicated:'true',maxResults:25,
          relevanceLanguage:'hi',order:s.runs%2?'date':'relevance',safeSearch:'moderate'});
        for(const v of results)if(core.validId(v.id?.videoId))candidates.add(v.id.videoId);
      }
      s.cursor=(s.cursor+2)%QUERIES.length;
      const old=s.videos.filter(v=>v.source!=='original');
      const ids=[...new Set([...old.map(v=>v.id),...candidates])];
      const details=[...references];
      for(let i=0;i<ids.length;i+=50)details.push(...await this.request('videos',{part:'snippet,contentDetails,status',id:ids.slice(i,i+50).join(',')}));
      const byId=new Map(details.map(v=>[v.id,v]));
      // Commit the collection only after every API stage succeeds.
      const updated=s.videos.map(v=>{
        const detail=byId.get(v.id);
        if(!detail)return {...v,availability:'unavailable',validatedAt:new Date(now).toISOString()};
        const assessment=assess(detail,channels);
        const info=record(detail,assessment,now);
        return {...v,title:info.title||v.title,channel:info.channel||v.channel,thumbnail:info.thumbnail,
          channelId:info.channelId,duration:info.duration,validatedAt:info.validatedAt,
          matchType:v.source==='original'?'reference':assessment.matchType,score:assessment.score,
          reason:v.source==='original'?v.reason:assessment.reason,
          availability:assessment.available?'available':'unavailable'};
      });
      const known=new Set(updated.map(v=>v.id));
      let added=0;
      for(const id of candidates){
        if(known.has(id)||updated.filter(v=>v.source==='discovered').length>=MAX_CANDIDATES)continue;
        const detail=byId.get(id);if(!detail||!detail.snippet?.title||!detail.snippet?.channelTitle)continue;
        const assessment=assess(detail,channels);
        if(!assessment.eligible)continue;
        updated.push(record(detail,assessment,now));known.add(id);added++;
      }
      s.videos=updated;s.lastNew=added;s.lastSuccess=new Date(now).toISOString();s.status='success';s.runs++;
      s.message=added?'Found '+added+' new candidate(s). Review them before adding to playback.':'Search completed. No new relevant candidates; your collection is unchanged.';
      await this.save();
    }catch{
      s.status='error';
      // No raw upstream errors, request URLs or credentials enter public responses.
      s.message='Discovery failed. Check your connection, YouTube API key, API enablement, restrictions and quota. Your existing collection and approvals were kept.';
      try{await this.save();}catch{s.message='Discovery could not save its cache. Check .data folder permissions; existing videos remain in memory.';}
    }
    return this.snapshot();
  }
  async review(id,decision) {
    await this.ready;
    if(!core.validId(id)||!['approved','rejected','removed','pending'].includes(decision))throw new Error('Invalid review action.');
    const video=this.state.videos.find(v=>v.id===id);
    if(!video||video.source==='original')throw new Error('Original references are protected; select a discovered video.');
    if(decision==='approved'&&video.availability!=='available')throw new Error('This video is currently unavailable. Refresh metadata before approving.');
    const previous=video.decision;
    video.decision=decision;video.reviewedAt=new Date(this.now()).toISOString();
    try{await this.save();}catch{video.decision=previous;throw new Error('Review could not be saved. Check the data directory.');}
    return this.snapshot();
  }
}
