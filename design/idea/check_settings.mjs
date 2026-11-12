// Run: node --experimental-vm-modules design/idea/check_settings.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as actionRegistry from '../../mods/codenav/actions.js';
import * as toolbarModel from '../../mods/codenav/toolbar-model.js';
import * as toolLayout from '../../mods/codenav/tool-layout.js';
import * as keymapModel from '../../mods/codenav/keymap-model.js';
const context=vm.createContext({ console });
const handlers=new Map(), changes=[], tasks=[], closed=[];
const managedLists=new Map(), menus=new Map();
let managerOpens=0;
let keyBindings=[];
let readPreference=()=>{throw Error('unexpected preference read')};
let writePreference=()=>{throw Error('unexpected preference write')};
const treeRows=[];
const sharedState={'codenav.toolSides':{project:'left',terminal:'bottom',future:'right'},'codenav.toolHidden':['future']};
const settings={font_family:'Mono',font_size:14};
const el=()=>{let id;const proxy=new Proxy({}, {get:(_o,key)=>key==='when'?(condition,apply)=>condition?apply(proxy):proxy:(...args)=>{if(key==='id')id=args[0];if(key==='on_open_change')handlers.set(`${id}:open`,args[0]);if(key==='on_key_down')handlers.set(`${id}:key`,args[0]);return proxy}});return proxy};
const controls=(id,label,action,options={})=>{if(!options.disabled)handlers.set(id,action);else handlers.delete(id);return el().id(id);};
const exported=(name,values)=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context,identifier:name});
const tools={TOOLS:{project:{idea:'project',label:'Project'},terminal:{idea:'terminal',label:'Terminal'}},SIDES:{left:{label:'Left'},left2:{label:'Left Lower'},right:{label:'Right'},right2:{label:'Right Lower'},bottom:{label:'Bottom'}},DEFAULT_SIDES:{project:'left',terminal:'bottom'},currentSides:()=>({...sharedState['codenav.toolSides']}),hiddenTools:()=>new Set(sharedState['codenav.toolHidden']),arrange:want=>changes.push(JSON.parse(JSON.stringify(want)))};
const mocks={
'gpui-kit':{div:el},'gpui-base':{v_flex:el,h_flex:el,v_virtual_list:(_id,count,_height,_key,render)=>{render({start:0,end:count});return el()},Scrollbar:{vertical:el},Select:{new:id=>el().id(id)},Popup:{new:id=>el().id(id)},Input:{new:el},InputState:{new:()=>({set_value(v){this.v=v},value(){return this.v??''},events:{},on(name,action){this.events[name]=action},focus(){},release(){}})}},
herdr:{shared:k=>sharedState[k],setShared:(k,v)=>{sharedState[k]=v},settings:()=>settings,keys:()=>keyBindings,theme:()=>({}),run(){},props:()=>({overlay:'test'}),closeOverlay(id){closed.push(id)},openOverlay(){},appHome:()=>'/fake',readTextFile:(...args)=>readPreference(...args),writeTextFile:(...args)=>writePreference(...args)},
'./idea-design.js':{uiSize:()=>13,IDEA:{iconSize:16,rowHeight:22},MenuController:class{constructor(cx){this.focus=cx.focus_handle();this.scroll={};}ensureVisible(index){this.visible=index}release(){}},uiManagedList:(id,rows,controller,eventCx,options)=>{managedLists.set(id,{rows,controller,...options});for(const action of options.actions??[])if(!action.disabled)handlers.set(`${id}:${action.id}`,action.action);else handlers.delete(`${id}:${action.id}`);return el()},uiMenu:(id,rows,controller,eventCx,options)=>{menus.set(id,{rows,controller,...options});for(const row of rows)handlers.set(`${id}:${row.id}`,(e,cx)=>{options.onClose?.(e,cx);row.action?.(e,cx)});return el()},uiListRow:(id,children,options)=>{handlers.set(id,options.onClick);return el()},uiInputBox:el,uiButton:controls,uiToolbar:el,uiColors:()=>({}),uiCaption:el,uiSettingsShell:el,uiTreeRow:(id,label,options)=>{treeRows.push({id,label,...options});return el()},uiIconButton:(id,graphic,action,opts)=>controls(id,'',action,opts),uiCheckbox:controls,NOTIFICATION_GROUPS:[{id:'codenav.general',label:'General',defaults:{popup:true,log:true,sound:true}},{id:'herdr.agents',label:'Agents',defaults:{popup:false,log:true,sound:false}}]},
'./lsp-setup.js':{openLspSetup(){}},'./database.js':{openDatabaseManager(){managerOpens++}},
'./common.js':{icon:el,button:el,codeFont:()=>({family:'Mono',size:14})},'./i18n.js':{T:s=>s},'./tool-windows.js':tools,'./tool-layout.js':toolLayout,'./keymap-model.js':keymapModel,'./ideaicons.js':{toolImage:el},'./actions.js':actionRegistry,'./toolbar-model.js':toolbarModel};
const module=new vm.SourceTextModule(await readFile(new URL('../../mods/codenav/settings.js', import.meta.url),'utf8'),{context});
await module.link(id=>exported(id,mocks[id]));await module.evaluate();
const View=module.namespace.default,cx={focus_handle:()=>({focus(){},release(){}}),notify(){},stop_propagation(){},spawn(fn){tasks.push(fn(cx))}};
const selectTool=(v,name)=>{v.windowsBody(cx);managedLists.get('settings-window-list').onSelect(name,null,cx);v.windowsBody(cx)};
const create=()=>{const v=new View();v.init({page:'windows'},cx);selectTool(v,'project');return v};
let view;
const settingsSource=await readFile(new URL('../../mods/codenav/settings.js',import.meta.url),'utf8');
assert.doesNotMatch(settingsSource,/\b(?:toolbarsBody|customRows|editToolbar|addToolbarItem|customKey)\b/,'removed customization UI is not retained behind another page');
const removedPage=new View();removedPage.init({page:'toolbars'},cx);assert.equal(removedPage.page,'appearance');removedPage.sidebar();
assert.ok(!treeRows.some(row=>/Menus and Toolbars|Main Toolbar/.test(row.label)));removedPage.release();
sharedState['codenav.customization']={schemaVersion:1,groups:{future:{keep:true}}};
const preservedCustomization=JSON.stringify(sharedState['codenav.customization']);
keyBindings=[{section:'layout:idea',keys:'cmd-shift-space',action:'codenav.find-all'}, {section:'terminal',keys:'cmd-shift-space',action:'codenav.key:cmd-shift-space'}];
view=create();view.keyQuery='cmd-shift-space';view.keymapBody();
assert.equal(view.bindings().filter(row=>row.action==='codenav.find-all').length,1,'terminal forwarding does not duplicate the editable action');
assert.equal(view.bindings().find(row=>row.action==='codenav.find-all').label,'Search Everywhere');
assert.equal(view.bindings().find(row=>row.action==='codenav.find-all').group,'Navigation');
assert.ok(view.bindings().some(row=>row.action==='codenav.notifications-clear'&&!row.chords.length),'unassigned registered actions are editable');
assert.ok(managedLists.get('settings-keymap-list').rows.some(row=>row.label==='Search Everywhere'&&row.detail==='⌘⇧Space'));
console.log('PASS Search Everywhere keymap label, navigation group, modifier sequence and search');

