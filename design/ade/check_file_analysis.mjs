import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const saved = new Map(), context = { id: 'owned', root: '/owned' };
let path = '/owned/a.kt', notified = 0;
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
const bindings = {
  'gpui-kit': { div: element }, 'gpui-base': { v_flex: element },
  herdr: { shared: key => saved.get(key), setShared: (key,value) => saved.set(key,value), closeOverlay() {} },
  './workspace.js': { currentProject: () => context, projectKey: value => value.id, documentState: () => ({ active:path }) },
  './idea-design.js': { adeButton: element, adeNote: element, adeDialog: element, uiSpinner: element }, './ui-icons.js': { uiIcon: element },
};
const sandbox = vm.createContext({});
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/file-analysis.js',import.meta.url),'utf8'),{ context:sandbox });
await module.link(name => { assert.ok(bindings[name], 'file status must never import the engine/project preparation'); const values=bindings[name]; return new vm.SyntheticModule(Object.keys(values),function(){ for(const [key,value] of Object.entries(values)) this.setExport(key,value); },{context:sandbox}); });
await module.evaluate(); const api = module.namespace;
assert.equal(api.fileAnalysisState().status, 'pending');
saved.set('ade.outline',{ owned:{path, status:'ready', lspStatus:'error', lspError:'owned failure',diagnosticCount:2,revision:3} });
assert.equal(api.fileAnalysisState().status,'error'); assert.equal(api.fileAnalysisState().error,'owned failure');
assert.equal(api.fileAnalysisState().diagnostics,2);
path='/owned/b.kt'; assert.equal(api.fileAnalysisState().status,'pending','never show the previous file as ready');
const view=new api.FileAnalysisView();view.init({context});view.retry(context,api.fileAnalysisState(),{notify(){notified++;}});
assert.equal(saved.get('ade.analysis-request').owned.path,path);assert.equal(notified,1);
assert.equal(saved.has('ade.project-analysis'),false);
saved.set('ade.editor-mode',{owned:'database'});assert.equal(api.fileAnalysisState().path,null);
saved.delete('ade.editor-mode');path='/owned/query.sql';assert.equal(api.fileAnalysisState().status,'local');
context.machine='remote';assert.equal(api.fileAnalysisState().status,'unsupported');context.machine=null;
path=null;assert.equal(api.fileAnalysisState().status,'idle');
const main=await fs.readFile(new URL('../../mods/ade/main.js',import.meta.url),'utf8');
assert.equal(main.includes('new ProjectAnalysis'),false);assert.equal(main.includes('projectAnalysisButton'),false);
console.log('PASS current-file analysis: no project requests/timers, file identity, real LSP status, scoped retry, SQL/remote/closed states');
