param(
    [string]$Root = "C:\pinchbench-our-framework",
    [string]$SourceDir = "C:\pinchbench-our-framework\framework\localclaw-localcoding-dev",
    [int]$Port = 10086
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

function Add-PathFront([string]$Dir) {
    if ([string]::IsNullOrWhiteSpace($Dir) -or -not (Test-Path -LiteralPath $Dir)) { return }
    $parts = @($env:PATH -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $Dir.TrimEnd('\') })) {
        $env:PATH = $Dir + ';' + $env:PATH
    }
}

function Resolve-SystemGitBash {
    $candidates = New-Object System.Collections.Generic.List[string]
    try {
        $git = Get-Command git.exe -ErrorAction SilentlyContinue
        if ($null -ne $git) {
            $gitDir = Split-Path -Parent $git.Source
            $gitRoot = Split-Path -Parent $gitDir
            $candidates.Add((Join-Path $gitRoot 'bin\bash.exe'))
            $candidates.Add((Join-Path $gitRoot 'usr\bin\bash.exe'))
        }
    } catch {}
    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles 'Git\bin\bash.exe'))
        $candidates.Add((Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe'))
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'))
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Git\usr\bin\bash.exe'))
    }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    return $null
}

$ConfigDir = Join-Path $Root "config"
$WorkspaceDir = Join-Path $Root "workspaces"
$LogsDir = Join-Path $Root "logs"
$RuntimeDir = Join-Path $Root "runtime"
$SettingsPath = Join-Path $ConfigDir "settings.json"
$ClaudeJsonPath = Join-Path $ConfigDir ".claude.json"
$GlobalClaudePath = Join-Path $ConfigDir "CLAUDE.md"
$ProjectsDir = Join-Path $ConfigDir "projects"
$SkillsDir = Join-Path $ConfigDir "skills"
$StdoutPath = Join-Path $LogsDir "server.stdout.log"
$StderrPath = Join-Path $LogsDir "server.stderr.log"
$LauncherPidPath = Join-Path $RuntimeDir "server-launcher.pid"
$ServerPidPath = Join-Path $RuntimeDir "server.pid"
$BashCanaryPath = Join-Path $RuntimeDir "bash-environment-canary.txt"

foreach ($Dir in @($Root,$ConfigDir,$WorkspaceDir,$LogsDir,$RuntimeDir)) { New-Item -ItemType Directory -Force -Path $Dir | Out-Null }

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) { throw "OPENROUTER_API_KEY is missing in this PowerShell window." }
if ([string]::IsNullOrWhiteSpace($env:HTTPS_PROXY) -and [string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) { throw "Proxy env is missing. Set HTTP_PROXY/HTTPS_PROXY first." }
$env:NODE_USE_ENV_PROXY = "1"
$env:MSYS2_PATH_TYPE = "inherit"

# The framework bundle contains a deliberately minimal bash. It only exposes /usr/bin,
# which polluted CSV/PDF/log benchmark tasks because python/node/git/cmd.exe disappeared.
# Force the Claude CLI Bash tool to use the machine's full Git for Windows installation.
$SystemGitBash = Resolve-SystemGitBash
if ([string]::IsNullOrWhiteSpace($SystemGitBash)) { throw "Full Git for Windows bash.exe was not found. Install Git for Windows before benchmarking." }
$env:CLAUDE_CODE_GIT_BASH_PATH = $SystemGitBash

# Make the benchmark Python venv and normal Windows tooling visible to Git Bash.
Add-PathFront (Join-Path $Root ".venv\Scripts")
if ($env:SystemRoot) { Add-PathFront (Join-Path $env:SystemRoot "System32") }
try { $node = Get-Command node.exe -ErrorAction SilentlyContinue; if ($null -ne $node) { Add-PathFront (Split-Path -Parent $node.Source) } } catch {}
try { $git = Get-Command git.exe -ErrorAction SilentlyContinue; if ($null -ne $git) { Add-PathFront (Split-Path -Parent $git.Source) } } catch {}

# Zero-model-call canary: fail the server start if Bash cannot see the tools that the
# benchmark machine actually provides. This prevents silently contaminating Qwen/Kimi/Hybrid.
$CanaryCheck = @(& $SystemGitBash -lc 'command -v python >/dev/null && command -v node >/dev/null && command -v git >/dev/null && command -v cmd.exe >/dev/null' 2>&1)
$CanaryExitCode = $LASTEXITCODE
$CanaryOutput = @(& $SystemGitBash -lc 'command -v python; command -v node; command -v git; command -v cmd.exe' 2>&1)
Write-Utf8NoBom $BashCanaryPath (($CanaryOutput -join "`n") + "`n")
if ($CanaryExitCode -ne 0) { throw "Git Bash environment canary failed. See $BashCanaryPath. Output: $($CanaryOutput -join ' | ')" }

$PackageJson = Join-Path $SourceDir "package.json"
$ServerBundle = Join-Path $SourceDir "dist-server\server.cjs"
if (-not (Test-Path -LiteralPath $PackageJson)) { throw "Framework source not found: $SourceDir" }
if (-not (Test-Path -LiteralPath $ServerBundle)) { throw "Server build missing: $ServerBundle. Run pnpm build:server first." }

$Existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $Existing) { throw "Port $Port is already listening (PID $($Existing.OwningProcess)). Stop the old framework server first." }

foreach ($DbFile in @((Join-Path $ConfigDir "benchmark.db"),(Join-Path $ConfigDir "benchmark.db-wal"),(Join-Path $ConfigDir "benchmark.db-shm"))) { if (Test-Path -LiteralPath $DbFile) { Remove-Item -LiteralPath $DbFile -Force } }