sharedState['codenav.notificationPolicy']={future:7,groups:{'future.group':{sound:false}}};
view=create();view.notificationsBody();handlers.get('notify-policy-codenav.general-sound')(null,cx);
assert.equal(sharedState['codenav.notificationPolicy'].groups['codenav.general'],undefined,'notification policy is staged');
view.apply(cx);await Promise.all(tasks.splice(0));
assert.equal(sharedState['codenav.notificationPolicy'].groups['codenav.general'].sound,false);
assert.equal(sharedState['codenav.notificationPolicy'].future,7);
view=create();view.notificationsBody();handlers.get('notify-policy-restore')(null,cx);view.apply(cx);await Promise.all(tasks.splice(0));
assert.equal(sharedState['codenav.notificationPolicy'].groups['codenav.general'],undefined);
assert.equal(sharedState['codenav.notificationPolicy'].groups['future.group'].sound,false);
console.log('PASS notification group draft/Apply/default restore and future fields');

// Exercise both real save paths: retries must transform a fresh snapshot and
// retain staged shortcuts when validation or every write fails.
let raw=JSON.stringify({future:{keep:true}}), attempts=0, reads=0;
readPreference=async()=>{reads++;return raw};
writePreference=async(path,text,expected)=>{
  assert.equal(path,'/fake/keys.json'); assert.equal(expected,raw);
  if (++attempts===1) {raw=JSON.stringify({future:{keep:true},'mod:activity':{'cmd-p':'activity.preview'}});throw Error('stale snapshot')}
  raw=text;
};
view=create();view.pendingBindings=[{section:'layout:idea',chord:'cmd-k',action:'codenav.find-file',expected:null}];
await view.saveShortcuts();
assert.equal(attempts,2);assert.equal(reads,2);assert.equal(view.pendingBindings.length,0);
assert.equal(JSON.parse(raw)['mod:activity']['cmd-p'],'activity.preview');assert.equal(JSON.parse(raw).future.keep,true);
assert.equal(JSON.parse(raw)['layout:idea']['cmd-k'],'codenav.find-file');
attempts=0;writePreference=async()=>{attempts++;throw Error('write rejected')};
view.pendingBindings=[{section:'layout:idea',chord:'cmd-j',action:'codenav.find-class',expected:null}];
await assert.rejects(view.saveShortcuts(),/write rejected/);assert.equal(attempts,3);assert.equal(view.pendingBindings.length,1);
raw='{broken';attempts=0;reads=0;
await assert.rejects(view.saveShortcuts());assert.equal(reads,1);assert.equal(attempts,0);assert.equal(view.pendingBindings.length,1);
raw=JSON.stringify({'layout:idea':{'cmd-j':'other.action'}});reads=0;
await assert.rejects(view.saveShortcuts(),/changed since editing/);assert.equal(reads,1);assert.equal(attempts,0);

