/* Shared, dependency-free queue used by browser and backend. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GiftPlaylist=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ORIGINAL_IDS=Object.freeze(['sbgbQOFZxwU','QzglAEnoItc','j-QKwKd_zCc','nfWV_-BKxVs','Th6cjjS2KTY','Vxcrer2Dw2k','zQ3MjNbE24k']);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id);
function shuffle(items,random=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
class Queue{
 constructor(ids=ORIGINAL_IDS,random=Math.random){this.random=random;this.ids=[];this.bag=[];this.last=null;this.update(ids);}
 update(ids){this.ids=[...new Set(ids.filter(validId))];this.bag=this.bag.filter(id=>this.ids.includes(id));}
 next(blocked=new Set()){
  const eligible=this.ids.filter(id=>!blocked.has(id));if(!eligible.length)return null;
  this.bag=this.bag.filter(id=>eligible.includes(id));if(!this.bag.length)this.bag=shuffle(eligible,this.random);
  if(this.bag[0]===this.last&&eligible.length>1){const other=this.bag.findIndex(id=>id!==this.last);if(other<0)this.bag=shuffle(eligible.filter(id=>id!==this.last),this.random);else [this.bag[0],this.bag[other]]=[this.bag[other],this.bag[0]];}
  this.last=this.bag.shift();return this.last;
 }
}
return {ORIGINAL_IDS,validId,shuffle,Queue};
});
