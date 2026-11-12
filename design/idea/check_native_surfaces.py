# Native eager surface checks; run with the idea layout active.
# This does not replace actual UI layout, pointer and deferred-row verification.
from pathlib import Path
import shutil,tempfile,subprocess,json,sys
root=Path(tempfile.mkdtemp(prefix='codebench-native-redesign-'))
base=Path(__file__).resolve().parents[2]/'mods/codenav'
cases={
 'settings-tools':('import IdeaSettings from "./settings.js";','this.impl=new IdeaSettings();this.impl.init({page:"windows"},cx);'),
 'settings-database':('import IdeaSettings from "./settings.js";','this.impl=new IdeaSettings();this.impl.init({page:"database"},cx);'),
 'projects-order':('import {Projects} from "./tools.js";','this.impl=new Projects();this.impl.init({manageOrder:true},cx);'),
 'connection-network':('import {DatabaseManager} from "./database.js";','this.impl=new DatabaseManager();this.impl.fetchSources=()=>{};this.impl.init({},cx);this.impl.loading=false;'),
 'connection-sqlite':('import {DatabaseManager} from "./database.js";','this.impl=new DatabaseManager();this.impl.fetchSources=()=>{};this.impl.init({},cx);this.impl.loading=false;this.impl.chooseDriver({id:"sqlite",port:0},cx);'),
 'query-dialog':('import {DatabaseQueryMenu} from "./database-editor.js";','this.impl=new DatabaseQueryMenu();this.impl.init({path:"db://fixture",source:"UX Lab / SQLite / main",candidates:[{label:"Current statement",text:"SELECT id, name FROM customers;",firstLine:1,lastLine:1},{label:"Entire script",text:"SELECT 1; SELECT 2;",firstLine:1,lastLine:2}]},cx);'),
 'export-dialog':('import {DatabaseTransfer} from "./database-editor.js";','this.impl=new DatabaseTransfer();this.impl.init({mode:"export",path:"db://fixture",source:"UX Lab / customers",selectedCount:1,dataset:{columns:[{name:"id"},{name:"name"}],rows:[[1,"한글"]]},loaded:{columns:[{name:"id"},{name:"name"}],rows:[[1,"한글"],[2,null]]}},cx);'),
 'import-dialog':('import {DatabaseTransfer} from "./database-editor.js";','this.impl=new DatabaseTransfer();this.impl.init({mode:"import",path:"db://fixture",source:"UX Lab / customers"},cx);'),
 'run-configs':('import {RunConfigs} from "./run.js";','this.impl=new RunConfigs();this.impl.init({},cx);'),
 'gallery':('import DesignPreview from "./design-preview.js";','this.impl=new DesignPreview();this.impl.init({},cx);'),
 'results-empty':('import {RunResults} from "./database-editor.js";','this.impl=new RunResults();this.impl.init({},cx);'),
 'results-sql':('import {RunResults} from "./database-editor.js";','this.impl=new RunResults();this.impl.init({},cx);'),
 'results-running':('import {RunResults} from "./database-editor.js";','this.impl=new RunResults();this.impl.init({},cx);'),
 'results-shell':('import {RunResults} from "./database-editor.js";','this.impl=new RunResults();this.impl.init({},cx);'),
}
owned_imports = '''import EditableCode from "./editable-code.js";
import {EditorBuffer} from "./editor-buffer.js";
import {theme} from "herdr";
import {syntaxColors} from "./common.js";
class StaticEditor extends EditableCode {
 sync() {} publish() {} publishState() {} httpLines() {} listenCommands() {} analyze() {}
}'''
for name, path, text, readonly in [
 ('owned-source','/fixture.ts','const message: string = "한글🙂";\n',False),
 ('owned-markdown','/fixture.md','# 한글🙂\n\nsource and preview',False),
 ('owned-readonly','/fixture.sql','CREATE TABLE sample (id INTEGER);',True),
 ('owned-input','/fixture.ts','한글🙂',False),
]:
 setup='this.impl=new StaticEditor();this.impl.init({disableLsp:true},cx);'
 setup+='const spec='+json.dumps({'kind':'file','path':path,'root':'/fixture'})+';'
 setup+='const doc={spec,buffer:new EditorBuffer('+json.dumps(text)+',{readOnly:'+str(readonly).lower()+'}),original:'+json.dumps(text)+',owner:"fixture",scroll:{top:0,left:0}};'
 setup+='this.impl.document=doc;this.impl.shown=spec;this.impl.documentSpace="fixture";this.impl.text=doc.buffer.text;this.impl.lines=doc.buffer.text.split("\\n");this.impl.width=60;this.impl.selectionFromBuffer();'
 cases[name]=(owned_imports,setup)
failed=False
for name,(imports,init) in cases.items():
 dest=root/name;shutil.copytree(base,dest)
 if name.startswith('results-'):
  item={'id':'run-result:fixture','kind':'sql' if name.endswith(('sql','running')) else 'shell','state':'running' if name.endswith('running') else 'completed','sequence':1,'name':'Fixture','command':'select id, value from fixture;','folder':'/tmp','spec':{'source_id':'fixture','kind':'console','database':'fixture'},'source':{'id':'fixture','name':'Fixture','driver':'sqlite'},'output':'Fixture output\nFinished','job':{'state':'completed','current':1,'total':1,'elapsed_ms':12,'results':[{'columns':[{'name':'id'},{'name':'value'}],'rows':[[1,None],[2,'example']],'primary_keys':[]}]}}
  entries=[] if name.endswith('empty') else [item]
  (dest/'execution-results.js').write_text('export const EXECUTION_HISTORY_LIMIT=20;const state='+json.dumps({'entries':entries,'selected':entries[0]['id'] if entries else None,'sequence':1})+';export const executionStore=()=>state;export const executionBusy=e=>["queued","running"].includes(e?.state);export const beginExecution=()=>{};export const updateExecution=()=>{};export const selectExecution=()=>{};export const closeExecution=()=>false;export const interruptExecution=async()=>{};export const claimExecution=()=>false;export const releaseExecution=()=>{};export const inspectExecutionTerminal=async()=>({});export const markUntrackedSession=()=>{};')
 render='this.impl.renderCx=cx;return this.impl.inlineCaret(0).element;' if name=='owned-input' else 'return this.impl.render(cx);'
 (dest/'main.js').write_text('import {View} from "gpui-kit";\n'+imports+'\nexport default class Check extends View {init(p,cx){'+init+'} render(cx){'+render+'} close(){this.impl?.release?.();}}')
 r=subprocess.run(['herdr-app','check',str(dest)],capture_output=True,text=True)
 failed |= r.returncode != 0
 print(json.dumps({'case':name,'code':r.returncode,'output':(r.stdout+r.stderr).strip()},ensure_ascii=False))
print('FIXTURES',root)
sys.exit(int(failed))