raw=JSON.stringify({future:{keep:true}});attempts=0;reads=0;
writePreference=async(path,text,expected)=>{
  assert.equal(path,'/fake/settings.json');assert.equal(expected,raw);
  if (++attempts===1) {raw=JSON.stringify({future:{keep:true},zoom:1.25});throw Error('stale snapshot')}
  raw=text;
};
view=create();view.draft.terminalFont='Updated Mono';view.apply(cx);await Promise.all(tasks.splice(0));
assert.ok(!view.error,view.error);assert.equal(attempts,2);assert.equal(reads,2);
assert.equal(JSON.parse(raw).font,'Updated Mono');assert.equal(JSON.parse(raw).zoom,1.25);assert.equal(JSON.parse(raw).future.keep,true);
console.log('PASS preference CAS retries, latest unrelated fields, bounded failure, parse/domain failure and pending shortcut preservation');

sharedState['codenav.toolSides']={project:'left',terminal:'left',future:'right'};
sharedState['codenav.toolOrder']={left:['future-tool','project','terminal'],futureSide:['future-tool']};
view=create();view.reorderWindowTool('terminal',-1,cx);
assert.deepEqual(Array.from(view.windowTools()),['terminal','project']);
assert.equal(sharedState['codenav.toolOrder'].left[1],'project','reorder and Cancel remain staged');
sharedState['codenav.toolOrder'].right=['future-concurrent'];
const layoutChanges=changes.length;view.apply(cx);await Promise.all(tasks.splice(0));
assert.ok(!view.error,view.error);assert.equal(changes.length,layoutChanges,'reordering does not move panels');
assert.deepEqual(Array.from(sharedState['codenav.toolOrder'].left),['terminal','project','future-tool']);
assert.deepEqual(sharedState['codenav.toolOrder'].right,['future-concurrent']);
assert.deepEqual(sharedState['codenav.toolOrder'].futureSide,['future-tool']);
view=create();view.reorderWindowTool('terminal',1,cx);
sharedState['codenav.toolOrder'].left=['future-other','project','terminal'];
view.apply(cx);await Promise.all(tasks.splice(0));assert.match(view.error,/changed in another window/);
assert.deepEqual(sharedState['codenav.toolOrder'].left,['future-other','project','terminal']);
console.log('PASS position groups, staged order, no layout churn, future items/sides and unrelated concurrent order preservation, same-group conflict');

