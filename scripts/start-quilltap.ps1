<#
.SYNOPSIS
    Quilltap Docker startup script for Windows.

.DESCRIPTION
    Detects platform, sets sensible defaults, and starts the Quilltap container.

.PARAMETER DataDir
    Data directory on host. Default: $env:APPDATA\Quilltap

.PARAMETER Port
    Host port. Default: 3000

.PARAMETER Name
    Container name. Default: quilltap

.PARAMETER Tag
    Image tag. Default: latest

.PARAMETER RedirectPorts
    Comma-separated ports to forward to host (e.g., "11434,3030")

.PARAMETER ExtraEnv
    Extra environment variables as an array of "KEY=VALUE" strings

.PARAMETER RestartPolicy
    Docker restart policy. Default: unless-stopped

.PARAMETER NoAutoDetect
    Skip auto-detection of local services (Ollama, etc.)

.PARAMETER DryRun
    Print the docker command without running it

.NOTES
    The host's timezone is detected and passed to the container as
    QUILLTAP_TIMEZONE, so scheduled rooms, daily budget rollover, and
    "today"/"yesterday" recall follow your clock rather than UTC.
    Override with -ExtraEnv "QUILLTAP_TIMEZONE=Europe/Paris", or pin the
    container to UTC with -ExtraEnv "QUILLTAP_TIMEZONE=UTC".

.EXAMPLE
    .\scripts\start-quilltap.ps1

.EXAMPLE
    .\scripts\start-quilltap.ps1 -RedirectPorts "11434,3030"

.EXAMPLE
    .\scripts\start-quilltap.ps1 -DataDir "D:\quilltap-data" -Port 8080
#>

param(
    [string]$DataDir,
    [int]$Port = 3000,
    [string]$Name = "quilltap",
    [string]$Tag = "latest",
    [string]$RedirectPorts,
    [string[]]$ExtraEnv = @(),
    [string]$RestartPolicy = "unless-stopped",
    [switch]$NoAutoDetect,
    [switch]$DryRun
)

$Image = "foundry9/quilltap"

# Resolve this host's IANA timezone name (e.g. "America/Chicago"), or $null if
# it cannot be determined confidently.
#
# The Windows trap: [TimeZoneInfo]::Local.Id returns a *Windows* id there
# ("Central Standard Time"), which Node's ICU cannot resolve — it would fall
# back to UTC, the exact bug this is meant to avoid. .NET 6+ (PowerShell 7.2+)
# can convert; on macOS/Linux Local.Id is already IANA.
function Get-HostTimezone {
    # Every branch assigns rather than returns, so all of them — including the
    # env-var ones — funnel through the single validation at the bottom. An
    # early return here would let a stray TZ=CDT through unchecked.
    $tz = $null

    if ($env:QUILLTAP_TIMEZONE) {
        $tz = $env:QUILLTAP_TIMEZONE
    } elseif ($env:TZ) {
        $tz = $env:TZ
    } else {
        $localId = $null
        try { $localId = [System.TimeZoneInfo]::Local.Id } catch { }

        if ($localId -and ($localId -eq "UTC" -or $localId -match "/")) {
            # Already IANA — macOS/Linux, or a host that reports one.
            $tz = $localId
        } elseif ($localId) {
            # Windows id -> IANA, where the runtime supports it (.NET 6+).
            try {
                $iana = $null
                if ([System.TimeZoneInfo]::TryConvertWindowsIdToIanaId($localId, [ref]$iana) -and $iana) {
                    $tz = $iana
                }
            } catch {
                # Older runtime without the conversion API — fall through to node.
            }
        }

        if (-not $tz) {
            # Node's own ICU lookup: exactly the name the container will resolve.
            try {
                $nodeTz = (& node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone' 2>$null)
                if ($nodeTz) { $tz = ([string]$nodeTz).Trim() }
            } catch { }
        }
    }

    # Only emit a plausible IANA name. Anything else ("CDT", "Central Standard
    # Time" on a runtime too old to convert) would be silently ignored by the
    # container's ICU and fall back to UTC — better to pass nothing than a lie.
    if ($tz -and ($tz -eq "UTC" -or $tz -match "/")) { return $tz }
    return $null
}

# Detect platform and set default data directory
if (-not $DataDir) {
    if ($env:QUILLTAP_DATA_DIR) {
        $DataDir = $env:QUILLTAP_DATA_DIR
    } elseif ($IsLinux) {
        $DataDir = Join-Path $HOME ".quilltap"
    } elseif ($IsMacOS) {
        $DataDir = Join-Path $HOME "Library/Application Support/Quilltap"
    } else {
        # Windows
        $DataDir = Join-Path $env:APPDATA "Quilltap"
    }
}

# Override from environment variables
if ($env:QUILLTAP_PORT -and $Port -eq 3000) { $Port = [int]$env:QUILLTAP_PORT }
if ($env:QUILLTAP_CONTAINER_NAME -and $Name -eq "quilltap") { $Name = $env:QUILLTAP_CONTAINER_NAME }
if ($env:QUILLTAP_IMAGE_TAG -and $Tag -eq "latest") { $Tag = $env:QUILLTAP_IMAGE_TAG }
if ($env:HOST_REDIRECT_PORTS -and -not $RedirectPorts) { $RedirectPorts = $env:HOST_REDIRECT_PORTS }

# Auto-detect local services
if (-not $NoAutoDetect) {
    $DetectedPorts = @()

    # Check for Ollama on port 11434.
    #
    # BeginConnect plus a bounded wait, not Connect(): the synchronous call has
    # no timeout, so on a host that silently drops the SYN rather than refusing
    # it — corporate firewalls, some VPN configurations — it blocks for the OS
    # default, roughly 21 seconds on Windows, before concluding what is for our
    # purposes just "no Ollama here." A service on localhost answers in
    # milliseconds; anything slower is a no.
    #
    # The finally also fixes a leak: the old form only reached Close() on the
    # success path, so every miss abandoned an undisposed socket.
    $ProbeTimeoutMs = 500
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $tcp.BeginConnect("localhost", 11434, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne($ProbeTimeoutMs, $false)) {
            # Finished inside the window. EndConnect throws if it was refused.
            $tcp.EndConnect($iar)
            Write-Host "Detected Ollama on port 11434"
            $DetectedPorts += "11434"
        }
        # Timed out — treat as absent rather than waiting on the OS default.
    } catch {
        # Not running, or actively refused.
    } finally {
        $tcp.Close()
    }

    # Merge detected ports with any explicitly specified
    if ($DetectedPorts.Count -gt 0) {
        $DetectedCsv = $DetectedPorts -join ","
        if ($RedirectPorts) {
            $RedirectPorts = "$RedirectPorts,$DetectedCsv"
        } else {
            $RedirectPorts = $DetectedCsv
        }
        # Deduplicate
        $RedirectPorts = (($RedirectPorts -split ",") | Sort-Object -Unique) -join ","
    }
}

