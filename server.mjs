import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Discovery } from './discovery.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const PUBLIC=new Map([['/','index.html'],...['index.html','style.css','script.js','playlist.js','owner.html','owner.js'].map(name=>['/'+name,name])]);
const TYPES={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8'};
function respond(res,status,body,type='application/json; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'strict-origin-when-cross-origin','Cross-Origin-Resource-Policy':'same-origin',
    'X-Frame-Options':'SAMEORIGIN'});
  res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
}
function authorized(req,token){
  const received=Buffer.from(req.headers.authorization||'');
  const expected=Buffer.from('Bearer '+token);
  return received.length===expected.length&&timingSafeEqual(received,expected);
}
async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('JSON required');
  let content='';for await(const chunk of req){content+=chunk;if(content.length>2048)throw new Error('Request too large');}
  return JSON.parse(content);
}
export function createApp({discovery,token,root=ROOT}){
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(!['GET','HEAD','POST'].includes(req.method))return respond(res,405,{error:'Method not allowed.'});
      if(path.startsWith('/api/owner/')){
        if(!authorized(req,token))return respond(res,401,{error:'Enter your owner token to manage the collection.'});
        if(req.headers.origin&&req.headers.origin!==('http://'+req.headers.host)&&req.headers.origin!==('https://'+req.headers.host))
          return respond(res,403,{error:'Cross-origin requests are not allowed.'});
        if(path==='/api/owner/discovery'&&req.method==='GET'){await discovery.ready;return respond(res,200,discovery.snapshot());}
        if(path==='/api/owner/refresh'&&req.method==='POST'){await body(req);return respond(res,200,await discovery.refresh({force:true}));}
        if(path==='/api/owner/review'&&req.method==='POST'){
          const action=await body(req);
          try{return respond(res,200,await discovery.review(action.id,action.decision));}
          catch(error){return respond(res,400,{error:error.message});}
        }
        return respond(res,404,{error:'API route not found.'});
      }
      if(path==='/api/playlist'&&req.method==='GET'){
        await discovery.ready;
        // Reuse saved clips immediately; refresh only when the shared cache is stale.
        void discovery.refresh().catch(()=>{});
        return respond(res,200,discovery.publicPlaylist());
      }
      if(req.method==='GET'||req.method==='HEAD'){
        const file=PUBLIC.get(path);
        if(!file)return respond(res,404,'Not found','text/plain; charset=utf-8');
        const content=await readFile(join(root,file));
        return respond(res,200,req.method==='HEAD'?'':content,TYPES[file.split('.').pop()]);
      }
      return respond(res,404,{error:'Not found.'});
    }catch{return respond(res,400,{error:'The request could not be processed.'});}
  });
}
export async function start(){
  const directory=join(ROOT,'.data');await mkdir(directory,{recursive:true});
  let token=process.env.OWNER_TOKEN?.trim();
  if(!token){
    const file=join(directory,'owner-token.txt');
    try{token=(await readFile(file,'utf8')).trim();}catch{}
    if(!token){token=randomBytes(32).toString('hex');await writeFile(file,token,{mode:0o600});}
    console.log('Owner token: saved in .data/owner-token.txt (never served to browsers).');
  }
  const discovery=new Discovery({apiKey:process.env.YOUTUBE_API_KEY||'',directory});
  await discovery.ready;
  const server=createApp({discovery,token});
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  console.log('Diwali Gift: http://'+host+':'+server.address().port);
  console.log('Gift curator: http://'+host+':'+server.address().port+'/owner.html');
  console.log(process.env.YOUTUBE_API_KEY?'YouTube discovery configured.':'Discovery off: set YOUTUBE_API_KEY in .env, then restart.');
  void discovery.refresh().catch(()=>{});
  return {server,discovery};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  start().catch(()=>{console.error('Server could not start. Check PORT, environment settings and .data permissions.');process.exitCode=1;});
}
