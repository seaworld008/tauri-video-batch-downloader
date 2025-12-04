# Smart Development Startup Script
# Handles port conflicts and process management gracefully

param(
    [switch]$Clean,     # Clean and restart
    [switch]$Build,     # Build mode
    [switch]$Kill,      # Force kill
    [switch]$Check      # Check status only
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Configuration
$VITE_PORT = 1420
$HMR_PORT = 1421
$PROJECT_NAME = "video-downloader-pro"

# Color Output Functions
function Write-ColorText($Text, $Color = "White") {
    Write-Host $Text -ForegroundColor $Color
}

function Write-Success($Text) {
    Write-ColorText "OK: $Text" "Green"
}

function Write-Warning($Text) {
    Write-ColorText "WARN: $Text" "Yellow"
}

function Write-Error($Text) {
    Write-ColorText "ERROR: $Text" "Red"
}

function Write-Info($Text) {
    Write-ColorText "INFO: $Text" "Cyan"
}

# Check if port is in use
function Test-PortInUse($Port) {
    try {
        $connection = Test-NetConnection -ComputerName "localhost" -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
        return $connection
    } catch {
        return $false
    }
}

# Find process using port
function Get-PortProcess($Port) {
    try {
        $netstat = netstat -ano | Select-String ":$Port "
        if ($netstat) {
            $processId = ($netstat -split '\s+')[-1]
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            return $process
        }
    } catch {
        return $null
    }
    return $null
}

# Gracefully stop process
function Stop-GracefulProcess($ProcessName) {
    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Info "Found $($processes.Count) processes for $ProcessName"
        foreach ($proc in $processes) {
            try {
                # Try graceful close first
                $proc.CloseMainWindow() | Out-Null
                Start-Sleep -Seconds 2
                
                # Check if exited
                if (!$proc.HasExited) {
                    Write-Warning "Process $($proc.Id) not responding, killing..."
                    $proc.Kill()
                }
                Write-Success "Process $($proc.Id) stopped"
            } catch {
                Write-Warning "Could not stop process $($proc.Id): $_"
            }
        }
        Start-Sleep -Seconds 1
        return $true
    }
    return $false
}

# Clear dev environment
function Clear-DevEnvironment {
    Write-Info "Cleaning dev environment..."
    
    # Stop related processes
    $processNames = @("node", "vite", "tauri", "cargo")
    foreach ($name in $processNames) {
        if (Stop-GracefulProcess $name) {
            Write-Success "Stopped $name process"
        }
    }
    
    # Clear ports
    $ports = @($VITE_PORT, $HMR_PORT)
    foreach ($port in $ports) {
        $process = Get-PortProcess $port
        if ($process) {
            Write-Warning "Port $port still used by $($process.ProcessName) ($($process.Id))"
            try {
                Stop-Process -Id $process.Id -Force
                Write-Success "Released port $port"
            } catch {
                Write-Error "Could not release port $port"
            }
        }
    }
    
    Start-Sleep -Seconds 2
}

# Check system environment
function Test-SystemEnvironment {
    Write-Info "Checking system environment..."
    
    $issues = @()
    
    # Check Node.js
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Success "Node.js: $nodeVersion"
        } else {
            $issues += "Node.js not installed"
        }
    } catch {
        $issues += "Node.js unavailable"
    }
    
    # Check pnpm
    try {
        $pnpmVersion = pnpm --version 2>$null
        if ($pnpmVersion) {
            Write-Success "pnpm: v$pnpmVersion"
        } else {
            $issues += "pnpm not installed"
        }
    } catch {
        $issues += "pnpm unavailable"
    }
    
    # Check Rust
    try {
        $rustVersion = rustc --version 2>$null
        if ($rustVersion) {
            Write-Success "Rust: $rustVersion"
        } else {
            $issues += "Rust not installed"
        }
    } catch {
        $issues += "Rust unavailable"
    }
    
    # Check ports
    if (Test-PortInUse $VITE_PORT) {
        $process = Get-PortProcess $VITE_PORT
        if ($process) {
            Write-Warning "Port $VITE_PORT in use by ($($process.ProcessName))"
            $issues += "Port conflict"
        }
    } else {
        Write-Success "Port $VITE_PORT available"
    }
    
    return $issues
}

# Start dev server
function Start-DevServer {
    Write-Info "Starting dev server..."
    
    # Check dependencies
    if (!(Test-Path "node_modules")) {
        Write-Info "Installing dependencies..."
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Dependency install failed"
            exit 1
        }
    }
    
    # Set Env
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    
    Write-Info "Starting Tauri dev mode..."
    Write-Info "Frontend: http://localhost:$VITE_PORT"
    Write-Info "Press Ctrl+C to stop"
    
    try {
        # Use Start-Process for new window
        pnpm dev
    } catch {
        Write-Error "Dev server failed to start: $_"
        exit 1
    }
}

# Main Logic
function Main {
    Write-ColorText "Target: Video Downloader Pro - Dev Helper" "Magenta"
    Write-ColorText "=" * 50 "Gray"
    
    # Handle Params
    if ($Kill) {
        Write-Warning "Force killing processes..."
        Clear-DevEnvironment
        Write-Success "Cleanup done"
        return
    }
    
    if ($Check) {
        $issues = Test-SystemEnvironment
        if ($issues.Count -eq 0) {
            Write-Success "Environment check passed"
        } else {
            Write-Error "Issues found:"
            $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        }
        return
    }
    
    if ($Build) {
        Write-Info "Building production version..."
        pnpm build
        return
    }
    
    # Env Check
    $issues = Test-SystemEnvironment
    if ($issues -contains "Port conflict") {
        Write-Warning "Port conflict detected, cleaning..."
        Clear-DevEnvironment
    }
    
    if ($Clean) {
        Clear-DevEnvironment
    }
    
    if ($issues.Count -gt 0 -and !($issues -contains "Port conflict")) {
        Write-Error "Environment check failed, fix these:"
        $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        return
    }
    
    # Start
    Start-DevServer
}

# Handle Ctrl+C
$null = Register-ObjectEvent -InputObject ([System.Console]) -EventName CancelKeyPress -Action {
    Write-Host "`nSTOP: Gracefully closing..." -ForegroundColor Yellow
    Clear-DevEnvironment
    exit 0
}

# Run Main
Main