import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Discovery} from '../discovery.mjs';
test('secret and runtime files are ignored, and frontend files contain no Google API key',async()=>{
 const root=new URL('../',import.meta.url);
 const ignore=await readFile(new URL('.gitignore',root),'utf8');
 assert.ok(ignore.split(/\r?\n/).includes('.env'));
 assert.ok(ignore.split(/\r?\n/).includes('.env.*'));
 assert.ok(ignore.split(/\r?\n/).includes('.data/'));
 for(const file of ['index.html','script.js','style.css','owner.html','owner.js','playlist.js']){
  const content=await readFile(new URL(file,root),'utf8');
  assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(content),file+' must not contain an API key');
 }
});
test('cooldown reports that saved results were reused rather than inventing another search',async()=>{
 const d=new Discovery({apiKey:'test'});
 d.state.lastAttempt=new Date().toISOString();d.state.lastSuccess=d.state.lastAttempt;
 const result=await d.refresh({force:true});
 assert.match(result.message,/no new API calls/);assert.equal(result.searchesToday,0);
});
test('all public source, HTML metadata and login screen omit the internal subject name',async()=>{
 for(const file of ['index.html','owner.html','script.js','owner.js','playlist.js','style.css']){
  const content=await readFile(new URL('../'+file,import.meta.url),'utf8');
  assert.ok(!/bobby|boby|बॉबी|बोबी/i.test(content),file+' reveals internal subject information');
 }
});