$Claude = [ordered]@{
    mcpServers = @{}
    mcpServersManaged = @()
    hasCompletedOnboarding = $true
    bypassPermissionsModeAccepted = $true
    hasTrustDialogAccepted = $true
}
Write-Utf8NoBom $ClaudeJsonPath ($Claude | ConvertTo-Json -Depth 20)

if (Test-Path -LiteralPath $GlobalClaudePath) { Remove-Item -LiteralPath $GlobalClaudePath -Force }
if (Test-Path -LiteralPath $ProjectsDir) { Remove-Item -LiteralPath $ProjectsDir -Recurse -Force }
if (Test-Path -LiteralPath $SkillsDir) { Remove-Item -LiteralPath $SkillsDir -Recurse -Force }

$Settings = [ordered]@{
    env = @{}
    endpoints = @(
        [ordered]@{
            id = "openrouter-benchmark"
            label = "OpenRouter Benchmark"
            apiType = "openai-compatible"
            baseUrl = "https://openrouter.ai/api/v1"
            apiKey = $env:OPENROUTER_API_KEY
            enabled = $true
            channel = "gateway"
            models = @(
                [ordered]@{ id = "qwen/qwen3.6-27b"; label = "Qwen3.6 27B"; tags = @("local-role") },
                [ordered]@{ id = "moonshotai/kimi-k3"; label = "Kimi K3"; tags = @("cloud-role","critical") }
            )
        }
    )
    mcpServers = @{}
}
Write-Utf8NoBom $SettingsPath ($Settings | ConvertTo-Json -Depth 30)

$env:AGENT_CONFIG_DIR = $ConfigDir
$env:LOCALCLAW_CLAUDE_HOME = $ConfigDir
$env:AGENT_WORKSPACE_DIR = $WorkspaceDir
$env:DB_PATH = Join-Path $ConfigDir "benchmark.db"
$env:PORT = [string]$Port
$env:SERVER_HOST = "127.0.0.1"
$env:LENOVO_SDK_LOG_LEVEL = "debug"
$env:LOCALCLAW_LOG_FILE = "1"
$env:NODE_USE_ENV_PROXY = "1"

foreach ($Path in @($StdoutPath,$StderrPath)) { if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force } }

$Cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if ($null -eq $Cmd) { $Cmd = Get-Command pnpm -ErrorAction Stop }
$Proc = Start-Process -FilePath $Cmd.Source -ArgumentList @("start:node") -WorkingDirectory $SourceDir -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $LauncherPidPath -Value $Proc.Id -Encoding ASCII

$HealthUrl = "http://127.0.0.1:$Port/api/health"
$Deadline = (Get-Date).AddSeconds(120)
$Healthy = $false
while ((Get-Date) -lt $Deadline) {
    if ($Proc.HasExited) { break }
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2 -Proxy $null
        if ($r.StatusCode -eq 200) { $Healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $Healthy) {
    Write-Host "Server did not become healthy. stdout/stderr:" -ForegroundColor Red
    if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Tail 80 -Encoding UTF8 }
    if (Test-Path -LiteralPath $StderrPath) { Get-Content -LiteralPath $StderrPath -Tail 80 -Encoding UTF8 }
    throw "Framework server startup failed."
}

# Native startup may recreate framework extras. Remove them again for benchmark isolation.
Write-Utf8NoBom $ClaudeJsonPath ($Claude | ConvertTo-Json -Depth 20)
if (Test-Path -LiteralPath $GlobalClaudePath) { Remove-Item -LiteralPath $GlobalClaudePath -Force }
if (Test-Path -LiteralPath $ProjectsDir) { Remove-Item -LiteralPath $ProjectsDir -Recurse -Force }
if (Test-Path -LiteralPath $SkillsDir) { Remove-Item -LiteralPath $SkillsDir -Recurse -Force }

$Listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $Listener) { Set-Content -LiteralPath $ServerPidPath -Value $Listener.OwningProcess -Encoding ASCII }

$Endpoints = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/endpoints" -Method Get -Proxy $null
$Target = @($Endpoints | Where-Object { $_.id -eq "openrouter-benchmark" }) | Select-Object -First 1
if ($null -eq $Target) { throw "Server is healthy but benchmark endpoint is missing." }
$Ids = @($Target.models | ForEach-Object { $_.id })
if ($Ids -notcontains "qwen/qwen3.6-27b" -or $Ids -notcontains "moonshotai/kimi-k3") { throw "Benchmark endpoint is missing Qwen or Kimi model." }

# EndpointRegistry has loaded the key into memory. Scrub the on-disk copy without a UTF-8 BOM.
try {
    $DiskSettings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($ep in @($DiskSettings.endpoints)) { if ($null -ne $ep.PSObject.Properties['apiKey']) { $ep.apiKey = "" } }
    Write-Utf8NoBom $SettingsPath ($DiskSettings | ConvertTo-Json -Depth 30)
} catch { Write-Warning "Could not scrub on-disk endpoint key: $($_.Exception.Message)" }

Write-Host "OUR FRAMEWORK SERVER READY (v4.1 benchmark environment)" -ForegroundColor Green
Write-Host ("Health: " + $HealthUrl)
Write-Host ("Endpoint: openrouter-benchmark")
Write-Host ("Models: " + ($Ids -join ", "))
Write-Host ("Git Bash: " + $SystemGitBash)
Write-Host ("Bash canary: " + ($CanaryOutput -join " | "))
Write-Host ("Config: " + $ConfigDir)
Write-Host ("Server stdout: " + $StdoutPath)
Write-Host ("Server stderr: " + $StderrPath)
Write-Host "Extra MCP/Skills and cross-task memory have been sanitized for benchmark isolation." -ForegroundColor Yellow
Write-Host "OpenRouter key loaded into memory and scrubbed from isolated settings.json on disk." -ForegroundColor Yellow