keyBindings=[{section:'layout:idea',keys:'cmd-b',action:'codenav.definition'},{section:'terminal',keys:'cmd-b',action:'codenav.key:cmd-b'}];
raw=JSON.stringify({'layout:idea':{'cmd-b':'codenav.definition'},terminal:{'cmd-b':'codenav.key:cmd-b'},future:{keep:'yes'}});
writePreference=async(path,text,expected)=>{assert.equal(path,'/fake/keys.json');assert.equal(expected,raw);raw=text};
view=create();view.selectedBinding='layout:idea:codenav.definition';view.selectedChord='cmd-b';
view.beginShortcut(cx,'replace');view.newShortcut='cmd-shift-d';view.stageShortcut(cx);
assert.equal(view.error,null);assert.deepEqual(Array.from(view.bindings().find(row=>row.id===view.selectedBinding).chords),['cmd-shift-d']);
assert.equal(JSON.parse(raw)['layout:idea']['cmd-b'],'codenav.definition','replacement is staged until Apply');
await view.saveShortcuts();
assert.equal(JSON.parse(raw)['layout:idea']['cmd-b'],undefined);assert.equal(JSON.parse(raw).terminal['cmd-b'],undefined);
assert.equal(JSON.parse(raw).terminal['cmd-shift-d'],'codenav.key:cmd-shift-d');assert.equal(JSON.parse(raw).future.keep,'yes');
view.removeShortcut(cx);assert.equal(view.pendingBindings.length,1);await view.saveShortcuts();
assert.equal(JSON.parse(raw)['layout:idea']['cmd-shift-d'],undefined);assert.equal(JSON.parse(raw).terminal['cmd-shift-d'],undefined);
view.beginShortcut(cx);view.newShortcut='cmd-O';view.stageShortcut(cx);await view.saveShortcuts();
assert.equal(JSON.parse(raw)['layout:idea']['cmd-shift-o'],'codenav.definition','new shortcut is normalized and added');
assert.equal(JSON.parse(raw).terminal['cmd-shift-o'],'codenav.key:cmd-shift-o');
console.log('PASS real Settings add/replace/remove, draft isolation, normalized entry and atomic terminal bridge save');

keyBindings=[{section:'layout:idea',keys:'cmd-shift-o',action:'codenav.find-file'},{section:'terminal',keys:'cmd-shift-o',action:'codenav.terminal-files'}];
raw=JSON.stringify({'layout:idea':{'cmd-shift-o':'codenav.find-file'},terminal:{'cmd-shift-o':'codenav.terminal-files'}});
view=create();view.selectedBinding='terminal:codenav.terminal-files';view.selectedChord='cmd-shift-o';
assert.deepEqual(Array.from(view.bindings().find(row=>row.id===view.selectedBinding).chords),['cmd-shift-o'],'terminal-specific action is editable separately from editor Go to File');
view.beginShortcut(cx,'replace');view.newShortcut='cmd-shift-i';view.stageShortcut(cx);await view.saveShortcuts();
assert.equal(JSON.parse(raw)['layout:idea']['cmd-shift-o'],'codenav.find-file');
assert.equal(JSON.parse(raw).terminal['cmd-shift-i'],'codenav.terminal-files');
assert.equal(JSON.parse(raw).terminal['cmd-shift-o'],undefined);
console.log('PASS terminal-specific shortcut edit preserves editor shortcut');

