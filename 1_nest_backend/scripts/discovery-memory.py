"""Read-only Windows browser-tree samples. No Torch, network or process termination."""
import ctypes, json, os, sys, time
from ctypes import wintypes
from kokoro_memory import memory_sample, ProcessMemory

class Entry(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),
      ('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),
      ('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]

def sample_tree(root):
    k=ctypes.WinDLL('kernel32',use_last_error=True)
    k.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD];k.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    k.Process32FirstW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
    k.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
    k.CloseHandle.argtypes=[wintypes.HANDLE]
    k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE
    api=ctypes.WinDLL('psapi',use_last_error=True)
    api.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(ProcessMemory),wintypes.DWORD]
    h=k.CreateToolhelp32Snapshot(2,0)
    if h==ctypes.c_void_p(-1).value: raise OSError('Process snapshot unavailable')
    rows=[];entry=Entry();entry.size=ctypes.sizeof(entry)
    try:
        ok=k.Process32FirstW(h,ctypes.byref(entry))
        while ok:
            rows.append((entry.pid,entry.parent,entry.exe.lower()));ok=k.Process32NextW(h,ctypes.byref(entry))
    finally:k.CloseHandle(h)
    owned={root}
    for _ in range(10):
        previous=len(owned);owned.update(pid for pid,parent,_ in rows if parent in owned)
        if len(owned)==previous:break
    processes=[]
    for pid,parent,exe in rows:
        if pid not in owned or exe not in ('chrome.exe','msedge.exe','chrome_crashpad_handler.exe'):continue
        ph=k.OpenProcess(0x1010,False,pid)
        if not ph:continue
        try:
            m=ProcessMemory();m.cb=ctypes.sizeof(m)
            if api.GetProcessMemoryInfo(ph,ctypes.byref(m),m.cb):processes.append({'pid':pid,'rssMiB':round(m.workingSet/1024**2,2),'privateMiB':round(m.privateBytes/1024**2,2)})
        finally:k.CloseHandle(ph)
    return processes

if __name__=='__main__':
    root,out,stop=int(sys.argv[1]),sys.argv[2],sys.argv[3]
    with open(out,'x',encoding='utf-8') as f:
        for _ in range(420):
            if os.path.exists(stop):break
            try:
                system=memory_sample();processes=sample_tree(root)
                f.write(json.dumps({'system':system,'browserProcesses':processes,'browserRssMiB':round(sum(p['rssMiB'] for p in processes),2),'browserPrivateMiB':round(sum(p['privateMiB'] for p in processes),2)})+'\n');f.flush()
            except Exception as e:
                f.write(json.dumps({'measurementError':type(e).__name__})+'\n');f.flush()
            time.sleep(1)
