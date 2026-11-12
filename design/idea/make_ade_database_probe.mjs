// Native table or nonempty candidate-popup fixture. Backend rejects all requests.
import { mkdtemp, copyFile, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'ade-database-probe-'));
for (const name of ['database-editor.js', 'database-model.js', 'data-extract.js', 'code-input.js', 'code-document.js', 'editor-state-vendor.js', 'idea-design.js', 'idea-tokens.js', 'ui-icons.js']) {
  await copyFile(new URL(`../../mods/ade/${name}`, import.meta.url), join(directory, name));
}
await cp(new URL('../../mods/ade/ui-icons', import.meta.url), join(directory, 'ui-icons'), { recursive: true });
await writeFile(join(directory, 'backend.js'), 'export async function backend(){throw new Error("Native fixture never accesses a database.");}\n');
await writeFile(join(directory, 'workspace.js'), 'export const currentProject=()=>({id:"native-db-probe",root:"/tmp",machine:null,name:"Native probe"});export const projectKey=p=>JSON.stringify([p.machine,p.root,p.id]);\n');
await writeFile(join(directory, 'mod.json'), JSON.stringify({ place: 'none', title: 'ADE SQL candidate probe', focusable: true, overlay: { width: 800, height: 560 } }));
await writeFile(join(directory, 'main.js'), process.argv.includes('--table') ? `import {View} from "gpui-kit";
import {InputState} from "gpui-base";
import {DatabaseEditor,DataGrid} from "./database-editor.js";
import {TableChanges} from "./database-model.js";
import {MenuController} from "./idea-design.js";
import {currentProject} from "./workspace.js";
export default class extends View {
  init(_props,cx) {
    this.editor=new DatabaseEditor();Object.assign(this.editor,{context:currentProject(),alive:true,embedded:true,documents:new Map(),menu:new MenuController(cx)});this.editor.focus=this.editor.menu.focus;
    const page={columns:[{name:"id"},{name:"name"},{name:"email"},{name:"plan"},{name:"joined_at"}],primary_keys:["id"],rows:Array.from({length:8},(_value,n)=>[n+1,"고객 "+(n+1),n===2?null:"customer"+(n+1)+"@example.test","team","2026-11-06"])};
    this.doc={id:"probe",key:"probe",context:currentProject(),source:{id:"probe",name:"Native table probe",driver:"sqlite",path:"/tmp/probe.sqlite"},spec:{kind:"table",source_id:"probe",table:"customers"},page,elapsedMs:12,changes:new TableChanges(page),cell:InputState.new()};
    this.doc.grid=new DataGrid();this.doc.grid.init("probe-grid",cx,{selectionFooter:false,onEdit:(row,column,eventCx)=>this.editor.edit(this.doc,row,column,eventCx)});this.doc.grid.update(page);this.doc.cell.on("submit",(_event,eventCx)=>this.editor.stage(this.doc,eventCx));
    this.editor.documents.set("probe",this.doc);this.editor.active=()=>this.doc;
  }
  close(){this.editor.release();}
  render(cx){return this.editor.render(cx);}
}
` : `import {View} from "gpui-kit";
import {DatabaseEditor} from "./database-editor.js";
import {CodeInput} from "./code-input.js";
import {MenuController} from "./idea-design.js";
import {currentProject} from "./workspace.js";
export default class extends View {
  init(_props,cx) {
    this.editor=new DatabaseEditor();Object.assign(this.editor,{context:currentProject(),alive:true,embedded:true,documents:new Map(),menu:new MenuController(cx)});this.editor.focus=this.editor.menu.focus;
    const text="SELECT id, name FROM customers;\\nSELECT COUNT(*) FROM customers;";
    this.doc={id:"probe",key:"probe",context:currentProject(),source:{id:"probe",name:"Native probe",driver:"sqlite",path:"/tmp/probe.sqlite"},spec:{kind:"console",source_id:"probe"},initial:text};
    this.doc.input=new CodeInput().init(text,cx,{onExecute:eventCx=>this.editor.chooseSQL(this.doc,eventCx)});this.editor.documents.set("probe",this.doc);this.editor.active=()=>this.doc;
    this.editor.chooseSQL(this.doc,cx);
  }
  close(){this.editor.release();}
  render(cx){return this.editor.render(cx);}
}
`);
console.log(directory);