// Drive the toolbar/detail callbacks, not the removed menus/toolbars page.
keyBindings=[{section:'layout:idea',keys:'ctrl-b',action:'codenav.definition'},{section:'layout:idea',keys:'cmd-b',action:'codenav.definition'},
  {section:'layout:idea',keys:'ctrl-r',action:'other.action'},{section:'terminal',keys:'ctrl-r',action:'terminal.keep'}];
raw=JSON.stringify({'layout:idea':{'ctrl-b':'codenav.definition','cmd-b':'codenav.definition','ctrl-r':'other.action'},terminal:{'ctrl-r':'terminal.keep'},future:{keep:true}});
readPreference=async()=>raw;writePreference=async(path,text,expected)=>{assert.equal(path,'/fake/keys.json');assert.equal(expected,raw);raw=text};
view=new View();view.init({page:'keymap'},cx);view.selectBinding('layout:idea:codenav.definition',cx);view.keymapBody(cx);
const keyList=()=>managedLists.get('settings-keymap-list');
assert.deepEqual(Array.from(keyList().actions,action=>action.id),['add','replace','remove']);
assert.ok(keyList().rows.some(row=>row.id===view.selectedBinding&&row.detail.includes('⌃B')&&row.detail.includes('⌘B')),'Ctrl and Meta remain distinct effective bindings');
handlers.get('keymap-chord-1')(null,cx);assert.equal(view.selectedChord,'cmd-b');
handlers.get('settings-keymap-list:replace')(null,cx);view.keymapBody(cx);
handlers.get('keymap-record:key')({key:'b',keystroke:'ctrl-shift-b'},cx);
assert.equal(view.newShortcut,'ctrl-shift-b','recording never replaces Ctrl with Meta');
view.keymapBody(cx);
handlers.get('keymap-shortcut-add')(null,cx);
assert.equal(view.selectedChord,'ctrl-shift-b');assert.equal(JSON.parse(raw)['layout:idea']['cmd-b'],'codenav.definition','recording/editing stays staged');
view.keymapBody(cx);handlers.get('settings-keymap-list:add')(null,cx);view.newShortcut='ctrl-r';view.stageShortcut(cx);
assert.match(view.error,/already assigned/);assert.equal(view.pendingBindings.length,2,'conflict keeps the earlier valid draft');
view.newShortcut='not-a-key';view.stageShortcut(cx);assert.ok(view.error);
const beforeBusy=JSON.stringify(view.pendingBindings);view.saving=true;
view.beginShortcut(cx);view.removeShortcut(cx);view.stageShortcut(cx);view.captureShortcut({key:'x',keystroke:'cmd-x'},cx);
assert.equal(JSON.stringify(view.pendingBindings),beforeBusy,'saving blocks keyboard and detail mutation paths');view.saving=false;
view.capturing=false;view.apply(cx);await Promise.all(tasks.splice(0));assert.ok(!view.error,view.error);
assert.equal(JSON.parse(raw)['layout:idea']['cmd-b'],undefined);assert.equal(JSON.parse(raw)['layout:idea']['ctrl-b'],'codenav.definition');
assert.equal(JSON.parse(raw)['layout:idea']['ctrl-shift-b'],'codenav.definition');assert.equal(JSON.parse(raw).terminal['ctrl-r'],'terminal.keep');
assert.equal(JSON.parse(raw)['layout:idea']['ctrl-r'],'other.action');assert.equal(JSON.parse(raw).future.keep,true);
view.keySearch.set_value('no action matches');view.keySearch.events.change(null,cx);view.keymapBody(cx);
assert.equal(keyList().rows.length,0);assert.equal(view.selectedBinding,null);assert.ok(keyList().actions.every(action=>action.disabled));
view.keySearch.set_value('');view.keySearch.events.change(null,cx);view.keymapBody(cx);assert.ok(view.selectedBinding);
view.selectBinding('layout:idea:codenav.definition',cx);view.keymapBody(cx);handlers.get('settings-keymap-list:remove')(null,cx);
assert.ok(view.selectedChord,'removing one of several assignments retains a real assignment selection');
const beforeKeyCancel=raw;view.render(cx);handlers.get('settings-cancel')(null,cx);assert.equal(raw,beforeKeyCancel);view.release();
const unassigned=new View();unassigned.init({page:'keymap'},cx);unassigned.selectBinding('layout:idea:codenav.notifications-clear',cx);unassigned.keymapBody(cx);
assert.equal(Boolean(keyList().actions.find(action=>action.id==='add').disabled),false);
assert.ok(keyList().actions.filter(action=>action.id!=='add').every(action=>action.disabled));
unassigned.beginShortcut(cx);unassigned.captureShortcut({key:'escape',keystroke:'escape'},cx);assert.equal(unassigned.capturing,false);assert.equal(unassigned.pendingBindings.length,0);
const beforeTextEntry=raw;unassigned.beginShortcut(cx);unassigned.shortcutInput.set_value('cmd-shift-9');unassigned.shortcutInput.events.change(null,cx);unassigned.shortcutInput.events.submit(null,cx);
assert.equal(unassigned.pendingBindings[0].chord,'cmd-shift-9','text input and submit use the real staging callbacks');
unassigned.render(cx);handlers.get('settings-cancel')(null,cx);assert.equal(raw,beforeTextEntry);unassigned.release();
assert.equal(JSON.stringify(sharedState['codenav.customization']),preservedCustomization,'removing page UI never deletes existing customization data');
console.log('PASS keymap shared toolbar/detail selection, recording/text/conflict, Ctrl-Meta distinction, busy guard, Apply/Cancel, empty/unassigned actions and preserved customization');

