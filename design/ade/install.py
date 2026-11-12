"""Install only the owned ADE mod/layout, retaining backups and layout geometry."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import time

repo = Path(__file__).resolve().parents[2]
app = Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app')))
source = repo / 'mods/ade'
target = app / 'mods/ade'
backup = app / 'data/ade-backups' / str(time.time_ns())
backup.mkdir(parents=True)
stage = Path(tempfile.mkdtemp(prefix='.ade-install-', dir=app / 'mods'))
shutil.copytree(source, stage, dirs_exist_ok=True)
destination = app / 'layouts/ade.json'
fresh = json.loads((repo / 'layouts/ade.json').read_text())
frame = json.loads(destination.read_text()) if destination.exists() else fresh
if frame.get('id') != 'ade-root':
    raise SystemExit('Refusing to overwrite an unrelated ADE layout')

def locate(node, identifier):
    if node.get('id') == identifier:
        return node
    return next((result for child in node.get('children', []) if (result := locate(child, identifier))), None)

old_terminal = locate(frame, 'ade-terminal')
new_terminal = locate(fresh, 'ade-terminal')
if old_terminal and old_terminal.get('type') == 'block' and new_terminal.get('type') == 'column':
    preserved = {name: old_terminal[name] for name in ['size', 'min', 'max', 'hidden', 'radius'] if name in old_terminal}
    old_terminal.clear()
    old_terminal.update(new_terminal)
    old_terminal.update(preserved)
terminal_header = locate(frame, 'ade-terminal-header')
fresh_header = locate(fresh, 'ade-terminal-header')
if terminal_header and fresh_header:
    for field in ['size', 'min', 'max']:
        terminal_header[field] = fresh_header[field]
terminal_body = locate(frame, 'ade-terminal-body')
fresh_body = locate(fresh, 'ade-terminal-body')
if terminal_body and fresh_body:
    if terminal_body.get('content', {}).get('tab') != 'active':
        terminal_body['content'] = fresh_body['content']
    terminal_body['movable'] = True
# Use the runtime's slot migration, including pre-existing DB nodes appended
# after Terminal. Preserve explicit placements, sizes and unknown children.
shared_path = app / 'shared.json'
metadata = json.loads(shared_path.read_text()).get('ade.tool-settings', {}) if shared_path.exists() else {}
migrate = subprocess.run(
    ['node', '--input-type=module', '-e',
     'import {ensureDatabaseRegion} from "./mods/ade/frame-layout.js";'
     'let text="";for await(const chunk of process.stdin)text+=chunk;'
     'const {frame,metadata}=JSON.parse(text);'
     'process.stdout.write(JSON.stringify(ensureDatabaseRegion(frame,metadata)));'],
    cwd=repo, input=json.dumps({'frame': frame, 'metadata': metadata}),
    capture_output=True, text=True, check=True)
frame = json.loads(migrate.stdout)
if destination.exists():
    shutil.copy2(destination, backup / 'ade.json')
if target.exists():
    target.rename(backup / 'mod')
try:
    stage.rename(target)
except Exception:
    if (backup / 'mod').exists():
        (backup / 'mod').rename(target)
    raise
temporary = destination.with_suffix('.installing')
temporary.write_text(json.dumps(frame, ensure_ascii=False, indent=2) + '\n')
temporary.replace(destination)
# The shared terminal key routes according to the active layout.
router = app / 'mods/terminal-files-key'
if router.exists():
    shutil.copytree(router, backup / 'terminal-files-key')
shutil.copytree(repo / 'mods/terminal-files-key', router, dirs_exist_ok=True)
keys_path = app / 'keys.json'
keymap = json.loads(keys_path.read_text()) if keys_path.exists() else {}
if keys_path.exists():
    shutil.copy2(keys_path, backup / 'keys.json')
terminal_keys = keymap.setdefault('terminal', {})
if terminal_keys.get('cmd-shift-o') in (None, 'codenav.terminal-files', 'ade.terminal-files', 'mod.open:terminal-files-key'):
    terminal_keys['cmd-shift-o'] = 'mod.open:terminal-files-key'
keymap.setdefault('layout:ade', {}).setdefault('cmd-shift-o', 'ade.terminal-files')
keys_temp = keys_path.with_suffix('.installing')
keys_temp.write_text(json.dumps(keymap, ensure_ascii=False, indent=2) + '\n')
keys_temp.replace(keys_path)
print('Installed owned ADE mod/layout; backup:', backup)