# Create data directory if it doesn't exist
if (-not $DryRun) {
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
}

# Build docker run arguments
$DockerArgs = @(
    "run", "-d",
    "--name", $Name,
    "--restart", $RestartPolicy,
    "-p", "${Port}:3000",
    "-v", "${DataDir}:/app/quilltap"
)

# Pass the host-side data directory so the app can display it in the UI
$DockerArgs += @("-e", "QUILLTAP_HOST_DATA_DIR=$DataDir")

# Add host port forwarding if requested
if ($RedirectPorts) {
    $DockerArgs += @("-e", "HOST_REDIRECT_PORTS=$RedirectPorts")
    # Linux needs explicit host.docker.internal mapping
    if ($IsLinux) {
        $DockerArgs += @("--add-host=host.docker.internal:host-gateway")
    }
}

# Pass the host timezone through, unless the caller already supplied one via
# -ExtraEnv. An explicit value always wins; detection only fills the gap.
$TzExplicit = $false
foreach ($env_var in $ExtraEnv) {
    if ($env_var -like "QUILLTAP_TIMEZONE=*" -or $env_var -like "TZ=*") { $TzExplicit = $true }
}

$Timezone = $null
if (-not $TzExplicit) {
    $Timezone = Get-HostTimezone
    if ($Timezone) {
        $DockerArgs += @("-e", "QUILLTAP_TIMEZONE=$Timezone")
    }
}

# Add extra environment variables
foreach ($env_var in $ExtraEnv) {
    $DockerArgs += @("-e", $env_var)
}

# Image
$DockerArgs += "${Image}:${Tag}"

# Display configuration
$Platform = if ($IsLinux) { "linux" } elseif ($IsMacOS) { "macos" } else { "windows" }
Write-Host "Platform:  $Platform"
Write-Host "Data dir:  $DataDir"
Write-Host "Port:      $Port"
Write-Host "Container: $Name"
Write-Host "Image:     ${Image}:${Tag}"
if ($TzExplicit) {
    Write-Host "Timezone:  (set explicitly via -ExtraEnv)"
} elseif ($Timezone) {
    Write-Host "Timezone:  $Timezone (detected)"
} else {
    Write-Host "Timezone:  UTC (could not detect host timezone)"
}
if ($RedirectPorts) {
    Write-Host "Forwarding: $RedirectPorts"
}
Write-Host ""

if ($DryRun) {
    Write-Host "Dry run - would execute:"
    Write-Host "  docker $($DockerArgs -join ' ')"
    return
}

# Check if container already exists
$existing = docker ps -a --format '{{.Names}}' 2>$null | Where-Object { $_ -eq $Name }
if ($existing) {
    $running = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -eq $Name }
    if ($running) {
        Write-Host "Container '$Name' is already running."
        Write-Host "Use 'docker stop $Name; docker rm $Name' to recreate."
    } else {
        Write-Host "Container '$Name' exists but is stopped. Starting it..."
        docker start $Name
    }
    return
}

Write-Host "Starting Quilltap..."
& docker @DockerArgs

Write-Host ""
Write-Host "Quilltap is running at http://localhost:${Port}"
