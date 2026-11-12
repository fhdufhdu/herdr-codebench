// Run: node design/idea/check_shortcuts.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Preserve the existing plain-node test command while exercising real modules.
if (typeof vm.SourceTextModule !== 'function') {
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(result.status ?? 1);
}

const bindings=JSON.parse(await readFile(new URL('../../keys.json',import.meta.url),'utf8'));
assert.equal(bindings['layout:idea']['cmd-shift-space'],'codenav.find-all');
assert.equal(bindings.terminal['cmd-shift-space'],'codenav.key:cmd-shift-space');
assert.equal(bindings['layout:idea']['cmd-shift-o'],'codenav.find-file');
assert.equal(bindings.terminal['cmd-shift-o'],'codenav.terminal-files');
assert.equal(bindings['layout:idea']['shift shift'],undefined);
assert.equal(bindings.terminal['shift shift'],undefined);
assert.equal(bindings.global['shift shift'],undefined,'other layouts keep their own search behavior');
const source=await readFile(new URL('../../mods/codenav/status.js',import.meta.url),'utf8');
// Run the actual Status command consumer with the actual pure action registry.
// Do not slice private source functions or duplicate their action/key tables.
let layout='idea', documentState=null, area=null, reviewState=null, stackChild='editor-code';const opened=[],searches=[],sent=[],ran=[],settingsOpened=[],setupOpened=[],terminalFiles=[],tasks=[],commands=[];
let chooseFolder=async()=>null, reportNotice=()=>{throw Error('unexpected failure')};const diagnosticAttachments=[];
let effectiveBindings=Object.entries(bindings).flatMap(([section,values])=>Object.entries(values).map(([keys,action])=>({section,keys,action})));
const queue=[
  {layout:'idea',key:'cmd-shift-space'}, {layout:'idea',key:'cmd-shift-o',command:'terminal-files'},
  {layout:'idea',key:'cmd-O',command:'terminal-files'}, {layout:'idea',key:'cmd-shift-O',command:'terminal-files'},
  {layout:'idea',key:'cmd-shift-o',command:'find-file'},
  {layout:'codebench',key:'shift shift'}, {layout:'codebench',key:'ctrl-e'},
  {layout:'codebench',key:'ctrl--'}, {layout:'codebench',key:'ctrl-k ctrl-s'},
  {layout:'codebench',key:'cmd-O',command:'terminal-files'}, {layout:'codebench',key:'cmd-shift-o'}, {layout:'idea',key:'cmd-,'},
  {layout:'idea',key:'cmd-shift-,'},
  {layout:'idea',key:'cmd-alt-q',binding:'codenav.find-file'},
  {layout:'idea',key:'cmd-alt-q',reassign:'codenav.find-class'},
  {layout:'idea',key:'cmd-alt-j',binding:'codenav.definition',section:'mod:codenav',document:{kind:'file',path:'/repo/Main.kt'}},
  {layout:'idea',key:'cmd-alt-k',binding:'codenav.review-next-diff',document:{kind:'file',path:'/repo/Main.kt'},area:'review'},
  {layout:'idea',key:'cmd-alt-s',binding:'activity.save',section:'mod:activity',document:{kind:'file',path:'/repo/Main.kt',edit:true}},
  {layout:'idea',key:'cmd-alt-j',document:{kind:'file',path:'/repo/Main.kt'},area:'review'},
  {layout:'idea',key:'cmd-alt-u',binding:'codenav.usages',section:'mod:codenav',document:{kind:'file',path:'/repo/Other.kt',edit:true},area:'review',stack:'editor-review',review:{rkey:':/repo',path:'Main.kt',space:'test'}},
  {layout:'idea',key:'cmd-alt-u',area:'review',stack:'editor-review',review:{rkey:'ssh:/repo',path:'Main.kt',space:'test'}},
  {layout:'idea',key:'cmd-alt-u',area:'review',stack:'editor-code',review:{rkey:':/repo',path:'Main.kt',space:'test'}},
  {layout:'idea',key:'cmd-alt-q',reassign:'personal.jump'},
  {layout:'idea',key:'cmd-alt-q',reassign:'send:literal'},
  {layout:'idea',key:'cmd-alt-q',reassign:'terminal'},
  {layout:'idea',command:'settings'},
  {layout:'idea',command:'settings:editor'},
  {layout:'idea',command:'lsp-setup'},
  {layout:'idea',key:'cmd-alt-l',binding:'codenav.lsp-setup'},
  {layout:'idea',command:'find-symbol:pkg:Name'},
  {layout:'idea',command:'find-action'},
  {layout:'idea',command:'find-recent'},
  {layout:'idea',command:'find-locations'},
  {layout:'idea',command:'find-unknown:fallback'},
  {layout:'idea',command:'attach-diagnostics:'+JSON.stringify({space:'one',entries:[{path:'/repo/Test.ts',diagnostic:{message:'Nested\nType error'}}]})},
];
const done=Error('end of test commands');
const context=vm.createContext({console});
const overrides={
  shared:key=>key==='layout'?layout:key==='codenav.area'?area:key==='codenav.review.current'?reviewState:null,focused:()=>({terminal:'test'}),
  editorSpec:()=>documentState,
  layout:()=>({}),find:(_tree,id)=>id==='editor-stack'?{active:stackChild}:null,wantedChild:()=>stackChild,
  keys:()=>effectiveBindings,openEverywhere:(mode,query)=>{opened.push(mode);searches.push([mode,query])},openIdeaSettings:page=>settingsOpened.push(page??'mode'),openLspSetup:()=>setupOpened.push('setup'),
  showTerminalFiles:id=>terminalFiles.push(id),hc:async args=>{sent.push(Array.from(args));return {code:0}},
  uiNotify:note=>reportNotice(note),run:(name,args)=>{ran.push(name);commands.push([name,args])},T:s=>s,
  pickFolder:options=>chooseFolder(options),
  handleDiagnosticAttachment:(payload,cx)=>diagnosticAttachments.push({payload,cx}),
  nextCommand:async()=>{const item=queue.shift();if(!item)throw done;layout=item.layout;
    documentState=item.document??null;area=item.area??null;reviewState=item.review??null;stackChild=item.stack??'editor-code';
    if(item.binding)effectiveBindings.push({section:item.section??'layout:idea',keys:item.key,action:item.binding});
    if(item.reassign)effectiveBindings=effectiveBindings.map(binding=>binding.section==='layout:idea'&&binding.keys===item.key?{...binding,action:item.reassign}:binding);
    return item.command??`key:${item.key}`;},
};
const registry=new vm.SourceTextModule(await readFile(new URL('../../mods/codenav/actions.js',import.meta.url),'utf8'),{context});
await registry.link(()=>{throw Error('registry must stay pure')});await registry.evaluate();
const consumer=new vm.SourceTextModule(source,{context});
await consumer.link(id=>{
  if(id==='./actions.js')return registry;
  const names=[...new Set([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].filter(match=>match[2]===id)
    .flatMap(match=>match[1].split(',').map(name=>name.trim().split(/\s+as\s+/)[0])))];
  return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,overrides[name]??(()=>{}))},{context});
});
await consumer.evaluate();
const status=new consumer.namespace.default();
status.init({}, {spawn(fn){tasks.push(fn({notify(){}}))},timer:{after(){},every(){}},notify(){}});
await assert.rejects(tasks[0],error=>error===done);
assert.deepEqual(opened,['all','files','files','classes','symbols','actions','recent','locations','all']);
assert.deepEqual(searches.slice(-5),[['symbols','pkg:Name'],['actions',''],['recent',''],['locations',''],['all','fallback']],'shared opener preserves query colons, search modes and unknown-kind fallback');
assert.deepEqual(sent,[['keys','test','ctrl+e'],['keys','test','ctrl+-'],['keys','test','ctrl+k','ctrl+s'],['send','test','literal'],['keys','test','cmd+alt+q']]);
assert.deepEqual(terminalFiles,['test','test','test','test','test'],'terminal CmdShiftO opens terminal paths in both layouts; editor command separately opens project files');
assert.deepEqual(ran,['app.settings','codenav.definition','codenav.review-next-diff','codenav.save','codenav.usages','personal.jump']);assert.deepEqual(settingsOpened,['mode','mode','editor']);
assert.deepEqual(setupOpened,['setup','setup'],'direct and reassigned terminal actions share the LSP setup opener');
assert.equal(diagnosticAttachments.length,1);assert.equal(diagnosticAttachments[0].payload.entries[0].diagnostic.message,'Nested\nType error','Status forwards full diagnostic attachment payload to the persistent task owner');
console.log('PASS actual Status routing, shifted-letter aliases, terminal reassignment, source/review/activity owners, capability guard and other-layout input preservation');

