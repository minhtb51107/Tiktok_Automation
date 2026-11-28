# Run in a regular Windows PowerShell window, independently of any IDE.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Start','Status','Stop','Check')][string]$Action,
    [string]$DataRoot = (Join-Path $env:TEMP 'production-auto-v121-saved-FAEjyj'),
    [string]$BatchId = '97ce64ca-8ee6-4cde-92e1-741130c97587',
    [string]$SessionId = '578a7376-0afc-41be-b032-3b593643d77b',
    [string]$SourceId = 'DYFgbQ2k-FR',
    [ValidateRange(1024,65535)][int]$Port = 57374,
    [string]$RuntimeConfig
)
$ErrorActionPreference = 'Stop'
$backend = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = (Resolve-Path -LiteralPath $DataRoot).Path
if ([guid]::Parse($BatchId).ToString() -cne $BatchId -or
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
    if ($null -ne $Body) { $params.ContentType='application/json'; $params.Body=$Body | ConvertTo-Json -Compress }
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
function Get-ValidatedVideo($Outcome) {
    $row = $Outcome.row
    if ($row.status -ne 'COMPLETED' -or $row.artifact.validation -ne 'MACHINE_VALIDATED') { return $null }
    $job = [guid]::Parse([string]$row.renderJobId).ToString()
    $folder = Join-Path $renderRoot $job
    $video = Join-Path $folder 'video.mp4'
    $manifest = Read-Json (Join-Path $folder 'manifest.json')
    $inventory = @(Call-Api videos | Where-Object { $_.sessionId -eq $SessionId -and $_.rootSourceId -ceq $SourceId })
    $version = @($inventory | ForEach-Object { $_.versions } | Where-Object { $_.renderJobId -eq $job })
    $sha = (Get-FileHash -LiteralPath $video -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifest.status -ne 'COMPLETED' -or $manifest.preset -ne '1080P60' -or
        $manifest.metrics.executionStrategy -ne 'SPARSE_STATIC' -or $row.artifact.preset -ne '1080P60' -or
        $version.Count -ne 1 -or $sha -cne $version[0].sha256 -or $sha -cne $row.artifact.sha256) {
        throw 'The saved MP4 failed standalone acceptance checks.'
    }
    @{ path=$video; renderJobId=$job; sha256=$sha; artifact=$row.artifact; manifest=(Join-Path $folder 'manifest.json') }
}

if ($Action -in @('Status','Stop')) {
    $state = if (Test-Path -LiteralPath $statePath) { Read-Json $statePath }
    $outcome = Read-Outcome
    $live = $null
    if (Get-Owned $state) {
        $token = [Net.NetworkCredential]::new('', (ConvertTo-SecureString $state.credential)).Password
        if ($Action -eq 'Stop') { $null = Request-Drain }
        $live = Call-Api status
    }
    [pscustomobject]@{
        runtimeOnline=($null -ne $live); api=$live; savedPolicy=(Read-Json $policyPath).mode
        batchStatus=$outcome.batch.status; stage=$outcome.batch.stage; candidateStatus=$outcome.row.status
        ttsWait=$outcome.batch.ttsWait; renderJobId=$outcome.row.renderJobId; mp4Root=$renderRoot
        logDirectory=$state.logDirectory; report=$reportPath
    } | ConvertTo-Json -Depth 20
    return
}

$null = New-Item -ItemType Directory -Path $ops -Force
$lock = [IO.File]::Open((Join-Path $ops 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
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
    $outcome = Read-Outcome
    $policy = Read-Json $policyPath
    if ($policy.mode -notin @('DISABLED','BLOCKED')) { throw 'The saved policy must be DISABLED or BLOCKED before launch.' }
    if ($policy.dailyVideoLimit -ne 1 -or $policy.renderPreset -ne '1080P60') { throw 'Expected the existing one-video 1080P60 policy.' }
    if ($Action -eq 'Start' -and ($outcome.batch.ttsWait.status -ne 'BLOCKED' -or
        $outcome.batch.ttsWait.blockReason -ne 'ADMISSION_DENIED' -or $outcome.batch.ttsWait.retries -ne 0 -or
        $outcome.row.renderJobId)) { throw 'The exact saved admission checkpoint is not eligible for this launcher.' }
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
    $settings += @{
        PORT="$Port"; STUDIO_DATA_ROOT=$root; STUDIO_OPERATOR_ONLY='0'; STUDIO_AUTOMATION_ENABLED='1'
        STUDIO_AUTOMATION_TOKEN=$token; STUDIO_AUTOMATION_DISCORD_ENABLED='0'; HUGGINGFACE_API_KEY=''
        HUGGINGFACE_LEDGER_PATH=(Join-Path $root 'ai-inference-ledger.jsonl')
        STUDIO_PRODUCT_AUTOMATION_LIVE_ENABLED='1'; STUDIO_DATA_QUALITY_LIVE_ENABLED='1'; STUDIO_DATA04_LIVE_ENABLED='1'
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
        # A spaces-only value survives Windows PowerShell inheritance and the provider trims it to absent.
        [Environment]::SetEnvironmentVariable('HUGGINGFACE_API_KEY', ' ', 'Process')
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
    if (!$current.owned -or $current.active -or $current.policy.mode -notin @('DISABLED','BLOCKED')) { throw 'Backend ownership or startup status could not be verified.' }
    if (-not @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $worker.Id }).Count) {
        throw 'The loopback listener does not belong to the launched backend.'
    }
    $final.initialStatus=$current
    $initialReport = Call-Api report
    if (-not @($initialReport.batches | Where-Object { $_.id -eq $BatchId }).Count) { throw 'The saved batch has no visible reservation.' }
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
    Write-Host "Logs: $run"
    if ($Action -eq 'Check') { $final.result='CHECKED_NO_PRODUCTION'; return }
    if ($worker.HasExited) { throw 'Backend exited before starting production.' }
    $unresolved = @($initialReport.batches | Where-Object { $_.ttsWait -and $_.ttsWait.status -ne 'RESOLVED' })
    if ($unresolved.Count -ne 1 -or $unresolved[0].id -ne $BatchId -or
        @($initialReport.batches | Where-Object { $_.status -in @('QUEUED','RUNNING') }).Count) {
        throw 'The requested batch must be the only pending production recovery.'
    }
    # An existing open review fills this temporary cap. The scheduler probes
    # the saved TTS wait before its ordinary discovery capacity check.
    if (-not @(Call-Api reviews | Where-Object { $_.status -eq 'OPEN' }).Count) {
        throw 'The saved pilot must have an open review to keep ordinary discovery closed.'
    }
    $current=Call-Api status
    if ($current.policy.maxPendingReviews -ne 1) {
        $originalReviewLimit=$current.policy.maxPendingReviews
        $null=Call-Api policy PATCH @{requestId=[guid]::NewGuid().ToString();revision=$current.policy.revision;policy=@{maxPendingReviews=1}}
    }
    $final.startedProductionAt=(Get-Date).ToString('o')
    $current=Call-Api status
    $final.startRequestId=[guid]::NewGuid().ToString()
    $null=Call-Api start POST @{requestId=$final.startRequestId;revision=$current.policy.revision;retryTtsAdmission=$true}
    $draining=$false
    $deadline=(Get-Date).AddHours(8)
    for ($poll=0; ; $poll++) {
        if ($worker.HasExited) { throw 'Backend exited before settling. Saved checkpoints remain on disk.' }
        $outcome=Read-Outcome
        $wait=$outcome.batch.ttsWait
        # Drain immediately after the exact saved retry is admitted. The active
        # retry continues while the scheduler stops accepting other work.
        if (!$draining -and ($wait.status -in @('RETRYING','RESOLVED') -or (Get-Date) -gt $deadline)) {
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
    $final.result=if ($final.video) {'PASS'} elseif ((Read-Outcome).batch.ttsWait.status -eq 'BLOCKED') {'BLOCKED'} else {'STOPPED_WITHOUT_MP4'}
} catch {
    $final.error=$_.Exception.Message
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
                $final.savedOutcome=Read-Outcome
                Write-Json (Join-Path $run 'report.json') $final
                if ($Action -ne 'Check') { Write-Json $reportPath $final }
                Write-Host "Result: $($final.result)"
                Write-Host "Report: $(Join-Path $run 'report.json')"
                if ($final.video) { Write-Host "MP4: $($final.video.path)" }
            }
        } finally { $lock.Dispose() }
    }
}
