import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../mods/codenav/database-model.js',import.meta.url),'utf8');
const {splitSQL,queryCandidates,extractData,parseImport,EXTRACTORS}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const sql="-- ;\nSELECT '한글;😀', `a;b`, \"x;y\"; /* outer ; /* inner ; */ end */ SELECT 2;";
assert.equal(splitSQL(sql).length,2);
for(const s of splitSQL(sql)) assert.equal(sql.slice(s.start,s.end),s.text);
assert.equal(splitSQL("SELECT $$a;b$$; SELECT $tag$x;y$tag$;",{dialect:'postgres'}).length,2);
assert.equal(splitSQL("SELECT E'a\\\';b'; SELECT 2;",{dialect:'postgres'}).length,2);
assert.equal(splitSQL("SELECT [a;b]]c];\nGO\nSELECT 2;\nGO -- end",{dialect:'sqlserver'}).length,2);
assert.throws(()=>splitSQL('SELECT 1\nGO 3',{dialect:'sqlserver'}),/repetition/);
const routine='DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;';
assert.deepEqual(splitSQL(routine).map(s=>s.text),['CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END','SELECT 3']);
const sqliteTrigger = `-- trigger header comment ;
CREATE /* comments between keywords */ TEMP TRIGGER "audit;trigger"
AFTER UPDATE ON items WHEN CASE WHEN NEW.id > 0 THEN 1 ELSE 0 END
BEGIN
  INSERT INTO audit(value) VALUES(CASE WHEN NEW.id = 1 THEN 'END; BEGIN' ELSE 'other' END);
  /* CASE END BEGIN ; */
  UPDATE items SET value = 'semi;colon' WHERE id = NEW.id;
  DELETE FROM audit WHERE value = 'old;value'; -- END ;
END; SELECT 7;`;
const triggerParts = splitSQL(sqliteTrigger, {dialect:'sqlite'});
assert.equal(triggerParts.length,2);
assert.ok(triggerParts[0].text.endsWith('END'));
assert.ok(triggerParts[0].text.includes('DELETE FROM audit'));
assert.equal(triggerParts[1].text,'SELECT 7');
for(const part of triggerParts) assert.equal(sqliteTrigger.slice(part.start,part.end),part.text);
const triggerChoices=queryCandidates(sqliteTrigger,{dialect:'sqlite',caret:sqliteTrigger.indexOf('DELETE FROM')});
assert.equal(triggerChoices[0].text,triggerParts[0].text);
assert.ok(triggerChoices.every(c=>!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.text)));
assert.equal(splitSQL('CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES(CASE WHEN 1 THEN CASE WHEN 2 THEN 3 END END); DELETE FROM y; END;', {dialect:'sqlite'}).length,1);
const triggerWithQuery='CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES((SELECT NEW.id)); DELETE FROM y; END;';
assert.equal(queryCandidates(triggerWithQuery,{dialect:'sqlite',caret:triggerWithQuery.indexOf('SELECT')})[0].text,triggerWithQuery.slice(0,-1));
assert.equal(queryCandidates(triggerWithQuery,{dialect:'sqlite',caret:triggerWithQuery.indexOf('SELECT')}).length,1);
assert.throws(()=>splitSQL('CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES(1); DELETE FROM y;', {dialect:'sqlite'}),/Incomplete SQLite trigger/);
assert.throws(()=>splitSQL('CREATE /*!50003 PROCEDURE p() */ BEGIN DELETE FROM audit; END;'),/custom DELIMITER/);
assert.throws(()=>splitSQL('/*!50003 CREATE*/ /*!50003 TRIGGER t AFTER INSERT ON x FOR EACH ROW BEGIN */ DELETE FROM audit; END;'),/custom DELIMITER/);
for(const kind of ['PROCEDURE p()', 'FUNCTION f() RETURNS INT', 'TRIGGER t AFTER INSERT ON x FOR EACH ROW']) {
  const unsafe=`CREATE /* header */ ${kind} BEGIN INSERT INTO audit VALUES('BEGIN; END'); DELETE FROM audit; END; SELECT 9;`;
  assert.throws(()=>splitSQL(unsafe),/custom DELIMITER/);
  assert.throws(()=>queryCandidates(unsafe,{caret:unsafe.indexOf('DELETE')}),/custom DELIMITER/);
  assert.deepEqual(queryCandidates(unsafe,{start:0,end:unsafe.length}),[{start:0,end:unsafe.length,text:unsafe,label:'Selection'}]);
  const wrapped='DELIMITER //\n'+unsafe.replace('END; SELECT 9;','END//\nDELIMITER ;\nSELECT 9;');
  const safeParts=splitSQL(wrapped);
  assert.equal(safeParts.length,2);
  assert.ok(safeParts[0].text.endsWith('END'));
  assert.equal(safeParts[1].text,'SELECT 9');
}
assert.equal(splitSQL("# x;\nSELECT 'a\\\';b'; SELECT 2;").length,2);
assert.deepEqual(splitSQL('/* only comment; */ -- no SQL'),[]);
assert.throws(()=>splitSQL("SELECT 'oops"),/Unclosed/);
assert.throws(()=>splitSQL('/* /* x */'),/Unclosed/);
const nested='SELECT 😀 FROM (SELECT 2 FROM (SELECT 3) q) x; SELECT 4;';
const candidates=queryCandidates(nested,{caret:nested.indexOf('3')});
assert.equal(candidates[0].text,'SELECT 3');
assert.equal(candidates[1].text,'SELECT 2 FROM (SELECT 3) q');
assert.equal(candidates.at(-1).text,nested);
assert.equal(queryCandidates(nested,{start:0,end:9})[0].text,nested.slice(0,9));
assert.equal(queryCandidates(' SELECT 1; ',{start:0,end:11})[0].text,' SELECT 1; ');
assert.equal(queryCandidates('SELECT \'(SELECT 2)\';',{caret:12}).length,1);
const data={columns:[{name:'id'},{name:'value'},{name:'other'}],rows:[[1,'한글,😀\n"x"',null],[2,'','\\N'],[3,'001',false]],table:'t`est',driver:'mysql',primary_keys:['id']};
for(const format of ['csv','tsv']) {
 const output=extractData(data,format);
 assert.ok(output.includes('\r\n'));
 const parsed=parseImport(output,format);
 assert.deepEqual(parsed.rows,[['1','한글,😀\n"x"',null],['2','','\\N'],['3','001','false']]);
 assert.deepEqual(parsed.columns,data.columns);
}
assert.deepEqual(parseImport(extractData({columns:['a'],rows:[['']]},'csv',{headers:false}),'csv',{headers:false}).rows,[['']]);
assert.deepEqual(parseImport('a,b\r\n"x\r\ny",NULL','csv',{nullToken:'NULL'}).rows,[['x\r\ny',null]]);
assert.throws(()=>parseImport('a,b\n1'),/width/);
assert.throws(()=>parseImport('a\n"x"oops'),/closing/);
assert.throws(()=>parseImport('a\n"x'),/Unclosed/);
assert.deepEqual(parseImport(extractData(data,'json'),'json').rows,data.rows);
assert.equal(JSON.parse(extractData({columns:['big'],rows:[[9007199254740993n]]},'json'))[0].big,'9007199254740993');
assert.throws(()=>parseImport('[{"a":1},{"b":2}]','json'),/inconsistent/);
assert.throws(()=>extractData({...data,primary_keys:[]},'sql-update'),/key columns/);
assert.throws(()=>extractData(data,'where',{keys:['missing']}),/key columns/);
assert.match(extractData(data,'sql-insert'),/INSERT INTO `t``est`/);
assert.match(extractData(data,'sql-insert'),/CONVERT\(0x5c4e USING utf8mb4\)/);
assert.match(extractData(data,'sql-update'),/WHERE `id` = 1;/);
assert.equal(extractData({columns:['id'],rows:[[null]],primary_keys:['id']},'where'), '("id" IS NULL)'.replace(/"/g,'`'));
assert.match(extractData({columns:['a'],rows:[["a'b"]],table:'t',driver:'postgres'},'sql-insert'),/'a''b'/);
assert.match(extractData({columns:['a'],rows:[[{type:'binary',hex:'00ff'}]],table:'t',driver:'sqlite'},'sql-insert'),/X'00ff'/);
assert.throws(()=>extractData({columns:['a'],rows:[[{}]]}),/Unsupported/);
assert.throws(()=>extractData({columns:['a'],rows:[[NaN]]}),/Non-finite/);
for(const {id} of EXTRACTORS) assert.equal(typeof extractData(data,id),'string');
assert.ok(extractData({columns:['<a>'],rows:[['<&"']]},'html').includes('&lt;&amp;&quot;'));
assert.ok(extractData(data,'xml').includes('null="true"'));


assert.equal(splitSQL('BEGIN SELECT CASE WHEN 1=1 THEN 1 END; SELECT 2; END;\nGO\nSELECT 3;', {dialect:'sqlserver'}).length,2);
assert.equal(splitSQL('CREATE PROCEDURE p AS SELECT 1; SELECT 2;\nGO\nSELECT 3;', {dialect:'sqlserver'}).length,2);
assert.throws(()=>parseImport('[{\"big\":9007199254740993}]','json'),/Unsafe integer/);
assert.match(extractData({...data,database:'db',schema:'public',table:'t',driver:'postgres'},'sql-insert'),/INSERT INTO \"public\"\.\"t\"/);

assert.deepEqual(splitSQL('/*! SELECT 1 */;').map(s=>s.text),['/*! SELECT 1 */']);
assert.equal(splitSQL('SELECT [a;b]; SELECT 2;', {dialect:'sqlite'}).length,2);
assert.match(extractData({columns:['a'],rows:[['a\0b']],table:'t',driver:'mysql'},'sql-insert'),/CONVERT\(0x610062 USING utf8mb4\)/);
const liveBinary={columns:['blob','precise'],rows:[[{type:'binary',base64:'AP8='},'9007199254740993']],table:'t',driver:'sqlite'};
assert.match(extractData(liveBinary,'sql-insert'),/X'00ff'/);
assert.deepEqual(parseImport(extractData(liveBinary,'json'),'json').rows,liveBinary.rows);
assert.match(extractData(liveBinary,'csv'),/0x00ff/);
assert.throws(()=>extractData({...liveBinary,rows:[[{type:'binary',base64:'A!=='},'1']]}),/base64/);
assert.throws(()=>extractData({...liveBinary,rows:[[{type:'binary',base64:'AB=='},'1']]}),/Noncanonical/);
console.log('Database model: SQL range/candidate, extractor and import checks passed');