const folderTasks=[], folderCx={spawn(fn){folderTasks.push(fn(folderCx))}};
let finishPicker, pickerCalls=0;
chooseFolder=()=>{pickerCalls++;return new Promise(resolve=>{finishPicker=resolve})};
status.openFolder(folderCx);status.openFolder(folderCx);
assert.equal(pickerCalls,1,'only one native picker can be active');
finishPicker('/local/project');await Promise.all(folderTasks.splice(0));
assert.equal(commands.at(-1)[0],'space.new');
assert.deepEqual(JSON.parse(JSON.stringify(commands.at(-1)[1])),{folder:'/local/project',machine:''},'local picker must not open a same-named path on the active remote machine');
assert.equal(status.openingFolder,false);
const count=commands.length;chooseFolder=async()=>null;
status.openFolder(folderCx);await Promise.all(folderTasks.splice(0));
assert.equal(commands.length,count,'cancel creates no space');
const notices=[];reportNotice=note=>notices.push(note);chooseFolder=async()=>{throw Error('picker failed')};
status.openFolder(folderCx);await Promise.all(folderTasks.splice(0));
assert.equal(notices.length,1);assert.equal(notices[0].level,'error');assert.match(notices[0].body,/picker failed/);
assert.equal(status.openingFolder,false,'a failed picker can be retried');
console.log('PASS persistent folder picker ownership, duplicate guard, local machine, cancel, visible failure and retry');

