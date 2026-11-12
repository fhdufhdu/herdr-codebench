// CLI-only harness: exercise the deployed parser in Herdr's actual JS runtime.
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = await mkdtemp(join(tmpdir(), 'herdr-sql-completion-'));
for (const file of ['sql-completion.js', 'sql-parser-vendor.js'])
  await copyFile(new URL(`../../mods/ade/${file}`, import.meta.url), join(fixture, file));
await writeFile(join(fixture, 'mod.json'), JSON.stringify({place: 'none'}));
await writeFile(join(fixture, 'main.js'), `
import { View, div } from 'gpui-kit';
import { completeSQL, referencedTables } from './sql-completion.js';
export default class SQLProbe extends View {
  init() {
    const schema = {driver:'sqlite',tables:[{name:'users',schema:'main',columns:[{name:'id'},{name:'email'}]},{name:'orders',columns:[{name:'user_id'},{name:'total'}]}]};
    const check = (marked, expected) => {
      const offset = marked.indexOf('|'), text = marked.replace('|','');
      const result = completeSQL(text, offset, schema);
      for (const label of expected) if (!result.items.some(item => item.label === label))
        throw new Error('Native SQL completion missing ' + label + ': ' + marked);
      return result;
    };
    check('SELECT e| FROM users', ['email']);
    check('SELECT u.| FROM users u JOIN orders o ON o.user_id=u.id', ['email']);
    check('WITH c AS (SELECT email AS label FROM users) SELECT c.| FROM c', ['label']);
    check('SELECT q.| FROM (SELECT total FROM orders) q', ['total']);
    check('SELECT * FROM users u WHERE EXISTS (SELECT u.| FROM orders o)', ['email']);
    if (check("SELECT 'no|' FROM users", []).items.length) throw new Error('Native string exclusion');
    const text = "SELECT '😀', em|ail FROM users";
    if (check(text, ['email']).from !== text.replace('|','').indexOf('email')) throw new Error('Native UTF16 range');
    if (referencedTables('SELECT * FROM main.users', 24, 'sqlite')[0]?.schema !== 'main') throw new Error('Native references');
    this.result = 'SQL parser and completion passed in native runtime';
  }
  render() { return div().child(this.result); }
}
`);
const result = spawnSync('herdr-app', ['check', fixture], {encoding: 'utf8'});
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error || result.status !== 0) {
  console.error(`Native SQL fixture retained at ${fixture}`);
  throw result.error || new Error(`Native SQL check failed: ${result.status}`);
}
await rm(fixture, {recursive: true});
