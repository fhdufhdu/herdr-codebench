import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { find } from '../../mods/codenav/layout-tree.js';
import { orderedTools, ensureBottomSpan, hideEmptyToolColumns } from '../../mods/codenav/tool-layout.js';
import { navigationMarkers } from '../../mods/codenav/editor-model.js';
const markers=navigationMarkers(['@Service','class Service(', ' private val repo: UserRepository,', ') : BaseService {', ' override fun find() = repo.find()', '}'],'/Service.kt');
assert.ok(!markers.some(item=>item.kind==='spring'),'Spring markers come from the Go parser rather than file-wide annotation guessing');
assert.equal(markers.find(item=>item.kind==='super').name,'find');
assert.equal(navigationMarkers(['const a=1'],'/a.js').length,0);
const java=navigationMarkers(['class Concrete implements Base {',' @Override',' public String value() { return ""; }','}'],'/Concrete.java');
assert.equal(java[0].kind,'super');assert.equal(java[0].name,'value');
let tree=JSON.parse(await readFile(new URL('../../layouts/idea.json',import.meta.url),'utf8'));
assert.deepEqual(find(tree,'body').children.map(node=>node.id),['stripe','idea-content','stripe-right']);
assert.deepEqual(find(tree,'idea-content').children.map(node=>node.id),['idea-upper','terminal-panel']);
assert.deepEqual(find(tree,'idea-upper').children.map(node=>node.id),['sidebar','work-body','tool-right']);
assert.deepEqual(find(tree,'work-body').children.map(node=>node.id),['editor-area']);
const legacy={id:'root',type:'column',children:[{id:'main-toolbar'},{id:'body',type:'row',resizable:false,divider:{width:1,color:'custom'},children:[
  {id:'stripe',size:{px:40}},
  {id:'sidebar',size:{px:335},children:[{id:'left-main',size:{weight:1.30857},children:[{id:'sidebar-views',active:'view-files',children:[{id:'view-files'}]}]},
    {id:'left-aux',size:{weight:.69143},hidden:false,children:[{id:'left2-views',active:'bottom-notifications',children:[{id:'bottom-notifications',content:{mod:'codenav',props:{view:'notifications'}}}]}]}]},
  {id:'custom-neighbor',future:{keep:true},hidden:true},
  {id:'work-body',type:'column',size:{weight:1.7},min:80,resizable:true,divider:{width:2,color:'custom'},children:[
    {id:'editor-area',type:'column',size:{weight:3.80496},min:30,max:1500,hidden:false,children:[{id:'editor-stack',active:'editor-review',children:[{id:'editor-review',content:{mod:'codenav',props:{view:'review',part:'main'}}}]}]},
    {id:'terminal-panel',type:'column',size:{weight:1.19504},min:60,hidden:true,children:[{id:'bottom-stack',active:'bottom-problems',children:[{id:'bottom-problems'}]}]},
  ]},
  {id:'tool-right',size:{px:910},children:[{id:'right-views',active:'bottom-terminal',children:[{id:'bottom-terminal',content:{tab:'active',pane:{radius:10,gap:6,border:{width:0,color:'surface'}}}}]}]},
  {id:'stripe-right',size:{px:40}},
]},{id:'status-row',size:{px:24}}]};
const collect=(node,map=new Map())=>{map.set(node.id,node);for(const child of node.children??[])collect(child,map);return map;};
const previous=collect(legacy), snapshots=new Map([...previous].map(([id,node])=>[id,structuredClone(node)]));
assert.equal(ensureBottomSpan(legacy),true);
const migrated=collect(legacy);
for(const [id,node] of previous){
  assert.equal(migrated.get(id),node,`${id}: existing nodes retain identity`);
  const {children:beforeChildren,...beforeFields}=snapshots.get(id),{children:afterChildren,...afterFields}=node;
  assert.deepEqual(afterFields,beforeFields,`${id}: every existing size/state/unknown field survives`);
  if(!['body','work-body'].includes(id))assert.deepEqual(afterChildren?.map(child=>child.id),beforeChildren?.map(child=>child.id),`${id}: nested tool/terminal order survives`);
}
assert.deepEqual(find(legacy,'idea-upper').size,{weight:3.80496});
assert.equal(find(legacy,'idea-upper').min,30);assert.equal(find(legacy,'idea-upper').max,1500);
assert.equal(find(legacy,'idea-upper').resizable,false);assert.equal(find(legacy,'idea-content').resizable,true);
assert.deepEqual(find(legacy,'idea-content').divider,{width:2,color:'custom'});
assert.deepEqual(find(legacy,'idea-upper').children.map(node=>node.id),['sidebar','custom-neighbor','work-body','tool-right']);
assert.equal(find(legacy,'left2-views').active,'bottom-notifications');assert.equal(find(legacy,'left-aux').hidden,false);
const once=JSON.stringify(legacy);assert.equal(ensureBottomSpan(legacy),false);assert.equal(JSON.stringify(legacy),once,'migration is idempotent');
const custom=structuredClone(legacy);
// A conflicting wrapper id or an unfamiliar center is left intact.
find(custom,'idea-content').id='custom-content';find(custom,'idea-upper').id='custom-upper';
const unchanged=JSON.stringify(custom);assert.equal(ensureBottomSpan(custom),false);assert.equal(JSON.stringify(custom),unchanged);
const extra=structuredClone(snapshots.get('root'));find(extra,'work-body').children.push({id:'future-center',future:true});
const untouchedExtra=JSON.stringify(extra);assert.equal(ensureBottomSpan(extra),false);assert.equal(JSON.stringify(extra),untouchedExtra,'unfamiliar legacy center remains untouched');
const codebench=JSON.parse(await readFile(new URL('../../layouts/codebench.json',import.meta.url),'utf8'));
const oldCodebench=JSON.stringify(codebench);assert.equal(ensureBottomSpan(codebench),false);assert.equal(JSON.stringify(codebench),oldCodebench);
console.log('PASS full-width bottom shell, legacy custom widths/ratios/aux/active/hidden/terminal identity, safe refusal, idempotence and codebench isolation');
const store={}, actions=[];
const source=await readFile(new URL('../../mods/codenav/tool-windows.js',import.meta.url),'utf8');
const context=vm.createContext({console,Date,Math});
const overrides={find,orderedTools,hideEmptyToolColumns,layout:()=>structuredClone(tree),shared:k=>store[k],setShared:(k,v)=>{store[k]=v},run:(name,args)=>{actions.push([name,args]);if(name==='layout.set')tree=structuredClone(args.layout);else if(name==='layout.hide'||name==='layout.show')find(tree,args.id).hidden=name==='layout.hide';else if(name==='layout.select')find(tree,args.stack).active=args.child;},IDEA:{islandRadius:8,islandGap:4},icon:()=>({})};
const mod=new vm.SourceTextModule(source,{context});
await mod.link(id=>{const names=[...new Set([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].filter(m=>m[2]===id).flatMap(m=>m[1].split(',').map(name=>name.trim().split(/\s+as\s+/)[0])))];return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,overrides[name]??(()=>{}))},{context});});
await mod.evaluate();
const ui=mod.namespace;
const terminal=JSON.stringify(find(tree,'bottom-terminal').content);
ui.moveTool('structure','left2');
assert.equal(ui.sideOf('structure'),'left2');assert.equal(find(tree,'sidebar-views').active,'view-files');assert.equal(find(tree,'left2-views').active,'view-structure');assert.equal(find(tree,'left-aux').hidden,false);assert.equal(store['codenav.toolSides'].structure,'left2');
ui.moveTool('structure','right2');assert.equal(ui.sideOf('structure'),'right2');assert.equal(find(tree,'right-aux').hidden,false);assert.equal(find(tree,'tool-right').hidden,false);assert.equal(find(tree,'left-aux').hidden,true);
ui.moveTool('structure','bottom');assert.equal(ui.sideOf('structure'),'bottom');assert.equal(find(tree,'bottom-stack').active,'view-structure');assert.equal(find(tree,'tool-right').hidden,true);
assert.equal(JSON.stringify(find(tree,'bottom-terminal').content),terminal,'terminal payload preserved across moves');
ui.moveTool('structure','left2');assert.equal(ui.sideOf('structure'),'left2');
console.log('PASS JVM markers, left dual slots, moves between all edges, hidden slots and terminal preservation');
const left=Array.from(ui.toolsOn('left'));
store['codenav.toolOrder']={left:['future',...left.slice().reverse(),left[0]]};
assert.deepEqual(Array.from(ui.toolsOn('left')),left.slice().reverse(),'runtime stripe reads stored per-position order, omits unknowns and deduplicates');
assert.deepEqual(orderedTools(['new','old'],['old','future','old']),['old','new'],'new tools append without losing existing order');
console.log('PASS saved per-position tool order, missing/new names and duplicates');

