"""Check each eager native frame surface without installing or touching user data."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

base = Path(__file__).resolve().parents[2] / 'mods/ade'
with tempfile.TemporaryDirectory(prefix='ade-frame-check-') as owned:
    failed = False
    cases = [{'view': view} for view in ['appbar', 'editor', 'status', 'collection']]
    cases += [{'view': 'stripe', 'side': side} for side in ['left', 'right']]
    cases += [{'view': 'panel', 'region': key} for key in ['project', 'structure', 'agents', 'terminal', 'results', 'database', 'review']]
    cases += [{'view': 'panel', 'region': 'terminal', 'headerOnly': True}]
    cases += [{'view': view} for view in ['projects', 'project-analysis', 'search', 'configurations', 'terminal-body', 'terminals', 'agent-new', 'settings', 'database-manager', 'database-transfer', 'pane-header']]
    for case in cases:
        if case['view'] == 'database-transfer':
            case.update(mode='export', spec={'source_id': 'fixture', 'kind': 'table', 'table': 'customers'},
                        source={'id': 'fixture', 'name': 'Fixture', 'driver': 'sqlite'},
                        dataset={'columns': [{'name': 'id', 'type': 'integer'}], 'rows': [[1]], 'primary_keys': ['id']})
    for i, props in enumerate(cases):
        dest = Path(owned) / str(i)
        shutil.copytree(base, dest)
        (dest / 'frame-view.js').write_text((dest / 'main.js').read_text())
        (dest / 'main.js').write_text('import Frame from "./frame-view.js"; export default class Fixture extends Frame {init(p,cx){super.init(' + json.dumps(props) + ',cx);}}')
        result = subprocess.run(['herdr-app', 'check', str(dest)], capture_output=True, text=True)
        print(json.dumps({'surface': props, 'code': result.returncode, 'output': (result.stdout + result.stderr).strip()}, ensure_ascii=False))
        failed |= result.returncode != 0
    raise SystemExit(int(failed))
