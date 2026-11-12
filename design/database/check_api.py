import argparse
import json
import pathlib
import platform
import re
import subprocess
import tempfile
import time
import urllib.request

root=pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description='Exercise actual localhost Database API and an owned temporary SQLite fixture through Postman.')
parser.add_argument('--binary',type=pathlib.Path,required=True)
args=parser.parse_args()
with tempfile.TemporaryDirectory(prefix='herdr-db-api-') as temp:
    path=pathlib.Path(temp)
    state=path/'engine.json'
    def start():
        state.unlink(missing_ok=True)
        return subprocess.Popen([str(args.binary.resolve()),'--port','0','--state',str(state),'--config',str(root/'mods/codenav/bridge/servers.json')],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
    def stop(process):
        process.terminate()
        try:process.communicate(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.communicate()
    def ready(process):
        for _ in range(80):
            if state.exists():return json.loads(state.read_text())
            if process.poll() is not None:raise RuntimeError(process.stderr.read())
            time.sleep(0.05)
        raise RuntimeError('Owned test engine did not become ready')
    process=start()
    try:
        config=ready(process)
        def call(route, body, script, token=None):
            output=path/(route+'.json')
            args=['postman','request','POST',f'http://127.0.0.1:{config["port"]}/{route}',
                '-H','Content-Type:application/json','-H','X-Codenav-Token:'+(token or config['token']),
                '--body',json.dumps({'database':body}),'--timeout','5000','--script-post-request',script,
                '--output',str(output)]
            result=subprocess.run(args,capture_output=True,text=True,timeout=20)
            if result.returncode and not (token and result.returncode == 1 and '1 passed' in result.stdout):raise RuntimeError(result.stdout+'\n'+result.stderr)
            response=json.loads(output.read_text())
            value=response.get('body', response.get('response',{}).get('body'))
            if isinstance(value,str):value=json.loads(value)
            print('PASS',route,flush=True)
            return value
        call('db_sources',{},"pm.test('initial profiles empty',()=>{pm.expect(pm.response.code).to.eql(200);pm.expect(pm.response.json()).to.eql({ok:true,result:{sources:[]}})});")
        saved=call('db_save',{'source':{'name':'Owned API fixture','driver':'mysql','host':'127.0.0.1','port':3306,'user':'fixture','password':'fixture-not-a-real-secret'}},"pm.test('save metadata without connecting or exposing password',()=>{const b=pm.response.json();pm.expect(b.ok).to.eql(true);pm.expect(b.result.id).to.be.a('string');pm.expect(JSON.stringify(b)).not.to.include('fixture-not-a-real-secret');});")
        listing=call('db_sources',{},"pm.test('global metadata, credentials omitted',()=>{const b=pm.response.json();pm.expect(b.result.sources).to.have.lengthOf(1);pm.expect(b.result.sources[0]).not.to.have.property('password');});")
        data=json.loads((path/'database-sources.json').read_text())
        assert 'fixture-not-a-real-secret' not in json.dumps(data)
        # Restart only this owned helper; credentials must not enter its metadata.
        stop(process); process=start(); config=ready(process)
        storage='keychain' if platform.system()=='Darwin' else 'none'
        listing=call('db_sources',{},"pm.test('storage status survives restart honestly',()=>{const s=pm.response.json().result.sources[0];pm.expect(s.password_storage).to.eql('"+storage+"');pm.expect(s.has_password).to.eql("+str(storage=='keychain').lower()+");pm.expect(s).not.to.have.property('password');});")
        if storage=='keychain':
            profile={**listing['result']['sources'][0], 'name':'Owned renamed fixture'}
            call('db_save',{'source':profile},"pm.test('omitting password preserves Keychain credential',()=>{const s=pm.response.json().result;pm.expect(s.has_password).to.eql(true);pm.expect(s.password_storage).to.eql('keychain');});")
        call('db_delete',{'source_id':saved['result']['id']},"pm.test('own saved credential removed with profile',()=>pm.expect(pm.response.json().result.deleted).to.eql(true));")
        # Validate fail-closed routing through a real localhost HTTP server.
        call('db_sources',{},"pm.test('authentication denied',()=>{pm.expect(pm.response.code).to.eql(401);pm.expect(pm.response.json().ok).to.eql(false)});",token='wrong-fixture-token')
        
        fixture=call('db_save',{'source':{'name':'Owned SQLite fixture','driver':'sqlite','path':str(path/'fixture.db')}},"pm.test('SQLite source saved',()=>pm.expect(pm.response.json().ok).to.eql(true));")
        sid=fixture['result']['id']
        call('db_test',{'source_id':sid},"pm.test('real SQLite connection',()=>pm.expect(pm.response.json().result.connected).to.eql(true));")
        job=call('db_query',{'source_id':sid,'statements':['CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, note TEXT)',"INSERT INTO items VALUES (1,\'alpha\',NULL),(2,\'한글\',\'line\')",'SELECT * FROM items ORDER BY id']},"pm.test('query started',()=>pm.expect(pm.response.json().result.job_id).to.be.a('string'));")
        jid=job['result']['job_id']
        for _ in range(30):
            job=call('db_job',{'job_id':jid},"pm.test('query job exists',()=>pm.expect(pm.response.json().ok).to.eql(true));")['result']
            if job['state'] not in ['queued','running']:break
            time.sleep(.05)
        assert job['state']=='completed',job
        assert job['results'][-1]['rows']==[[1,'alpha',None],[2,'한글','line']],job
        call('db_rows',{'source_id':sid,'database':'main','table':'items'},"pm.test('table grid and primary key',()=>{const r=pm.response.json().result;pm.expect(r.primary_keys).to.eql(['id']);pm.expect(r.rows).to.have.lengthOf(2);});")
        call('db_apply',{'source_id':sid,'database':'main','table':'items','changes':[{'op':'update','original':{'id':1,'name':'alpha'},'values':{'name':'updated'}}]},"pm.test('one row changed',()=>pm.expect(pm.response.json().result.affected_rows).to.eql(1));")
        call('db_ddl',{'source_id':sid,'objects':[{'kind':'database','name':'main'}]},"pm.test('recursive database DDL',()=>{const r=pm.response.json().result;pm.expect(r.sql).to.include('CREATE TABLE items');});")
        call('db_delete',{'source_id':sid},"pm.test('fixture source removed',()=>pm.expect(pm.response.json().result.deleted).to.eql(true));")
        print('PASS actual SQLite query/grid/edit/hierarchy DDL plus metadata persistence/privacy/auth',flush=True)

    finally:
        # Clean every profile in this private fixture, including failures between
        # save and assertion. Never enumerate or inspect unrelated Keychain items.
        metadata=path/'database-sources.json'
        sources=json.loads(metadata.read_text()) if metadata.exists() else []
        for source in sources:
            sid=source['id']
            try:
                request=urllib.request.Request(f'http://127.0.0.1:{config["port"]}/db_delete',
                    data=json.dumps({'database':{'source_id':sid}}).encode(),
                    headers={'Content-Type':'application/json','X-Codenav-Token':config['token']})
                with urllib.request.urlopen(request,timeout=20) as response:
                    assert json.load(response)['ok']
            except Exception:
                if platform.system()=='Darwin' and source.get('password_storage')=='keychain' and re.fullmatch('[0-9a-f]{32}',sid):
                    result=subprocess.run(['/usr/bin/security','delete-generic-password','-s','dev.herdr.codebench.database','-a',sid],capture_output=True,timeout=20)
                    if result.returncode not in (0,44):raise RuntimeError('Owned fixture Keychain cleanup failed')
        stop(process)
