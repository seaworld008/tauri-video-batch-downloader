# 智能开发启动脚本
# 优雅处理端口冲突和进程管理

param(
    [switch]$Clean,     # 清理后重启
    [switch]$Build,     # 构建模式
    [switch]$Kill,      # 强制终止
    [switch]$Check      # 仅检查状态
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# 配置
$VITE_PORT = 1420
$HMR_PORT = 1421
$PROJECT_NAME = "video-downloader-pro"

# 颜色输出函数
function Write-ColorText($Text, $Color = "White") {
    Write-Host $Text -ForegroundColor $Color
}

function Write-Success($Text) {
    Write-ColorText "✅ $Text" "Green"
}

function Write-Warning($Text) {
    Write-ColorText "⚠️ $Text" "Yellow"
}

function Write-Error($Text) {
    Write-ColorText "❌ $Text" "Red"
}

function Write-Info($Text) {
    Write-ColorText "ℹ️ $Text" "Cyan"
}

# 检查端口占用
function Test-PortInUse($Port) {
    try {
        $connection = Test-NetConnection -ComputerName "localhost" -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
        return $connection
    } catch {
        return $false
    }
}

# 查找占用端口的进程
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

# 优雅停止进程
function Stop-GracefulProcess($ProcessName) {
    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Info "找到 $($processes.Count) 个 $ProcessName 进程"
        foreach ($proc in $processes) {
            try {
                # 首先尝试优雅关闭
                $proc.CloseMainWindow() | Out-Null
                Start-Sleep -Seconds 2
                
                # 检查是否已关闭
                if (!$proc.HasExited) {
                    Write-Warning "进程 $($proc.Id) 未响应，强制终止..."
                    $proc.Kill()
                }
                Write-Success "进程 $($proc.Id) 已停止"
            } catch {
                Write-Warning "无法停止进程 $($proc.Id): $_"
            }
        }
        Start-Sleep -Seconds 1
        return $true
    }
    return $false
}

# 清理开发环境
function Clear-DevEnvironment {
    Write-Info "🧹 清理开发环境..."
    
    # 停止相关进程
    $processNames = @("node", "vite", "tauri", "cargo")
    foreach ($name in $processNames) {
        if (Stop-GracefulProcess $name) {
            Write-Success "已停止 $name 进程"
        }
    }
    
    # 清理端口
    $ports = @($VITE_PORT, $HMR_PORT)
    foreach ($port in $ports) {
        $process = Get-PortProcess $port
        if ($process) {
            Write-Warning "端口 $port 仍被进程 $($process.ProcessName) ($($process.Id)) 占用"
            try {
                Stop-Process -Id $process.Id -Force
                Write-Success "已释放端口 $port"
            } catch {
                Write-Error "无法释放端口 $port"
            }
        }
    }
    
    Start-Sleep -Seconds 2
}

# 检查系统环境
function Test-SystemEnvironment {
    Write-Info "🔍 检查系统环境..."
    
    $issues = @()
    
    # 检查 Node.js
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Success "Node.js: $nodeVersion"
        } else {
            $issues += "Node.js 未安装"
        }
    } catch {
        $issues += "Node.js 不可用"
    }
    
    # 检查 pnpm
    try {
        $pnpmVersion = pnpm --version 2>$null
        if ($pnpmVersion) {
            Write-Success "pnpm: v$pnpmVersion"
        } else {
            $issues += "pnpm 未安装"
        }
    } catch {
        $issues += "pnpm 不可用"
    }
    
    # 检查 Rust
    try {
        $rustVersion = rustc --version 2>$null
        if ($rustVersion) {
            Write-Success "Rust: $rustVersion"
        } else {
            $issues += "Rust 未安装"
        }
    } catch {
        $issues += "Rust 不可用"
    }
    
    # 检查端口状态
    if (Test-PortInUse $VITE_PORT) {
        $process = Get-PortProcess $VITE_PORT
        if ($process) {
            Write-Warning "端口 $VITE_PORT 被占用 ($($process.ProcessName))"
            $issues += "端口冲突"
        }
    } else {
        Write-Success "端口 $VITE_PORT 可用"
    }
    
    return $issues
}

# 启动开发服务器
function Start-DevServer {
    Write-Info "🚀 启动开发服务器..."
    
    # 检查依赖是否安装
    if (!(Test-Path "node_modules")) {
        Write-Info "📦 安装依赖..."
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Error "依赖安装失败"
            exit 1
        }
    }
    
    # 设置环境变量
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    
    Write-Info "启动 Tauri 开发模式..."
    Write-Info "前端服务器: http://localhost:$VITE_PORT"
    Write-Info "按 Ctrl+C 停止服务器"
    
    try {
        # 使用 Start-Process 在新窗口中运行，以便更好地处理信号
        pnpm dev
    } catch {
        Write-Error "开发服务器启动失败: $_"
        exit 1
    }
}

# 主逻辑
function Main {
    Write-ColorText "🎯 Video Downloader Pro - 开发助手" "Magenta"
    Write-ColorText "=" * 50 "Gray"
    
    # 处理参数
    if ($Kill) {
        Write-Warning "强制终止所有相关进程..."
        Clear-DevEnvironment
        Write-Success "已清理完成"
        return
    }
    
    if ($Check) {
        $issues = Test-SystemEnvironment
        if ($issues.Count -eq 0) {
            Write-Success "环境检查通过"
        } else {
            Write-Error "发现问题:"
            $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        }
        return
    }
    
    if ($Build) {
        Write-Info "🔨 构建生产版本..."
        pnpm build
        return
    }
    
    # 环境检查
    $issues = Test-SystemEnvironment
    if ($issues -contains "端口冲突") {
        Write-Warning "检测到端口冲突，正在清理..."
        Clear-DevEnvironment
    }
    
    if ($Clean) {
        Clear-DevEnvironment
    }
    
    if ($issues.Count -gt 0 -and !($issues -contains "端口冲突")) {
        Write-Error "环境检查失败，请解决以下问题后重试:"
        $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        return
    }
    
    # 启动开发服务器
    Start-DevServer
}

# 处理 Ctrl+C 信号
$null = Register-ObjectEvent -InputObject ([System.Console]) -EventName CancelKeyPress -Action {
    Write-Host "`n🛑 正在优雅关闭..." -ForegroundColor Yellow
    Clear-DevEnvironment
    exit 0
}

# 运行主逻辑
Main