// One Git snapshot per project refresh; porcelain -z preserves unusual filenames.
export const GIT_STATUS = `import json,os,subprocess,sys
root=sys.argv[1]
def git(*args):
 return subprocess.run(['git','-C',root,*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=8)
try:
 top=git('rev-parse','--show-toplevel')
 if top.returncode: print('{}'); sys.exit(0)
 base=os.fsdecode(top.stdout).rstrip('\\r\\n')
 reply=git('status','--porcelain=v1','-z','--untracked-files=normal','--ignored=matching')
 if reply.returncode: print('{}'); sys.exit(0)
 entries=reply.stdout.split(b'\\0'); result={}; i=0
 priority={'ignored':0,'untracked':1,'added':2,'modified':3,'renamed':4,'deleted':5,'conflict':6}
 while i<len(entries):
  entry=entries[i]; i+=1
  if len(entry)<4: continue
  xy=entry[:2].decode('ascii','replace'); path=os.path.normpath(os.path.join(base,os.fsdecode(entry[3:])))
  if 'R' in xy or 'C' in xy: i+=1
  status='conflict' if xy in ('DD','AU','UD','UA','DU','AA','UU') else 'ignored' if xy=='!!' else 'untracked' if xy=='??' else 'deleted' if 'D' in xy else 'renamed' if 'R' in xy or 'C' in xy else 'added' if 'A' in xy else 'modified'
  while path!=base and os.path.commonpath([base,path])==base:
   display=os.path.normpath(os.path.join(root,os.path.relpath(path,os.path.realpath(root))))
   if priority[status]>=priority.get(result.get(display),-1): result[display]=status
   path=os.path.dirname(path)
 print(json.dumps(result))
except (OSError,subprocess.TimeoutExpired): print('{}')`;
export const FILE_STATUS = Object.freeze({
  modified: ['fileModified', '수정됨'], added: ['fileAdded', '추가됨'],
  untracked: ['fileUntracked', '추적 안 됨'], renamed: ['fileRenamed', '이름 변경'],
  deleted: ['fileDeleted', '삭제됨'], conflict: ['fileConflict', '충돌'],
  ignored: ['fileIgnored', 'Git 제외'],
});
