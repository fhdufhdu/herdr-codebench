// Exercise the real mod client without native UI or real tokens/processes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../mods/codenav/lsp.js',import.meta.url),'utf8');
async function setup({platform='macos',arch='arm64',running=false,version='test-version',unowned=false,missing=false}={}){
 const calls=[],killed=[],http=[];let pid=41,liveVersion=version,requestError=null,rejectOnce=false;
 const base='/app/data/codebench-engine',os=platform==='macos'?'darwin':platform;
 const binary=`${base}/${os}-${arch}/herdr-engine${os==='windows'?'.exe':''}`;
 const terminal={address:'owned',name:'codenav-engine',argv:[unowned?'/other/program':binary],pid};
 const fixtureState=()=>JSON.stringify({pid,port:47822,engine:'herdr-codebench-go',token:'fixture-only'});
 const herdr={appHome:()=>'/app',home:()=>'/home',window:()=>({platform}),
  readTextFile:async path=>path.endsWith('manifest.json')?missing?null:JSON.stringify({version:'test-version',targets:[{os,arch}]}):running?fixtureState():null,
  exec:async(command,args)=>{calls.push([command,args]);return {code:0,stdout:command==='uname'?arch==='amd64'?'x86_64':'arm64':command==='powershell'?arch==='amd64'?'x64':'arm64':'herdr-engine test-version'}} ,
  hc:async args=>{calls.push(args);
   if(args[0]==='run'){running=true;pid=42;liveVersion='test-version';return {code:0,stdout:'{}'}}
   if(args[0]==='ls')return {stdout:JSON.stringify({terminals:[terminal,{address:'old',name:'codenav-lsp'},{address:'user',name:'codenav-lsp'}]})};
   if(args[0]==='get')return {stdout:JSON.stringify(args[1]==='owned'?terminal:args[1]==='old'?{name:'codenav-lsp',argv:['python3','-I','/app/mods/codenav/bridge/lsp_bridge.py']}:{name:'codenav-lsp',argv:['python3','/user/script.py']})};
   if(args[0]==='kill'){killed.push(args[1]);if(args[1]==='owned')running=false;return {code:0}}
   throw Error('unexpected hc');},
 };
 const context=vm.createContext({console,fetch:async(url,options)=>{
  assert.equal(options.headers['X-Codenav-Token'],'fixture-only');
  if(!running)throw Error('connect: refused');
  const method=url.split('/').at(-1);http.push(method);
  if(rejectOnce&&method!=='health'){rejectOnce=false;return {status:401,json:async()=>({ok:false,error:'invalid engine token'})}}
  return {status:200,json:async()=>method==='health'?{ok:true,result:{pid,engine:'herdr-codebench-go',version:liveVersion}}:requestError?{ok:false,error:requestError}:{ok:true,result:method==='tokens'?[]:{installed:true}}};
 }});
 const mod=new vm.SourceTextModule(source,{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(herdr),function(){for(const[k,v]of Object.entries(herdr))this.setExport(k,v)},{context}));await mod.evaluate();
 return {client:mod.namespace,calls,killed,http,error:value=>requestError=value,expire:()=>rejectOnce=true,binary};
}
let test=await setup();assert.equal(await test.client.peek('status'),null);assert.equal(test.calls.length,0,'status never launches engine');
await Promise.all([test.client.lsp('tokens',{},async()=>{}),test.client.lsp('info',{},async()=>{})]);
assert.equal(test.calls.filter(c=>c[0]==='run').length,1,'concurrent callers share one startup');
assert.deepEqual(test.killed,['old'],'only the exact old Python helper is retired');
assert.ok(test.calls.find(c=>c[0]==='run').includes(test.binary));
test.expire();await test.client.lsp('tokens',{},async()=>{});
assert.equal(test.calls.filter(c=>c[0]==='run').length,1,'401 reloads private state/manifest and reconnects to the healthy owned engine');
test.error('no matching language server');await assert.rejects(test.client.lsp('definition',{},async()=>{}),/no matching/);
assert.equal(test.calls.filter(c=>c[0]==='run').length,1,'language failures do not restart processes');
test=await setup({running:true,version:'old-version'});await test.client.lsp('info',{},async()=>{});
assert.deepEqual(test.killed,['owned','old'],'version update selects the exact engine binary and recorded PID');
test=await setup({running:true,version:'old-version',unowned:true});await assert.rejects(test.client.lsp('info',{},async()=>{}),/left running/);
assert.equal(test.killed.length,0,'unknown port owner is preserved');
test=await setup({platform:'windows',arch:'amd64'});await test.client.lsp('info',{},async()=>{});
assert.ok(test.calls.some(c=>c[0]==='powershell'));assert.ok(test.binary.endsWith('windows-amd64/herdr-engine.exe'));
test=await setup({missing:true});await assert.rejects(test.client.lsp('info',{},async()=>{}),/not installed/);
assert.equal(test.calls.length,0,'missing binary never starts a Python fallback');
test=await setup({running:true});test.error('network reply lost');
await assert.rejects(test.client.lsp('db_apply',{database:{changes:[{op:'insert',values:{id:1}}]}},async()=>{}),/could not be confirmed/);
assert.equal(test.http.filter(method=>method==='db_apply').length,1,'a lost database reply must never replay a potentially committed write');
console.log('PASS native Go client host selection, single startup, version/PID ownership, legacy retirement, error propagation and passive polling');
