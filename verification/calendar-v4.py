#!/usr/bin/env python3
"""Apply reviewed Calendar diagnostics to an explicit, clean, isolated Git checkout.
No network calls or deployment. All source guards run before transactional replacement.
"""
import hashlib, os, stat, subprocess, sys, tempfile
from pathlib import Path

EXPECTED = {'lib/google/events.js':'d4e3576b83de39164f1db5d213360b6299497cef',
            'calendar-sync.js':'0a48b73cef7492d15b55f5c1b00accfd57f14281'}
BASE='63e19259784ad70f301db926cd8fbf7d8a19c554'
def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True,stderr=subprocess.DEVNULL).strip()
def blob(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def once(s,a,b):
    if s.count(a)!=1:raise ValueError('Expected exactly one source anchor')
    return s.replace(a,b)
def main():
    if len(sys.argv)!=2:raise ValueError('Supply explicit isolated Git checkout path')
    root=Path(sys.argv[1]).absolute()
    if not root.is_dir() or root.is_symlink() or git(root,'rev-parse','--show-toplevel')!=str(root.resolve()):raise ValueError('Not a Git root')
    if git(root,'rev-parse','HEAD')!=BASE:raise ValueError('Wrong checkout revision')
    if git(root,'status','--porcelain'):raise ValueError('Checkout must be clean')
    gitdir=root/'.git'
    if gitdir.is_symlink() or not gitdir.is_dir():raise ValueError('Require real standalone .git directory')
    if Path(git(root,'rev-parse','--absolute-git-dir')).resolve()!=gitdir.resolve():raise ValueError('Unexpected Git directory')
    if Path(git(root,'rev-parse','--path-format=absolute','--git-common-dir')).resolve()!=gitdir.resolve():raise ValueError('Shared Git metadata is prohibited')
    original={}; paths={}
    for name,sha in EXPECTED.items():
        p=root/name
        if p.is_symlink() or not p.is_file() or p.resolve().is_relative_to(root.resolve()) is False:raise ValueError('Unsafe path '+name)
        data=p.read_bytes()
        if blob(data)!=sha:raise ValueError('Unexpected source blob '+name)
        original[name]=data;paths[name]=p
    s=original['lib/google/events.js'].decode();c=original['calendar-sync.js'].decode()
    s=once(s,'    try {\n      const instant = new Date(now());','    let stage = "CONNECTION_STORE";\n    const observed = new Set();\n    function note(stageName) {\n      if (!observed.has(stageName)) { observed.add(stageName); console.error("GOOGLE_CALENDAR_READ_FAILED", { stage: stageName }); }\n    }\n    try {\n      const instant = new Date(now());')
    s=once(s,'      const tokenResponse = await read("https://oauth2.googleapis.com/token", {','      stage = "TOKEN_REFRESH";\n      const tokenResponse = await read("https://oauth2.googleapis.com/token", {')
    s=once(s,'      const calendars = [];','      stage = "CALENDAR_LIST";\n      const calendars = [];')
    s=once(s,'          limitations.add("CALENDAR_LIST_INCOMPLETE");\n          break;','          limitations.add("CALENDAR_LIST_INCOMPLETE");\n          note("CALENDAR_LIST");\n          break;')
    s=once(s,'      for (const calendar of calendars) {\n        const sourceEvents = [];','      stage = "EVENT_READ";\n      for (const calendar of calendars) {\n        const sourceEvents = [];')
    s=once(s,'          } catch {\n            break;\n          }','          } catch {\n            note("EVENT_READ");\n            break;\n          }')
    s=once(s,'          if (typeof data.nextPageToken !== "string" || eventTokens.has(data.nextPageToken)) {\n            break;','          if (typeof data.nextPageToken !== "string" || eventTokens.has(data.nextPageToken)) {\n            note("EVENT_READ");\n            break;')
    s=once(s,'''    } catch {
      // Provider response content, token values and error objects must never be
      // emitted into diagnostics or returned to the client.
      return res.status(503).json({ error: "Could not load Google Calendar events." });
    }''','''    } catch {
      note(stage);
      return res.status(503).json({ error: "Could not load Google Calendar events.", code: "GOOGLE_CALENDAR_READ_FAILED", stage });
    }''')
    c=once(c,'''    try {
      return await Promise.race([timeout,(async()=>{
        const response=await fetchImpl('/api/google/events',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const data=await response.json();
        if(!response.ok || !data.connected || !Array.isArray(data.events))throw new Error('Calendar unavailable');
        return data;
      })()]);
    } finally {clearTimeoutFn(timer);}''','''    let httpStatus = null;
    const failure = (data=null, message='Calendar unavailable') => {
      const error = new Error(message);
      error.calendarCode = data && data.code === 'GOOGLE_CALENDAR_READ_FAILED' ? 'GOOGLE_CALENDAR_READ_FAILED' : 'CALENDAR_UNAVAILABLE';
      error.calendarStage = data && ['CONNECTION_STORE','TOKEN_REFRESH','CALENDAR_LIST','EVENT_READ'].includes(data.stage) ? data.stage : 'UNKNOWN';
      error.httpStatus = httpStatus;
      return error;
    };
    try {
      return await Promise.race([timeout,(async()=>{
        let response;
        try { response=await fetchImpl('/api/google/events',{cache:'no-store',credentials:'same-origin',signal:controller.signal}); }
        catch { throw failure(); }
        httpStatus = Number.isInteger(response?.status) ? response.status : null;
        let data;
        try { data=await response.json(); } catch { throw failure(); }
        if(!response.ok || !data || typeof data !== 'object' || !data.connected || !Array.isArray(data.events)) throw failure(data);
        return data;
      })()]);
    } catch (error) {
      if (error?.calendarCode) throw error;
      throw failure(null,error?.message === 'Calendar request timed out' ? 'Calendar request timed out' : 'Calendar unavailable');
    } finally {clearTimeoutFn(timer);}''')
    output={'lib/google/events.js':s.encode(),'calendar-sync.js':c.encode()}
    staged={}; replaced=[]; rollback_errors=[]
    modes={name:stat.S_IMODE(paths[name].stat().st_mode) for name in output}
    def stage(name, data, prefix, mode):
        fd,tmp=tempfile.mkstemp(prefix=prefix,dir=paths[name].parent)
        staged[name]=tmp  # register before any write, fsync or chmod
        with os.fdopen(fd,'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp,mode)
        return tmp
    try:
        for name,data in output.items():
            stage(name,data,'.james-calendar-',modes[name])
        for name in output:
            os.replace(staged[name],paths[name])
            replaced.append(name)
            staged.pop(name,None)  # remove only after successful replace
    except BaseException as failure:
        for name in reversed(replaced):
            try:
                tmp=stage(name,original[name],'.james-rollback-',modes[name])
                os.replace(tmp,paths[name]);staged.pop(name,None)
            except BaseException as rollback_failure:
                rollback_errors.append((name,str(type(rollback_failure).__name__)))
        if rollback_errors:
            raise RuntimeError('Patch failed; rollback incomplete for '+repr(rollback_errors)+
                               '. Inspect isolated checkout before retrying.') from failure
        raise
    finally:
        cleanup_errors=[]
        for tmp in staged.values():
            try:
                if os.path.lexists(tmp):os.unlink(tmp)
            except OSError as cleanup_failure:
                cleanup_errors.append((tmp,type(cleanup_failure).__name__))
        if cleanup_errors:
            # Preserve the primary exception and its traceback, if present.
            # Explicitly identify the residual paths for manual recovery.
            details='; '.join(f'{path} ({kind})' for path,kind in cleanup_errors)
            if sys.exc_info()[0] is not None:
                print('WARNING: incomplete cleanup; inspect and remove before retry: '+details,file=sys.stderr)
            else:
                raise RuntimeError('Incomplete cleanup; inspect and remove before retry: '+details)
    print('Applied isolated v4 diagnostic correction; run regression suite before review.')
if __name__=='__main__':main()