// Exercise both secondary slots, serialized metadata, and the real hide/show
// command path. Use detached side metadata as callers may hold a snapshot.
ui.moveTool('database','right2');
for (const [upper,lower,outer,tool] of [['left','left2','sidebar','structure'],['right','right2','tool-right','database']]) {
  const top=ui.SIDES[upper], bottom=ui.SIDES[lower];
  find(tree,outer).size={px:387};
  find(tree,bottom.column).size={weight:.63};
  find(tree,bottom.stack).future={keep:'metadata'};
  const before=structuredClone(find(tree,outer));
  ui.hideSlot({...top});
  assert.equal(find(tree,outer).hidden,false,'one open secondary slot keeps its outer column');
  ui.hideSlot({...bottom});
  assert.equal(find(tree,outer).hidden,true,'last closed slot releases horizontal space');
  assert.equal(find(tree,bottom.stack).active,find(before,bottom.stack).active);
  ui.toggleTool(tool,true);
  assert.equal(find(tree,outer).hidden,false);
  assert.equal(find(tree,bottom.column).hidden,false);
  assert.equal(find(tree,top.column).hidden,true,'reopening lower slot leaves upper slot closed');
  assert.deepEqual(find(tree,outer).size,before.size);
  assert.deepEqual(find(tree,bottom.column).size,find(before,bottom.column).size);
  assert.deepEqual(find(tree,bottom.stack),find(before,bottom.stack),'active child, node payload and unknown metadata survive reopening');
}
assert.equal(JSON.stringify(find(tree,'bottom-terminal').content),terminal);
const stale=structuredClone(tree);
for(const id of ['left-main','left-aux','right-main','right-aux'])find(stale,id).hidden=true;
for(const id of ['sidebar','tool-right'])find(stale,id).hidden=false;
const staleBefore=structuredClone(stale);
assert.equal(hideEmptyToolColumns(stale),true);
for(const id of ['sidebar','tool-right'])find(staleBefore,id).hidden=true;
assert.deepEqual(stale,staleBefore,'normalization only changes the empty outer columns visibility');
assert.equal(hideEmptyToolColumns(stale),false,'empty-column repair is idempotent');
assert.equal(hideEmptyToolColumns(codebench),false);
assert.equal(JSON.stringify(codebench),oldCodebench,'codebench without IDEA split slots stays intact');
assert.equal(ui.DEFAULT_SIDES['run-results'],'bottom');
assert.equal(ui.TOOLS['run-results'].child,'bottom-run-results');
assert.equal(ui.TOOLS['run-results'].content.props.view,'run-results');
assert.equal(ui.TOOLS['run-results'].headerActions[0].command,'codenav.run-results-stop');
console.log('PASS empty outer repair, last-slot close, lower-slot reopen with sizes/active/payload preserved, codebench isolation and Run Results registry');
