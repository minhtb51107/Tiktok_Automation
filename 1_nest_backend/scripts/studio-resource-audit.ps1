$ErrorActionPreference='Stop'
$os=Get-CimInstance Win32_OperatingSystem
$all=@(Get-Process)
$auditParentPid=(Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$tcpError=$null
try{$tcp=@(Get-NetTCPConnection -State Listen -ErrorAction Stop)}catch{$tcp=@();$tcpError=$_.Exception.GetType().Name}
$listeners=@($tcp | Where-Object {$_.LocalPort -ge 3105 -and $_.LocalPort -le 3110} | ForEach-Object {
 $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
 [pscustomobject]@{port=$_.LocalPort;address=$_.LocalAddress;pid=$_.OwningProcess;startedAt=$owner.CreationDate.ToUniversalTime().ToString('o');executable=$owner.ExecutablePath;workingDirectory=$null;cwdEvidence='Win32_Process does not expose CWD; do not infer from executable path'}
})
$httpProbes=@(3105..3110|ForEach-Object { $port=$_;try{$response=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/studio/runtime?audit=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 2 -Headers @{'Cache-Control'='no-cache'} -ErrorAction Stop;$data=if($response.data){$response.data}else{$response};[pscustomobject]@{port=$port;status='HTTP_REACHABLE';mode=$data.mode}}catch{[pscustomobject]@{port=$port;status='HTTP_UNREACHABLE_OR_ERROR';mode=$null}}})
$workers=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(node|python|pythonw)\.exe$'} | ForEach-Object {
 $procId=$_.ProcessId;$live=$all | Where-Object Id -eq $procId
 $kind=if($procId -eq $auditParentPid){'OWNED_AUDIT_PROCESS'}elseif($_.CommandLine -match '(e2e01-runtime|studio-start|kokoro-studio)\.(cjs|py)'){'PROJECT_CANDIDATE'}elseif($_.CommandLine -match 'artifact-tool.*host-daemon\.mjs'){'CODEX_ARTIFACT_DAEMON_NOT_STUDIO'}else{'UNRELATED_OR_UNVERIFIED'}
 [pscustomobject]@{pid=$procId;parentPid=$_.ParentProcessId;startedAt=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name;kind=$kind;rssMiB=[math]::Round($live.WorkingSet64/1MB,2);privateMiB=[math]::Round($live.PrivateMemorySize64/1MB,2);workingDirectory=$null}
})
$browsers=@($all | Where-Object ProcessName -in @('chrome','msedge','msedgewebview2'))
[pscustomobject]@{
 at=(Get-Date).ToUniversalTime().ToString('o');physicalTotalMiB=[math]::Round($os.TotalVisibleMemorySize/1024,2);availableMiB=[math]::Round($os.FreePhysicalMemory/1024,2)
 commitLimitMiB=[math]::Round($os.TotalVirtualMemorySize/1024,2);commitUsedMiB=[math]::Round(($os.TotalVirtualMemorySize-$os.FreeVirtualMemory)/1024,2)
 pagefiles=@(Get-CimInstance Win32_PageFileUsage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage)
 listeners=$listeners;tcpEnumerationError=$tcpError;httpProbes=$httpProbes;workers=$workers;browserProcessCount=$browsers.Count;browserRssMiB=[math]::Round(($browsers|Measure-Object WorkingSet64 -Sum).Sum/1MB,2)
 topProcesses=@($all|Sort-Object WorkingSet64 -Descending|Select-Object -First 10 Id,ProcessName,@{n='rssMiB';e={[math]::Round($_.WorkingSet64/1MB,2)}})
 action='READ_ONLY: no process termination, pagefile or Windows changes'
}|ConvertTo-Json -Depth 7 -Compress
