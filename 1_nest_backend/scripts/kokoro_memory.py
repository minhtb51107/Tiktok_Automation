"""Owned-process Windows measurements; no Torch/psutil, no process enumeration."""
import ctypes, os, time
from ctypes import wintypes

class MemoryStatus(ctypes.Structure):
    _fields_=[('length',wintypes.DWORD),('load',wintypes.DWORD)]+[(name,ctypes.c_ulonglong) for name in ('physicalTotal','physicalAvailable','commitLimit','commitAvailable','virtualTotal','virtualAvailable','extendedAvailable')]

class ProcessMemory(ctypes.Structure):
    _fields_=[('cb',wintypes.DWORD),('pageFaults',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in ('peakWorkingSet','workingSet','peakPagedPool','pagedPool','peakNonPagedPool','nonPagedPool','pagefile','peakPagefile','privateBytes')]

def memory_sample():
    if os.name!='nt':
        return None  # Do not invent Windows RSS/commit measurements on another OS.
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.GetCurrentProcess.restype=ctypes.c_void_p
    psapi=ctypes.WinDLL('psapi',use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.POINTER(ProcessMemory),wintypes.DWORD]
    system=MemoryStatus();system.length=ctypes.sizeof(system)
    process=ProcessMemory();process.cb=ctypes.sizeof(process)
    if not kernel.GlobalMemoryStatusEx(ctypes.byref(system)) or not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(process),process.cb):
        raise OSError('Native memory measurement unavailable')
    mib=1024**2
    return {'atMs':round(time.time()*1000),'pid':os.getpid(),'rssMiB':round(process.workingSet/mib,2),'privateMiB':round(process.privateBytes/mib,2),'peakRssMiB':round(process.peakWorkingSet/mib,2),'peakCommitMiB':round(process.peakPagefile/mib,2),'availableMiB':round(system.physicalAvailable/mib,2),'systemCommitUsedMiB':round((system.commitLimit-system.commitAvailable)/mib,2)}

if __name__=='__main__':
    import json
    print(json.dumps(memory_sample()))
