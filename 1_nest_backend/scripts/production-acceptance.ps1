# Run in a regular Windows PowerShell window, independently of any IDE.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Start','Status','Stop','Check')][string]$Action,
    [string]$DataRoot = (Join-Path $env:TEMP 'production-auto-v121-saved-FAEjyj'),
    [string]$BatchId = '97ce64ca-8ee6-4cde-92e1-741130c97587',
    [string]$SessionId = '578a7376-0afc-41be-b032-3b593643d77b',
    [string]$SourceId = 'DYFgbQ2k-FR',
    [ValidateRange(1024,65535)][int]$Port = 57374,
    [string]$RuntimeConfig,
    [switch]$RetryTimeout,
    [switch]$ContinueAdmission,
    [switch]$BatchPilot,
    [ValidateNotNullOrEmpty()][string]$Topics = 'kinh nghi'+[char]0x1EC7+'m '+[char]0x0111+'i l'+[char]0x00E0+'m',
    [ValidateRange(1,3)][int]$VideoTarget = 3,
    [ValidateRange(1,15)][int]$AttemptBudget = 15,
    [ValidateRange(1,120)][int]$AiRequestBudget = 120,
    [switch]$UseSchedule,
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')][string]$ScheduleStart = '23:00',
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')][string]$ScheduleEnd = '07:00',
    [ValidateRange(1,1440)][int]$MaxRunMinutes = 180,
    [string]$ItemId = '5ffe9fd3-06e0-44a7-bea2-4a9ceebc164f'
)
$ErrorActionPreference = 'Stop'
if ($ContinueAdmission -and $RetryTimeout) { throw 'Select one recovery operation.' }
if ($ContinueAdmission -and !$PSBoundParameters.ContainsKey('ItemId')) { $ItemId = '18ff2031-b1c4-4b4d-a72e-3605179b4c99' }
$backend = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($BatchPilot) {
    if ($ContinueAdmission -or $RetryTimeout) { throw 'BatchPilot uses fresh discovery.' }
    if (!$PSBoundParameters.ContainsKey('DataRoot')) { $DataRoot = Join-Path $env:TEMP 'production-auto-v123-live-pilot' }
    $DataRoot = [IO.Path]::GetFullPath($DataRoot)
    $marker = Join-Path $DataRoot '.standalone-batch-pilot-v1'
    if ($Action -in @('Start','Check') -and !(Test-Path -LiteralPath $DataRoot)) {
        $null=New-Item -ItemType Directory -Path $DataRoot
    }
    if (!(Test-Path -LiteralPath $DataRoot)) {
        [pscustomobject]@{runtimeOnline=$false; savedPolicy='UNINITIALIZED'; dataRoot=$DataRoot} | ConvertTo-Json
        return
    }
    if ((Get-Item -LiteralPath $DataRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'BatchPilot data root must be a dedicated directory.'
    }
    if (!(Test-Path -LiteralPath $marker -PathType Leaf)) {
        if ($Action -notin @('Start','Check') -or @(Get-ChildItem -LiteralPath $DataRoot -Force).Count) {
            throw 'BatchPilot requires an empty or previously initialized pilot data root.'
        }
        $null=New-Item -ItemType File -Path $marker
    }
    $pilotPolicy=@{
        topics=@($Topics.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
        dailyVideoLimit=$VideoTarget; dailyAttemptLimit=$AttemptBudget; dailyAiRequestLimit=$AiRequestBudget
        schedule=@{enabled=$UseSchedule.IsPresent;start=$ScheduleStart;end=$ScheduleEnd}
        renderPreset='1080P60'; approvalPolicy='EXCEPTION_ONLY'; dailyRerenderLimit=0
    }
    if (!$pilotPolicy.topics.Count -or $ScheduleStart -eq $ScheduleEnd) { throw 'Invalid pilot topic or schedule.' }
}
$root = (Resolve-Path -LiteralPath $DataRoot).Path
if ([guid]::Parse($BatchId).ToString() -cne $BatchId -or
    [guid]::Parse($ItemId).ToString() -cne $ItemId -or
    [guid]::Parse($SessionId).ToString() -cne $SessionId -or $SourceId -notmatch '^[a-zA-Z0-9_-]+$') {
    throw 'Invalid saved production identifiers.'
}
$batchPath = Join-Path $root "product-jobs/autonomous/$BatchId.json"
$policyPath = Join-Path $root 'automation/policy.json'
$ops = Join-Path $root 'standalone-acceptance'
$statePath = Join-Path $ops 'active.json'
$reportPath = Join-Path $ops 'latest-report.json'
$renderRoot = Join-Path $root "renders/$SessionId"
$api = "http://127.0.0.1:$Port/api/studio/automation"
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
function Write-Json([string]$Path, $Value) {
    $tmp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($tmp,$Path,"$Path.previous") } else { [IO.File]::Move($tmp,$Path) }
}
function Get-Owned($State) {
    if (!$State -or $State.root -ne $root -or [int]$State.port -ne $Port) { return $null }
    $p = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node' -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $State.started) { $p }
}
function Call-Api([string]$Route, [string]$Method = 'GET', $Body = $null) {
    $params = @{ Uri="$api/$Route"; Method=$Method; Headers=@{Authorization="Bearer $token"}; TimeoutSec=10 }
    if ($null -ne $Body) { $params.ContentType='application/json'; $params.Body=$Body | ConvertTo-Json -Depth 12 -Compress }
    $response = Invoke-RestMethod @params
    if ($null -ne $response.data) { return $response.data }
    $response
}
function Request-Drain {
    for ($attempt=0; $attempt -lt 3; $attempt++) {
        $current = Call-Api status
        if ($current.policy.mode -in @('DISABLED','DRAINING')) { return $current }
        try {
            return (Call-Api stop POST @{ requestId=[guid]::NewGuid().ToString(); revision=$current.policy.revision })
        } catch { if ($attempt -eq 2) { throw }; Start-Sleep -Milliseconds 300 }
    }
}
function Read-Outcome {
    $batch = Read-Json $batchPath
    $rows = @($batch.results | Where-Object { $_.sessionId -eq $SessionId -and $_.selectedSourceIds[0] -ceq $SourceId })
    if ($batch.id -ne $BatchId -or $rows.Count -ne 1) { throw 'Saved candidate does not match its batch and session.' }
    [pscustomobject]@{ batch=$batch; row=$rows[0] }
}
function Read-VoiceFailure {
    $session=Read-Json (Join-Path $root "$SessionId.json")
    $last=@($session.voiceJobs | Select-Object -Last 1)
    if ($last.Count -eq 1 -and $last[0].status -eq 'ERROR') {
        $job=$last[0]
        $progress=$job.resourceDiagnostics.chunkProgress | Select-Object -Last 1
        [pscustomobject]@{failureCategory=$job.failureCategory; error=$job.error; itemId=$job.itemId;
            failedAt=$job.completedAt; elapsedMs=$job.elapsedMs; completedChunks=$progress.index;
            totalChunks=$progress.total; checkpointReference=$job.checkpointReference}
    }
}
function Get-ValidatedVideo($Outcome,[string]$ExpectedSession=$SessionId,[string]$ExpectedSource=$SourceId,$Inventory=$null) {
    $row = $Outcome.row
    if ($row.status -ne 'COMPLETED' -or $row.artifact.validation -ne 'MACHINE_VALIDATED') { return $null }
    $job = [guid]::Parse([string]$row.renderJobId).ToString()
    $session = [guid]::Parse($ExpectedSession).ToString()
    $folder = Join-Path (Join-Path $root "renders/$session") $job
    $video = Join-Path $folder 'video.mp4'
    $manifest = Read-Json (Join-Path $folder 'manifest.json')
    if ($null -eq $Inventory) { $Inventory=@(Call-Api videos) }
    $matching = @($Inventory | Where-Object { $_.sessionId -eq $session -and $_.rootSourceId -ceq $ExpectedSource })
    $version = @($matching | ForEach-Object { $_.versions } | Where-Object { $_.renderJobId -eq $job })
    $sha = (Get-FileHash -LiteralPath $video -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifest.status -ne 'COMPLETED' -or $manifest.preset -ne '1080P60' -or
        $manifest.metrics.executionStrategy -ne 'SPARSE_STATIC' -or $row.artifact.preset -ne '1080P60' -or
        $version.Count -ne 1 -or $sha -cne $version[0].sha256 -or $sha -cne $row.artifact.sha256) {
        throw 'The saved MP4 failed standalone acceptance checks.'
    }
    @{ path=$video; renderJobId=$job; sha256=$sha; artifact=$row.artifact; manifest=(Join-Path $folder 'manifest.json') }
}

function Get-PilotArtifacts($Batches,$Inventory) {
    $discovered = @($Batches | Where-Object { $_.discoveryRunId -and $_.collected.execution -eq 'LIVE' } | ForEach-Object { $_.collected.discoveredSourceIds })
    $roots=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $hashes=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($batch in $Batches) {
        foreach($row in @($batch.results | Where-Object { $_.status -eq 'COMPLETED' })) {
            $source=$row.selectedSourceIds[0]
            if ($source -ceq $SourceId -or $discovered -cnotcontains $source) { continue }
            try {
                $video=Get-ValidatedVideo @{row=$row} $row.sessionId $source $Inventory
                if ($video -and !$roots.Contains($source) -and $hashes.Add($video.sha256)) {
                    $null=$roots.Add($source)
                    $video.sourceId=$source
                    $video.sourceUrl=$row.sourceUrl
                    $video.sessionId=$row.sessionId
                    $video.audioExecution=$row.audioExecution
                    $video.measuredAudioSeconds=$row.measuredSeconds
                    $video.timelineSeconds=$row.timelineSeconds
                    $video.ttsElapsedMs=[long](($row.audioExecution | ForEach-Object { [long]$_.elapsedMs } | Measure-Object -Sum).Sum)
                    $video.renderElapsedMs=$row.artifact.metrics.endToEndMs
                    $video.renderMetrics=$row.artifact.metrics
                    $video
                }
            } catch {
                $final.artifactFailures+=@(@{sourceId=$source;renderJobId=$row.renderJobId;error=$_.Exception.Message})
            }
        }
    }
}

if ($Action -in @('Status','Stop')) {
    $state = if (Test-Path -LiteralPath $statePath) { Read-Json $statePath }
    $outcome = if (!$BatchPilot) { Read-Outcome }
    $live = $null
    if (Get-Owned $state) {
        $token = [Net.NetworkCredential]::new('', (ConvertTo-SecureString $state.credential)).Password
        if ($Action -eq 'Stop') { $null = Request-Drain }
        $live = Call-Api status
    }
    if ($BatchPilot) {
        $mode=if(Test-Path -LiteralPath $policyPath){(Read-Json $policyPath).mode}else{'DISABLED'}
        [pscustomobject]@{runtimeOnline=($null -ne $live);api=$live;savedPolicy=$mode;dataRoot=$root
            logDirectory=$state.logDirectory;report=$reportPath} | ConvertTo-Json -Depth 12
        return
    }
    [pscustomobject]@{
        runtimeOnline=($null -ne $live); api=$live; savedPolicy=(Read-Json $policyPath).mode
        batchStatus=$outcome.batch.status; stage=$outcome.batch.stage; candidateStatus=$outcome.row.status
        ttsWait=$outcome.batch.ttsWait; timeoutRecovery=$outcome.batch.ttsTimeoutRecovery; admissionContinuation=$outcome.batch.ttsAdmissionContinuation; voiceFailure=(Read-VoiceFailure); renderJobId=$outcome.row.renderJobId; mp4Root=$renderRoot
        logDirectory=$state.logDirectory; report=$reportPath
    } | ConvertTo-Json -Depth 20
    return
}

$null = New-Item -ItemType Directory -Path $ops -Force
$machineLock = [IO.File]::Open((Join-Path $env:TEMP 'tiktok-automation-standalone-production.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try { $lock = [IO.File]::Open((Join-Path $ops 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { $machineLock.Dispose(); throw }
$worker = $null
$writeReport = $false
$originalReviewLimit = $null
$final = [ordered]@{ result='ERROR'; startedAt=(Get-Date).ToString('o'); dataRoot=$root; batchId=$BatchId; sessionId=$SessionId; sourceId=$SourceId }
try {
    if (Test-Path -LiteralPath $statePath) {
        if (Get-Owned (Read-Json $statePath)) { throw 'An owned backend is already present. Use Status or Stop.' }
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already occupied."
    }
    $outcome = if (!$BatchPilot) { Read-Outcome }
    $policy = if (Test-Path -LiteralPath $policyPath) { Read-Json $policyPath }
    if (!$BatchPilot -and ($policy.mode -notin @('DISABLED','BLOCKED') -or $policy.dailyVideoLimit -ne 1 -or $policy.renderPreset -ne '1080P60')) {
        throw 'Expected the existing one-video 1080P60 policy in DISABLED or BLOCKED mode.'
    }
    $reattach = $BatchPilot -and $policy.mode -in @('ENABLED','DRAINING')
    if ($BatchPilot) {
        if ($reattach) {
            if ($Action -ne 'Start' -or !$policy.pilotWindow -or $pilotPolicy.dailyVideoLimit -ne $policy.dailyVideoLimit -or
                $pilotPolicy.dailyAttemptLimit -ne $policy.dailyAttemptLimit -or $pilotPolicy.dailyAiRequestLimit -ne $policy.dailyAiRequestLimit -or
                $pilotPolicy.schedule.enabled -ne $policy.schedule.enabled -or $ScheduleStart -ne $policy.schedule.start -or
                $ScheduleEnd -ne $policy.schedule.end -or ($pilotPolicy.topics -join ',') -cne ($policy.topics -join ',')) {
                throw 'An interrupted pilot must be resumed with its original configuration.'
            }
        }
        $final.mode='BATCH_PILOT'
        $final.configuration=$pilotPolicy
        $final.Remove('batchId'); $final.Remove('sessionId'); $final.Remove('sourceId')
        $final.artifactFailures=@()
    } elseif ($Action -eq 'Start' -and $ContinueAdmission) {
        $failure=Read-VoiceFailure
        $prior=$outcome.batch.ttsTimeoutRecovery
        if ($outcome.batch.ttsAdmissionContinuation -or $outcome.batch.status -ne 'BLOCKED' -or
            $prior.status -ne 'BLOCKED' -or $prior.blockReason -ne 'RETRY_EXHAUSTED' -or
            $failure.itemId -ne $ItemId -or $failure.error -ne 'RESOURCE_GUARD_STOP: sustained WARM headroom admission denied' -or
            $outcome.row.renderJobId) {
            throw 'The exact saved admission denial is stale, ineligible or already authorized.'
        }
    } elseif ($Action -eq 'Start' -and $RetryTimeout) {
        $failure=Read-VoiceFailure
        if ($outcome.batch.ttsTimeoutRecovery -or $outcome.batch.ttsWait.status -ne 'RESOLVED' -or
            $outcome.batch.ttsWait.retries -ne 1 -or $outcome.row.status -ne 'TTS_FAILED' -or
            $failure.failureCategory -ne 'TIMEOUT' -or $failure.itemId -ne $ItemId -or $outcome.row.renderJobId) {
            throw 'The exact saved timeout is stale, ineligible or already authorized.'
        }
    } elseif ($Action -eq 'Start' -and ($outcome.batch.ttsWait.status -ne 'BLOCKED' -or
        $outcome.batch.ttsWait.blockReason -ne 'ADMISSION_DENIED' -or $outcome.batch.ttsWait.retries -ne 0 -or
        $outcome.row.renderJobId)) { throw 'The exact saved admission checkpoint is not eligible. Use -RetryTimeout for a saved timeout or -ContinueAdmission for the warm admission denial.' }
    $build = Join-Path $backend 'dist/main.js'
    if (!(Test-Path -LiteralPath $build -PathType Leaf)) { throw 'The current backend build is missing.' }
    if (!$RuntimeConfig) { $RuntimeConfig = Join-Path $backend '.studio-data/runtime.local.json' }
    $config = Read-Json $RuntimeConfig
    $allowed = @('STUDIO_PYTHON','STUDIO_KOKORO_SOURCE','STUDIO_KOKORO_MODEL','STUDIO_KOKORO_CONFIG','STUDIO_KOKORO_VOICE_DIR','STUDIO_TTS_DEVICE')
    $settings = @{}
    foreach ($property in $config.PSObject.Properties) {
        if ($property.Name -cnotin $allowed -or $property.Value -isnot [string]) { throw 'Invalid local runtime configuration field.' }
        $settings[$property.Name] = $property.Value
    }
    if (!$settings.STUDIO_PYTHON -or !(Test-Path -LiteralPath $settings.STUDIO_PYTHON -PathType Leaf)) { throw 'The configured Python executable is missing.' }
    $token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    $liveEnabled = if ($ContinueAdmission -or ($BatchPilot -and $Action -eq 'Check')) {'0'} else {'1'}
    # Saved recovery masks the credential across Windows child-process inheritance.
    if (!$BatchPilot) { $settings.HUGGINGFACE_API_KEY=' ' }
    $settings += @{
        PORT="$Port"; STUDIO_DATA_ROOT=$root; STUDIO_OPERATOR_ONLY='0'; STUDIO_AUTOMATION_ENABLED='1'
        STUDIO_AUTOMATION_TOKEN=$token; STUDIO_AUTOMATION_DISCORD_ENABLED='0'
        STUDIO_AUTOMATION_BATCH_PILOT=$(if($BatchPilot){'1'}else{'0'})
        STUDIO_AUTOMATION_PILOT_EXCLUDED_ROOTS=$(if($BatchPilot){$SourceId}else{''})
        HUGGINGFACE_LEDGER_PATH=(Join-Path $root 'ai-inference-ledger.jsonl')
        STUDIO_AUTOMATION_SAVED_BATCH_ID=$(if($ContinueAdmission){$BatchId}else{''})
        STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED=$liveEnabled
        STUDIO_DATA_QUALITY_LIVE_ENABLED=$liveEnabled
        STUDIO_DATA04_LIVE_ENABLED=$liveEnabled
    }
    $run = Join-Path $ops ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    $null = New-Item -ItemType Directory -Path $run
    $writeReport = $true
    $savedEnv = @{}
    try {
        foreach ($key in $settings.Keys) {
            $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            # Win32/Windows PowerShell may delete an empty environment value.
            [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
        }
        $worker = Start-Process -FilePath (Get-Command node.exe -ErrorAction Stop).Source -ArgumentList 'dist/main.js' -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $run 'backend.stdout.log') -RedirectStandardError (Join-Path $run 'backend.stderr.log') -PassThru
    } finally {
        foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
    }
    $state = @{ root=$root; port=$Port; pid=$worker.Id; started=$worker.StartTime.ToUniversalTime().Ticks.ToString(); logDirectory=$run
        credential=(ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString) }
    Write-Json $statePath $state
    $final.logDirectory=$run
    $current=$null
    $startupDeadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $startupDeadline) {
        if ($worker.HasExited) { throw 'Backend exited during launch. Inspect backend logs.' }
        try { $current=Call-Api status; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$current.owned -or (!$reattach -and ($current.active -or $current.policy.mode -notin @('DISABLED','BLOCKED')))) {
        throw 'Backend ownership or startup status could not be verified.'
    }
    if (-not @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $worker.Id }).Count) {
        throw 'The loopback listener does not belong to the launched backend.'
    }
    $final.initialStatus=$current
    if ($BatchPilot) {
        $providerStatus=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/studio/data/ai/status" -TimeoutSec 10
        if ($providerStatus.data) { $providerStatus=$providerStatus.data }
        $final.provider=$providerStatus.config
        if (!$final.provider) { throw 'Could not read the configured Hugging Face provider.' }
        if ($Action -eq 'Start' -and $final.provider.credential -ne 'present') { throw 'Hugging Face credentials are missing from the local backend configuration.' }
    }
    $initialReport = Call-Api report
    if (!$BatchPilot -and -not @($initialReport.batches | Where-Object { $_.id -eq $BatchId }).Count) { throw 'The saved batch has no visible reservation.' }
    $measure = & $config.STUDIO_PYTHON -B (Join-Path $PSScriptRoot 'kokoro_memory.py') --series
    if ($LASTEXITCODE -ne 0) { throw 'Native headroom probe failed.' }
    $samples=($measure -join "`n") | ConvertFrom-Json
    if ($samples.Count -ne 5 -or @($samples | Where-Object { $null -eq $_.availableMiB -or $null -eq $_.systemCommitAvailableMiB }).Count) {
        throw 'Native headroom probe did not return five valid samples.'
    }
    $final.preStartMemory=$samples
    $ram=($samples | Measure-Object -Property availableMiB -Minimum).Minimum
    $commit=($samples | Measure-Object -Property systemCommitAvailableMiB -Minimum).Minimum
    Write-Host "Backend ready. Probe minimums are $ram MiB RAM and $commit MiB commit reserve."
    if ($ContinueAdmission -and $ram -lt 1024) {
        $final.memoryAdvisories=@('LOW_MEMORY_WARNING')
        Write-Warning 'LOW_MEMORY_WARNING: cold physical headroom below 1024 MiB. Scheduler checks mandatory floors.'
    }
    Write-Host "Logs: $run"
    if ($Action -eq 'Check') { $final.result='CHECKED_NO_PRODUCTION'; return }
    if ($worker.HasExited) { throw 'Backend exited before starting production.' }
    if ($BatchPilot) {
        if (!$reattach) {
            $current=Call-Api status
            if ($current.policy.mode -eq 'BLOCKED') { $current=Request-Drain }
            $configured=Call-Api policy PATCH @{requestId=[guid]::NewGuid().ToString();revision=$current.policy.revision;policy=$pilotPolicy}
            $null=Call-Api start POST @{requestId=[guid]::NewGuid().ToString();revision=$configured.revision}
        }
        $final.startedProductionAt=(Get-Date).ToString('o')
        $deadline=(Get-Date).AddMinutes($MaxRunMinutes)
        do {
            if ($worker.HasExited) { throw 'Backend exited before the pilot settled. Durable checkpoints remain in the pilot root.' }
            $current=Call-Api status
            if (!$current.active) {
                if ($current.policy.mode -in @('DISABLED','BLOCKED')) {
                    $final.stopReason=if($current.blocker){$current.blocker}else{$current.policy.mode}
                    break
                }
                if ($current.blocker -in @('DAILY_LIMIT_REACHED','INVENTORY_FULL')) { $final.stopReason=$current.blocker; break }
            }
            if ((Get-Date) -ge $deadline) { $final.stopReason='PILOT_TIME_LIMIT'; break }
            Start-Sleep -Seconds 2
        } while ($true)
        return
    }
    $unresolved = @($initialReport.batches | Where-Object {
        $pending = if ($_.ttsTimeoutRecovery) { $_.ttsTimeoutRecovery } else { $_.ttsWait }
        $pending -and $pending.status -ne 'RESOLVED'
    })
    if (($ContinueAdmission -and ($unresolved.Count -ne 1 -or $unresolved[0].id -ne $BatchId)) -or
        ($RetryTimeout -and $unresolved.Count -ne 0) -or
        (!$ContinueAdmission -and !$RetryTimeout -and ($unresolved.Count -ne 1 -or $unresolved[0].id -ne $BatchId)) -or
        @($initialReport.batches | Where-Object { $_.status -in @('QUEUED','RUNNING') }).Count) {
        throw 'The requested batch must be the only pending production recovery.'
    }
    # An existing open review fills this temporary cap. The scheduler probes
    # the saved TTS wait before its ordinary discovery capacity check.
    if (!$ContinueAdmission -and -not @(Call-Api reviews | Where-Object { $_.status -eq 'OPEN' }).Count) {
        throw 'The saved pilot must have an open review to keep ordinary discovery closed.'
    }
    $current=Call-Api status
    if (!$ContinueAdmission -and $current.policy.maxPendingReviews -ne 1) {
        $originalReviewLimit=$current.policy.maxPendingReviews
        $null=Call-Api policy PATCH @{requestId=[guid]::NewGuid().ToString();revision=$current.policy.revision;policy=@{maxPendingReviews=1}}
    }
    $final.startedProductionAt=(Get-Date).ToString('o')
    $current=Call-Api status
    $final.startRequestId=[guid]::NewGuid().ToString()
    $start=@{requestId=$final.startRequestId;revision=$current.policy.revision}
    if($ContinueAdmission){
        $start.continueTtsAdmission=@{batchId=$BatchId;sessionId=$SessionId;itemId=$ItemId;failedAt=$failure.failedAt}
    }elseif($RetryTimeout){
        $start.retryTtsTimeout=@{batchId=$BatchId;sessionId=$SessionId;itemId=$ItemId;failedAt=$failure.failedAt}
    }else{$start.retryTtsAdmission=$true}
    $null=Call-Api start POST $start
    $draining=$false
    $deadline=(Get-Date).AddHours(8)
    for ($poll=0; ; $poll++) {
        if ($worker.HasExited) { throw 'Backend exited before settling. Saved checkpoints remain on disk.' }
        $outcome=Read-Outcome
        $wait=if($ContinueAdmission){$outcome.batch.ttsAdmissionContinuation}elseif($RetryTimeout){$outcome.batch.ttsTimeoutRecovery}else{$outcome.batch.ttsWait}
        # Drain immediately after the exact saved retry is admitted. The active
        # retry continues while the scheduler stops accepting other work.
        if (!$draining -and ((!$ContinueAdmission -and $wait.status -in @('RETRYING','RESOLVED')) -or (Get-Date) -gt $deadline)) {
            $null=Request-Drain
            $draining=$true
        }
        if ($poll % 5 -eq 0 -or $wait.status -eq 'BLOCKED') {
            $current=Call-Api status
            if (!$current.active -and $current.policy.mode -in @('BLOCKED','DISABLED')) { break }
        }
        Start-Sleep -Milliseconds 400
    }
    $final.video=Get-ValidatedVideo (Read-Outcome)
    $outcome=Read-Outcome
    $wait=if($ContinueAdmission){$outcome.batch.ttsAdmissionContinuation}elseif($RetryTimeout){$outcome.batch.ttsTimeoutRecovery}else{$outcome.batch.ttsWait}
    $final.audioExecution=$outcome.row.audioExecution
    $final.measuredAudioSeconds=$outcome.row.measuredSeconds
    $final.timelineSeconds=$outcome.row.timelineSeconds
    $final.admission=$wait.admission
    $final.productionFailure=if($final.video){$null}elseif($outcome.row.voiceFailure -and (!$ContinueAdmission -or $outcome.row.voiceFailure.error -ne $wait.previousFailure)){$outcome.row.voiceFailure}elseif($wait.status -eq 'BLOCKED'){
        @{failureCategory=$(if($wait.blockReason){$wait.blockReason}else{'UNKNOWN'});evidence=$wait.admission}
    }elseif(!$ContinueAdmission){Read-VoiceFailure}else{$null}
    if(!$final.video){
        $final.productionWarnings=$outcome.row.warnings
        $final.productionFailureCode=$outcome.row.failureCode
        $final.resourceBlocker=$wait.blockReason
    }
    $final.result=if ($final.video) {'PASS'} elseif ($wait.status -eq 'BLOCKED') {'BLOCKED'} elseif ($outcome.row.status -in @('TTS_FAILED','RENDER_FAILED')) {'FAILED'} else {'STOPPED_WITHOUT_MP4'}
} catch {
    $final.error=$_.Exception.Message
    if ($_.ErrorDetails.Message) {
        try {
            $detail=$_.ErrorDetails.Message | ConvertFrom-Json
            $message=if($detail.error.message){$detail.error.message}else{$detail.message}
            if($message){$final.error=($message -join '; ')}
        } catch {}
    }
    throw
} finally {
    try {
        if ($worker -and !$worker.HasExited -and $current.owned) {
            $null=Request-Drain
            do {
                $current=Call-Api status
                if ($current.active -or $current.policy.mode -ne 'DISABLED') { Start-Sleep -Seconds 2 }
            } while (!$worker.HasExited -and ($current.active -or $current.policy.mode -ne 'DISABLED'))
            if (!$worker.HasExited) {
                if ($null -ne $originalReviewLimit -and $current.policy.maxPendingReviews -eq 1) {
                    $null=Call-Api policy PATCH @{requestId=[guid]::NewGuid().ToString();revision=$current.policy.revision;policy=@{maxPendingReviews=$originalReviewLimit}}
                    $current=Call-Api status
                }
                $final.finalStatus=$current
                $final.applicationReport=Call-Api report
                if ($BatchPilot -and $Action -eq 'Start') {
                    $final.inventory=@(Call-Api videos)
                    $final.reviews=@(Call-Api reviews)
                }
                if (Get-Owned $state) { Stop-Process -Id $worker.Id; $worker.WaitForExit() }
            }
        } elseif ($worker -and !$worker.HasExited -and (Get-Owned $state)) {
            # The startup never reached authorized readiness. No work was started.
            Stop-Process -Id $worker.Id
            $worker.WaitForExit()
        }
    } finally {
        try {
            if ($writeReport) {
                $final.finishedAt=(Get-Date).ToString('o')
                if ($BatchPilot -and $Action -eq 'Start') {
                    $batches=@($final.applicationReport.batches)
                    if (!$final.applicationReport) {
                        $batches=@(Get-ChildItem -LiteralPath (Join-Path $root 'product-jobs/autonomous') -Filter '*.json' -File -ErrorAction SilentlyContinue |
                            ForEach-Object { Read-Json $_.FullName })
                        $final.inventory=@(Get-ChildItem -LiteralPath (Join-Path $root 'automation/videos') -Filter '*.json' -File -ErrorAction SilentlyContinue |
                            ForEach-Object { Read-Json $_.FullName })
                        $final.reviews=@(Get-ChildItem -LiteralPath (Join-Path $root 'automation/reviews') -Filter '*.json' -File -ErrorAction SilentlyContinue |
                            ForEach-Object { Read-Json $_.FullName })
                    }
                    if ($final.startedProductionAt) {
                        $budgetDay=(Read-Json $policyPath).pilotWindow.dayKey
                        $batches=@($batches | Where-Object { $_.dispatch.dayKey -eq $budgetDay })
                    } else { $batches=@() }
                    $final.batches=$batches
                    $final.videos=@(Get-PilotArtifacts $batches $final.inventory)
                    $final.inference=$final.applicationReport.inference
                    $final.freshDiscoveries=@($batches | Where-Object { $_.discoveryRunId -and $_.collected.execution -eq 'LIVE' } |
                        ForEach-Object { $_.collected.discoveredSourceIds } | Where-Object { $_ -and $_ -cne $SourceId } | Sort-Object -CaseSensitive -Unique).Count
                    $final.collectedRoots=[int](($batches | ForEach-Object { [int]$_.collected.collectedRoots } | Measure-Object -Sum).Sum)
                    $final.collectedReplies=[int](($batches | ForEach-Object { [int]$_.collected.collectedReplies } | Measure-Object -Sum).Sum)
                    $final.rejectedCandidates=@($batches | ForEach-Object { $_.results } |
                        Where-Object { $_ -and $_.status -notin @('COMPLETED','WAITING_HUMAN') })
                    $batchIds=@($batches | ForEach-Object { $_.id })
                    $final.waitingForReview=@($final.reviews | Where-Object { $_.batchId -in $batchIds -and $_.status -eq 'OPEN' -and $_.type -ne 'VIDEO_REVIEW' })
                    if ($final.videos.Count -ge 3) { $final.result='PASS' }
                    elseif ($final.videos.Count) { $final.result='PARTIAL' }
                    elseif (!$final.error) { $final.result='NO_VALIDATED_VIDEO' }
                } elseif (!$BatchPilot) { $final.savedOutcome=Read-Outcome }
                Write-Json (Join-Path $run 'report.json') $final
                if ($Action -ne 'Check') { Write-Json $reportPath $final }
                Write-Host "Result: $($final.result)"
                if ($final.productionFailure) { Write-Host "Last voice failure: $($final.productionFailure.failureCategory) - $($final.productionFailure.error)" }
                if ($final.resourceBlocker) { Write-Host "Recovery blocker: $($final.resourceBlocker)" }
                Write-Host "Report: $(Join-Path $run 'report.json')"
                if ($final.video) { Write-Host "MP4: $($final.video.path)" }
                foreach($video in @($final.videos | Where-Object { $_ })) { Write-Host "MP4: $($video.path)" }
            }
        } finally { $lock.Dispose(); $machineLock.Dispose() }
    }
}
