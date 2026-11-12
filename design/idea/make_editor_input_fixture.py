"""Build isolated native EditorInput probes; never installs or changes the app.

Run: python3 design/idea/make_editor_input_fixture.py --check
The emitted main.js is also a small manual IME probe for the parent's UI test.
"""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = Path(tempfile.mkdtemp(prefix='codebench-editor-input-'))
source = Path(__file__).resolve().parents[2] / 'mods/codenav/editor-input.js'
main = '''import {View, div} from "gpui-kit";
import {v_flex} from "gpui-base";
import {EditorInput} from "./editor-input.js";
export default class InputProbe extends View {
  init(p,cx) {
    this.text=""; this.commands=[]; this.commits=[]; this.width=2; this.input=new EditorInput();
    this.input.init(cx, {onCommit:(text,eventCx)=>{this.text+=text;this.commits.push(text);eventCx.notify();},
      onCommand:(command,eventCx)=>{this.commands.push(command);eventCx.notify();}});
    SETUP
    this.input.focus();
  }
  render(cx) {
    return v_flex().size_full().p(12).gap(8)
      .child(div().child("Native IME sink probe: type Korean/emoji, paste multiline, then arrows/delete/undo."))
      .child(div().child("Document: "+JSON.stringify(this.text)))
      .child(div().child("Commits: "+JSON.stringify(this.commits)))
      .child(div().child("Commands: "+this.commands.join(", ")))
      .child(this.input.render(cx,{id:"probe-input",width:this.width,height:24,size:16}))
      .child(div().child("Native pending: "+JSON.stringify(this.input.pendingText())));
  }
  close(){this.input.release();}
}'''
failed = False
for name, setup in {
    'empty': '',
    'pending': 'this.input.state.set_value("ㅎ🙂");this.width=64;',
    'native-replace': 'this.input.state.replace(' + json.dumps("한글🙂\n둘째 줄", ensure_ascii=False) + ');this.width=360;',
}.items():
    target = root / name
    target.mkdir()
    shutil.copy2(source, target / 'editor-input.js')
    (target / 'mod.json').write_text(json.dumps({'place': 'none', 'focusable': True}))
    (target / 'main.js').write_text(main.replace('SETUP', setup))
    if args.check:
        result = subprocess.run(['herdr-app', 'check', str(target)], capture_output=True, text=True)
        failed |= result.returncode != 0
        print(json.dumps({'case': name, 'code': result.returncode, 'output': (result.stdout + result.stderr).strip()}, ensure_ascii=False))
print('FIXTURES', root)
raise SystemExit(int(failed))
