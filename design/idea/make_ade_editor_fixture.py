"""Create an isolated populated native-check fixture; never read user documents."""
from pathlib import Path
import shutil
import tempfile

source = Path(__file__).resolve().parents[2] / "mods/ade"
target = Path(tempfile.mkdtemp(prefix="ade-editor-native-check-"))
for path in source.iterdir():
    if path.is_file():
        shutil.copy(path, target / path.name)
(target / "text-editor.js").write_text((target / "text-editor.js").read_text().replace('from "herdr"', 'from "./fixture-herdr.js"'))
(target / "workspace.js").write_text('''
export const context={id:"fixture",root:"/fixture",name:"Fixture",machine:null};
export const projectKey=c=>JSON.stringify([c?.machine??null,c?.root??"",c?.id??""]);
export const currentProject=()=>context;
export const documentState=()=>({tabs:["/fixture/main.ts"],active:"/fixture/main.ts"});
export const selectDocument=()=>{}; export const closeDocument=()=>{}; export const openDocument=()=>{};
''')
(target / "fixture-herdr.js").write_text('''
const state={}; export const shared=k=>state[k]; export const setShared=(k,v)=>state[k]=v;
export const readTextFile=async()=>null; export const writeTextFile=async()=>{};
export const window=()=>({platform:"macos"});
''')
(target / "main.js").write_text('''
import { View } from "gpui-kit";
import Editor from "./text-editor.js"; import { CodeInput } from "./code-input.js";
import { MenuController } from "./idea-design.js"; import { IDEA_TOKENS } from "./idea-tokens.js";
import { context } from "./workspace.js"; import { documentKey } from "./editor-document.js";
export default class Fixture extends View {
 init(_,cx) {
  this.editor=new Editor();this.editor.init({},cx);
  const text="const answer = 42;\\nanswer();",state=new CodeInput().init(text,cx,{});
  state.tokens=[{from:0,to:5,color:IDEA_TOKENS["herdr.ux"].syntax.keyword}];
  state.diagnostics=[{from:19,to:25,severity:1,message:"Fixture diagnostic"}];
  const doc={key:documentKey(context,"/fixture/main.ts"),project:context,path:"/fixture/main.ts",loading:false,saved:text,state,
   lsp:{sync(){},request(){},close(){}},infoMenu:new MenuController(cx),
   lspState:{revision:0,status:"ready",confidence:"unversioned",
    diagnostics:[{line:1,col:0,end_line:1,end_col:6,severity:1,message:"Fixture diagnostic"}],
    locations:[{path:"/fixture/target.ts",line:2,col:1}],symbols:[]}};
  this.editor.documents.set(doc.key,doc);
 }
 render(cx){return this.editor.render(cx).w(1200).h(700);}
}
''')
print(target)