const directory=await mkdtemp(join(tmpdir(),'herdr-shortcut-install-'));
try {
  const sourcePath=join(directory,'defaults.json'), target=join(directory,'keys.json');
  await writeFile(sourcePath,JSON.stringify(bindings));
  const original=JSON.stringify({global:{'cmd-t':'tab.new'},'layout:idea':{'cmd-o':'personal.action','shift shift':'codenav.find-all'},terminal:{'shift shift':'codenav.key:shift shift'}},null,2);
  await writeFile(target,original,{mode:0o600});
  const installer=fileURLToPath(new URL('./install_keys.py',import.meta.url));
  const install=()=>spawnSync('python3',[installer,sourcePath,target],{encoding:'utf8'});
  let result=install();assert.equal(result.status,0,result.stderr);
  let installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed.global['cmd-t'],'tab.new');
  assert.equal(installed['layout:idea']['cmd-o'],'personal.action','existing shortcuts win');
  assert.equal(installed['layout:idea']['cmd-shift-space'],'codenav.find-all');
  assert.equal(installed.terminal['cmd-shift-space'],'codenav.key:cmd-shift-space');
  assert.equal(installed.terminal['cmd-shift-o'],'codenav.terminal-files');
  assert.equal(installed['layout:idea']['shift shift'],undefined);
  assert.equal(installed.terminal['shift shift'],undefined);
  assert.ok(result.stdout.includes('Kept your existing shortcut: layout:idea: cmd-o'));
  assert.equal((await stat(target)).mode&0o777,0o600);
  let backups=(await readdir(directory)).filter(name=>name.startsWith('keys.json.backup-'));
  assert.equal(backups.length,1);assert.equal(await readFile(join(directory,backups[0]),'utf8'),original);
  const first=await readFile(target,'utf8');result=install();assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(target,'utf8'),first);assert.equal((await readdir(directory)).filter(name=>name.startsWith('keys.json.backup-')).length,1);
  await writeFile(target,JSON.stringify({'layout:idea':{'shift shift':'personal.gesture'},terminal:{'shift shift':'personal.terminal'}}));
  result=install();assert.equal(result.status,0,result.stderr);installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed['layout:idea']['shift shift'],'personal.gesture');
  assert.equal(installed.terminal['shift shift'],'personal.terminal','only the retired shipped gesture is migrated');
  await writeFile(target,JSON.stringify({'layout:idea':{'cmd-O':'personal.open'},terminal:{'cmd-O':'personal.terminal'}}));
  result=install();assert.equal(result.status,0,result.stderr);installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed['layout:idea']['cmd-O'],'personal.open');
  assert.equal(installed['layout:idea']['cmd-shift-o'],undefined,'equivalent default spelling cannot override a personal shifted-letter binding');
  assert.equal(installed.terminal['cmd-O'],'personal.terminal');assert.equal(installed.terminal['cmd-shift-o'],undefined);
  await writeFile(target,JSON.stringify({'layout:idea':{'cmd-O':'codenav.find-file'},terminal:{'cmd-O':'codenav.key:cmd-O'}}));
  result=install();assert.equal(result.status,0,result.stderr);installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed['layout:idea']['cmd-shift-o'],undefined);assert.equal(installed.terminal['cmd-shift-o'],undefined);
  assert.equal(installed.terminal['cmd-O'],'codenav.terminal-files','equivalent old bridge migrates to terminal-specific file search');
  await writeFile(target,JSON.stringify({terminal:{'cmd-shift-O':'codenav.key:cmd-O'}}));
  result=install();assert.equal(result.status,0,result.stderr);installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed.terminal['cmd-shift-O'],'codenav.terminal-files','equivalent payload spelling migrates');
  await writeFile(target,JSON.stringify({terminal:{'cmd-O':'codenav.key:cmd-o','cmd-shift-o':'personal.direct'}}));
  result=install();assert.equal(result.status,0,result.stderr);installed=JSON.parse(await readFile(target,'utf8'));
  assert.equal(installed.terminal['cmd-O'],'codenav.key:cmd-o','a different forwarded chord is personal and survives');
  assert.equal(installed.terminal['cmd-shift-o'],'personal.direct','custom direct terminal actions survive');
  await writeFile(target,'invalid json');result=install();assert.notEqual(result.status,0);assert.equal(await readFile(target,'utf8'),'invalid json');
  await rm(target);result=install();assert.notEqual(result.status,0);assert.ok(result.stderr.includes('Start Herdr once'));
  console.log('PASS portable install, conflict preservation, backup, permissions, idempotence and invalid/missing-file protection');
} finally { await rm(directory,{recursive:true,force:true}); }
