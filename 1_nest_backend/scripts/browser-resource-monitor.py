"""Windows native guardian. Only fresh browser children of its owner are eligible.
Captured process handles survive PID reuse; cleanup never terminates by PID/name.
No network, credentials, Torch, pagefile changes or external process termination.
"""
import ctypes, json, os, queue, sys, threading, time
from ctypes import wintypes
from kokoro_memory import memory_sample, ProcessMemory

class Entry(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]

class Basic(ctypes.Structure):
    _fields_=[(n,ctypes.c_void_p) for n in ('reserved','peb','r1','r2','pid','parent')]

class Guardian:
    def __init__(self,owner,test=False):
        self.owner=owner;self.handles={};self.forced=[];self.roots=set();self.test=test
        self.k=ctypes.WinDLL('kernel32',use_last_error=True);self.api=ctypes.WinDLL('psapi',use_last_error=True);self.nt=ctypes.WinDLL('ntdll')
        self.k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];self.k.OpenProcess.restype=wintypes.HANDLE
        self.k.CloseHandle.argtypes=[wintypes.HANDLE]
        self.k.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        self.k.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT]
        self.k.GetProcessTimes.argtypes=[wintypes.HANDLE]+[ctypes.POINTER(wintypes.FILETIME)]*4
        self.k.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD];self.k.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
        self.k.Process32FirstW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)];self.k.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
        self.nt.NtQueryInformationProcess.argtypes=[wintypes.HANDLE,wintypes.ULONG,ctypes.c_void_p,wintypes.ULONG,ctypes.c_void_p]
        self.api.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(ProcessMemory),wintypes.DWORD]
        self.owner_handle=self.k.OpenProcess(0x1000|0x100000,False,owner)
        if not self.owner_handle or owner!=os.getppid():raise RuntimeError('OWNER_NOT_PARENT')
        self.since=time.time_ns()//100+116444736000000000 # FILETIME epoch, excludes pre-existing children.
    def running(self,h):return self.k.WaitForSingleObject(h,0)==258
    def identity(self,h):
        info=Basic();created,exited,kernel,user=(wintypes.FILETIME() for _ in range(4))
        if self.nt.NtQueryInformationProcess(h,0,ctypes.byref(info),ctypes.sizeof(info),None)!=0 or not self.k.GetProcessTimes(h,ctypes.byref(created),ctypes.byref(exited),ctypes.byref(kernel),ctypes.byref(user)):raise RuntimeError('PROCESS_IDENTITY_UNAVAILABLE')
        return int(info.pid or 0),int(info.parent or 0),(created.dwHighDateTime<<32)|created.dwLowDateTime
    def rows(self):
        h=self.k.CreateToolhelp32Snapshot(2,0)
        if h==ctypes.c_void_p(-1).value:raise RuntimeError('SNAPSHOT_UNAVAILABLE')
        e=Entry();e.size=ctypes.sizeof(e);rows=[]
        try:
            ok=self.k.Process32FirstW(h,ctypes.byref(e))
            while ok:rows.append((e.pid,e.parent,e.exe.lower()));ok=self.k.Process32NextW(h,ctypes.byref(e))
        finally:self.k.CloseHandle(h)
        return rows
    def discover(self):
        rows=self.rows();allowed={'chrome.exe','msedge.exe','chrome-headless-shell.exe','headless_shell.exe'}
        if self.test:allowed.add('node.exe') # Explicit offline fixture only; production never passes this flag.
        for _ in range(12):
            changed=False
            for pid,parent,name in rows:
                if pid in self.handles:continue
                root=parent==self.owner and name in allowed
                if not root and (parent not in self.handles or not self.running(self.handles[parent]['handle'])):continue
                if root and not self.running(self.owner_handle):continue
                h=self.k.OpenProcess(0x1000|0x10|0x1|0x100000,False,pid)
                if not h:continue
                try:
                    actual,ppid,created=self.identity(h)
                    lower=self.since if root else self.handles[parent]['created']
                    if actual!=pid or ppid!=parent or created<lower:continue
                    self.handles[pid]={'handle':h,'created':created};h=None;changed=True
                    if root:self.roots.add(pid)
                finally:
                    if h:self.k.CloseHandle(h)
            if not changed:break
    def sample(self):
        self.discover();s=memory_sample();rss=private=0
        for proc in self.handles.values():
            if not self.running(proc['handle']):continue
            m=ProcessMemory();m.cb=ctypes.sizeof(m)
            if self.api.GetProcessMemoryInfo(proc['handle'],ctypes.byref(m),m.cb):rss+=m.workingSet;private+=m.privateBytes
        return {'availableMiB':s['availableMiB'],'systemCommitAvailableMiB':s['systemCommitAvailableMiB'],'systemCommitUsedMiB':s['systemCommitUsedMiB'],'systemCommitLimitMiB':s['systemCommitLimitMiB'],'browserRssMiB':round(rss/1024**2,2),'browserPrivateMiB':round(private/1024**2,2),'ownedPids':list(self.handles)}
    def cleanup(self):
        self.discover()
        for pid,proc in reversed(list(self.handles.items())):
            if self.running(proc['handle']) and self.k.TerminateProcess(proc['handle'],1):self.forced.append(pid)
        for proc in self.handles.values():self.k.WaitForSingleObject(proc['handle'],500)
        remaining=[pid for pid,proc in self.handles.items() if self.running(proc['handle'])]
        return {'ownedPids':list(self.handles),'forcedPids':self.forced,'remainingPids':remaining}
    def close(self):
        for proc in self.handles.values():self.k.CloseHandle(proc['handle'])
        self.k.CloseHandle(self.owner_handle)

def emit(x):print(json.dumps(x),flush=True)
def main():
    owner,deadline,physical,commit=int(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4])
    g=Guardian(owner,'--test-owned-node' in sys.argv);commands=queue.Queue();started=time.monotonic();stopped=False
    def read():
        for line in sys.stdin:
            try:commands.put(json.loads(line))
            except Exception:commands.put({'op':'invalid'})
        commands.put({'op':'shutdown'})
    threading.Thread(target=read,daemon=True).start()
    try:
        while True:
            s=g.sample();emit({'event':'sample','sample':s})
            emergency='CONVERSATION_RESOURCE_GUARD_STOP_PHYSICAL' if s['availableMiB']<physical else 'CONVERSATION_RESOURCE_GUARD_STOP_COMMIT' if s['systemCommitAvailableMiB']<commit else None
            ended=time.monotonic()-started>deadline or not g.running(g.owner_handle)
            if not stopped and (emergency or ended):
                stopped=True;emit({'event':'stop','code':emergency or 'CONVERSATION_TIME_BUDGET'});emit({'event':'cleanup',**g.cleanup()})
            if ended:break
            if stopped:g.cleanup() # Catches a late child from an already aborted launch.
            try:cmd=commands.get(timeout=0.25)
            except queue.Empty:continue
            if cmd.get('op')=='track':
                g.discover();emit({'event':'tracked','pid':cmd.get('pid'),'accepted':cmd.get('pid') in g.roots})
            elif cmd.get('op')=='cleanup':emit({'event':'cleanup',**g.cleanup()})
            elif cmd.get('op')=='shutdown':emit({'event':'cleanup',**g.cleanup()});break
    finally:
        try:g.cleanup()
        finally:g.close()

if __name__=='__main__':
    try:main()
    except Exception:emit({'event':'stop','code':'CONVERSATION_RESOURCE_MEASUREMENT_UNAVAILABLE'});sys.exit(1)
