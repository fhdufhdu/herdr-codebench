import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
const helper = new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/editor-completion.js', import.meta.url), 'utf8'), { context });
await helper.link(() => {}); await helper.evaluate();
const { editOffset, textEdits, completionEdits, lineCommentPrefix, completionBounds, completionCandidates } = helper.namespace;
const small = completionBounds({ width: 200, height: 120, caretTop:24, caretHeight:24 }, 100, 30);
assert.equal(small.width,176); assert.equal(small.height,68); assert.equal(small.anchor,'top_left');
const low = completionBounds({ width: 500, height: 400, caretTop:360, caretHeight:24 }, 10, 30);
assert.equal(low.anchor,'bottom_left'); assert.equal(low.height,320);
const short = completionBounds({width:200,height:50,caretTop:0,caretHeight:24},100,30);
assert.equal(short.height,22);assert.equal(short.headerHeight,22);
assert.equal(completionBounds({width:0,height:0},2,30).height,0);
assert.equal(completionBounds({width:900,height:800,caretTop:72,caretHeight:40},2,32).anchor,'top_left','font/row height follows the measured cursor');
const range = (a,b) => ({ start:{line:0,character:a}, end:{line:0,character:b} });
assert.equal(editOffset('😀x\r\nnext',{line:1,character:2}),7);
assert.throws(() => editOffset('😀x',{line:0,character:1}),/Unicode/);
assert.throws(() => editOffset('x\r\n',{line:0,character:2}),/버퍼/);
assert.throws(() => textEdits('abc',[{range:range(0,2),newText:'a'},{range:range(1,3),newText:'b'}]),/겹치/);
assert.throws(() => textEdits('abc',[{range:range(0,0),newText:'a',uri:'file:///other'}]),/현재 문서/);
assert.throws(() => completionEdits('abc',{label:'bad',disabled_reason:'snippet unsupported'},3),/snippet/);
const item = { label:'hello',insert_text:'hello',text_edit:{range:range(6,8),newText:'hello'},additional_text_edits:[{range:range(0,0),newText:'import hello;\n'}] };
const atomic = completionEdits('const he',item,8);
assert.equal(atomic.edits.length,2); assert.equal(atomic.selection.head,25);
assert.equal(completionEdits('const 한글',{label:'한글이름'},8).edits[0].from,6);
assert.equal(lineCommentPrefix('test.kt'),'//'); assert.equal(lineCommentPrefix('test.sql'),'--'); assert.equal(lineCommentPrefix('test.unknown'),null);
assert.equal(completionCandidates('he',2,[{label:'other'},{label:'hello'}])[0].label,'hello');
assert.equal(completionCandidates('fo',2,[{label:'"foo"'},{label:'bar'}])[0].label,'"foo"');
assert.equal(completionCandidates('한',1,[{label:'한글'},{label:'other'}])[0].label,'한글');
assert.equal(completionCandidates('he',2,[...Array.from({length:150},()=>({label:'other'})),{label:'hello'}])[0].label,'hello','filter before capping the visible list');
const empty = {};
const bindings = {
 'gpui-kit':{View:class{},div:()=>{}},'gpui-base':{h_flex:()=>{},v_flex:()=>{},TextView:empty},
 herdr:{readTextFile:()=>{},writeTextFile:()=>{},window:()=>({}),shared:()=>{},setShared:()=>{}},
 './idea-design.js':Object.fromEntries(['ADE','adeUI','adeColors','adeSize','adeButton','adeTab','adeNote','adeManagedList','adeCompletionPopup','MenuController'].map(k=>[k,k==='ADE'?{}:()=>{}])),
 './ui-icons.js':{uiIcon:()=>{}},'./workspace.js':Object.fromEntries(['currentProject','documentState','selectDocument','closeDocument','openDocument','projectKey'].map(k=>[k,()=>{}])),
 './editor-document.js':Object.fromEntries(['documentKey','isDirty','markdownFile','sourceHTML','externalSource'].map(k=>[k,()=>{}])),
 './code-input.js':{CodeInput:class{}},'./lsp-session.js':{LspSession:class{}},'./idea-tokens.js':{IDEA_TOKENS:{}},'./editor-menu.js':{openEditorMenu:()=>{}},
};
bindings['./http-client.js'] = { isHttp: () => false, httpEnvs() {}, runHttp() {} };
bindings['./execution.js'] = { runConfiguration() {} };
Object.assign(bindings.herdr, { openOverlay() {}, run() {}, notify() {} });
bindings['./sql-assist.js'] = { SQLAssist: class { release() {} } };
bindings['./gutter-navigation.js'] = { GutterNavigation: class { sync() {} release() {} } };
const source = new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/text-editor.js',import.meta.url),'utf8'),{context});
await source.link(name=> name==='./editor-completion.js'?helper:new vm.SyntheticModule(Object.keys(bindings[name]),function(){for(const[k,v]of Object.entries(bindings[name]))this.setExport(k,v);},{context}));
await source.evaluate();
const editor = new source.namespace.default(), jobs=[], tasks=[], batches=[];
const cx={sleep:async()=>{},notify(){},stop_propagation(){},spawn(fn){tasks.push(Promise.resolve().then(()=>fn(cx)));}};
const drain=async()=>{while(jobs.length||tasks.length){while(jobs.length)jobs.shift()(cx);while(tasks.length)await tasks.shift();}};
editor.selected=doc=>doc===active; editor.syncLsp=()=>{}; editor.enqueue=job=>jobs.push(job);
let resolveReply, focused=0;
const doc={project:{},path:'/a/test.ts',state:{text:'const he',revision:0,head:8,value(){return this.text;},selection(){return {head:this.head};},focus(){focused++;},applyEdits(edits,_cx,options){assert.equal(options.expectedRevision,this.revision);batches.push({edits,options});this.revision++;return true;}},completionMenu:{at:0,ensureVisible(){},key(){this.at++;}}};
let active=doc;
doc.lsp={async editorRequest(kind){if(kind==='completion')return {revision:0,offset:8,value:{items:[item,{label:'help'}],resolve_supported:true,trigger_characters:['.']}};if(kind==='completion_resolve')return resolveReply??{revision:0,offset:8,value:item};return {revision:doc.state.revision,value:{edits:[{range:range(0,0),newText:'// formatted\n'}]}};}};
editor.complete(doc,{revision:0,offset:8},cx);assert.equal(doc.completion,null,'completion IO is deferred');await drain();
assert.equal(doc.completion.items.length,2);assert.equal(focused,0,'opening completion keeps native input focus');
assert.equal(editor.completionCommand(doc,'down',cx),true);assert.equal(batches.length,0,'arrow selects without editing');
doc.completionSelected='0';assert.equal(editor.completionCommand(doc,'tab',cx),true);await drain();
assert.equal(batches.length,1);assert.equal(batches[0].edits.length,2);assert.equal(focused,1);assert.equal(doc.completion,null);
// A revision change while resolving rejects both the primary edit and import.
doc.state.revision=0;editor.complete(doc,{revision:0,offset:8},cx);await drain();
let finish;resolveReply=new Promise(resolve=>{finish=resolve;});editor.acceptCompletion(doc,'0',cx);
await Promise.resolve();doc.state.revision=1;finish({value:item});await drain();assert.equal(batches.length,1);
// Formatting is one atomic batch and a queued request cannot cross documents.
resolveReply=null;editor.formatDocument(doc,{revision:1},cx);await drain();assert.equal(batches.length,2);assert.equal(batches[1].options.expectedRevision,1);
editor.formatDocument(doc,{revision:2},cx);active={};await drain();assert.equal(batches.length,2);
// Ordinary identifier typing triggers the first completion without a prior Ctrl+Space request.
active=doc;doc.state.text='const he';doc.state.head=8;doc.state.selection=()=>({head:8,start:8,end:8});doc.lspState={status:'ready'};
let timer, requested=0;editor.after=(_cx,ms,fn)=>{assert.equal(ms,180);timer={fn,cancel(){this.cancelled=true;}};return timer;};editor.complete=()=>{requested++;};
editor.triggerCompletion(doc,cx);assert.ok(timer);timer.fn(cx);assert.equal(requested,1);
editor.triggerCompletion(doc,cx);const previous=timer;editor.triggerCompletion(doc,cx);assert.equal(previous.cancelled,true,'typing coalesces requests');
doc.suppressCompletion=true;editor.triggerCompletion(doc,cx);assert.equal(timer.cancelled,true,'accepting an item does not trigger another list');
console.log('ADE completion: strict UTF16 edits, import+primary atomic batch, local focus/selection, stale resolve and formatting document guards passed');