// Exercise the dedicated windows page through the callbacks it passes to the
// shared list and the native position selector, rather than mutating its draft.
sharedState['codenav.toolSides']={project:'left',terminal:'left',future:'right'};
sharedState['codenav.toolOrder']={left:['future-tool','project','terminal'],futureSide:['future-tool']};
sharedState['codenav.toolHidden']=['future-hidden'];
const newWindows=()=>{const v=new View();v.init({page:'windows'},cx);v.render(cx);assert.equal(v.page,'windows');return v};
const windowList=()=>managedLists.get('settings-window-list');
const chooseWindow=(v,id)=>{windowList().onSelect(id,null,cx);v.windowsBody(cx)};
const choosePosition=(v,side)=>{
  handlers.get('settings-window-position-select:open')(true,cx);
  v.windowsBody(cx);
  const menu=menus.get('settings-window-positions');
  assert.deepEqual(Array.from(menu.rows,row=>row.id),['left','left2','right','right2','bottom']);
  assert.equal(menu.controller.at,Object.keys(tools.SIDES).indexOf(v.draft.toolSides[v.windowSelected]));
  handlers.get(`settings-window-positions:${side}`)(null,cx);
  assert.equal(v.windowPositionOpen,false,'selection closes only the position popup');
  assert.equal(v.windowMenu.visible,v.windowRows().findIndex(row=>row.id===v.windowSelected),'moved item is revealed in its new group');
  v.windowsBody(cx);
};
view=newWindows();
assert.deepEqual(Array.from(windowList().rows,row=>row.id),['project','terminal']);
chooseWindow(view,'terminal');
assert.equal(view.windowSelected,'terminal');assert.equal(view.toolSide,'left');
handlers.get('settings-window-list:move-up')(null,cx);
assert.deepEqual(Array.from(view.windowTools('left')),['terminal','project']);
view.windowsBody(cx);assert.equal(windowList().actions.find(action=>action.id==='move-up').disabled,true);
assert.equal(windowList().actions.find(action=>action.id==='move-down').disabled,false);
handlers.get('settings-window-list:hide')(null,cx);
assert.ok(view.draft.toolHidden.includes('terminal'));
assert.deepEqual(sharedState['codenav.toolHidden'],['future-hidden']);
const cancelState=JSON.stringify(sharedState), cancelChanges=changes.length;
for(const side of ['left2','right','right2','bottom','left']){
  choosePosition(view,side);
  assert.equal(view.draft.toolSides.terminal,side);
  assert.equal(Object.values(view.draft.toolOrder).flat().filter(name=>name==='terminal').length,1,'moving never duplicates a tool');
  assert.equal(view.draft.toolOrder[side].at(-1),'terminal');
}
view.render(cx);handlers.get('settings-cancel')(null,cx);
assert.equal(closed.at(-1),'test');assert.equal(JSON.stringify(sharedState),cancelState);assert.equal(changes.length,cancelChanges);
view.release();
view=newWindows();assert.equal(view.draft.toolSides.terminal,'left');assert.ok(!view.draft.toolHidden.includes('terminal'));
chooseWindow(view,'terminal');
handlers.get('settings-window-list:move-up')(null,cx);view.windowsBody(cx);
assert.deepEqual(Array.from(view.windowTools('left')),['terminal','project']);
chooseWindow(view,'project');choosePosition(view,'right2');
handlers.get('settings-window-project-visible')(null,cx);
view.windowsBody(cx);assert.match(view.windowRows().find(row=>row.id==='project').detail,/Right Lower.*Hidden/);
view.windowQuery='right lower';view.windowsBody(cx);
assert.deepEqual(Array.from(windowList().rows,row=>row.id),['project']);
assert.ok(windowList().actions.filter(action=>action.id.startsWith('move-')).every(action=>action.disabled),'filtered lists cannot reorder a partial position group');
view.windowQuery='';view.windowsBody(cx);
sharedState['codenav.toolHidden'].push('future-concurrent-hidden');
sharedState['codenav.toolSides'].future='bottom';
sharedState['codenav.toolOrder'].right=['future-concurrent-order'];
const beforeWindowApply=changes.length;
view.render(cx);handlers.get('settings-apply')(null,cx);await Promise.all(tasks.splice(0));
assert.ok(!view.error,view.error);
assert.deepEqual(changes.slice(beforeWindowApply),[{project:'right2'}],'Apply moves only the tool with an edited position');
assert.equal(sharedState['codenav.toolSides'].terminal,'left');assert.equal(sharedState['codenav.toolSides'].future,'bottom');
assert.deepEqual(Array.from(sharedState['codenav.toolHidden']),['future-hidden','future-concurrent-hidden','project']);
assert.deepEqual(Array.from(sharedState['codenav.toolOrder'].left),['terminal','future-tool']);
assert.deepEqual(Array.from(sharedState['codenav.toolOrder'].right2),['project']);
assert.deepEqual(sharedState['codenav.toolOrder'].right,['future-concurrent-order']);
assert.deepEqual(sharedState['codenav.toolOrder'].futureSide,['future-tool']);
view.release();
view=newWindows();assert.equal(view.draft.toolSides.project,'right2');assert.ok(view.draft.toolHidden.includes('project'));
assert.deepEqual(Array.from(view.windowRows(),row=>row.id),['terminal','project']);
view.page='database';view.body({});handlers.get('settings-database-manage')(null,cx);assert.equal(managerOpens,1,'Database settings opens the real manager entry point');
view.release();
console.log('PASS dedicated windows shared-list selection/actions, five-position selector, within-position reorder, filtered guard, actual Cancel/Apply handlers, future/concurrent preservation and database manager routing');
