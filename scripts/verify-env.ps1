# 环境验证脚本
Write-Host "🔍 检查开发环境..." -ForegroundColor Green

$allPassed = $true

# 检查 Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查 pnpm
try {
    $pnpmVersion = pnpm --version
    Write-Host "✅ pnpm: v$pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ pnpm 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Rust
try {
    $rustVersion = rustc --version
    Write-Host "✅ Rust: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Rust 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Cargo
try {
    $cargoVersion = cargo --version
    Write-Host "✅ Cargo: $cargoVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Cargo 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Git
try {
    $gitVersion = git --version
    Write-Host "✅ Git: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Git 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查项目依赖
if (Test-Path ".\node_modules") {
    Write-Host "✅ Node.js 依赖已安装" -ForegroundColor Green
} else {
    Write-Host "❌ Node.js 依赖未安装，请运行 pnpm install" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Rust 目标平台
try {
    $targets = rustup target list --installed
    if ($targets -match "x86_64-pc-windows-msvc") {
        Write-Host "✅ Windows MSVC 目标平台已安装" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Windows MSVC 目标平台未安装，正在安装..." -ForegroundColor Yellow
        rustup target add x86_64-pc-windows-msvc
        Write-Host "✅ Windows MSVC 目标平台安装完成" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 无法检查 Rust 目标平台" -ForegroundColor Red
    $allPassed = $false
}

# 检查必要的系统组件
Write-Host ""
Write-Host "📋 系统组件检查:" -ForegroundColor Cyan

# 检查 WebView2 (Windows 10/11 通常预装)
$webview2Path = "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application"
if (Test-Path $webview2Path) {
    Write-Host "✅ Microsoft EdgeWebView2 已安装" -ForegroundColor Green
} else {
    Write-Host "⚠️ Microsoft EdgeWebView2 可能未安装" -ForegroundColor Yellow
    Write-Host "   建议从以下链接下载: https://go.microsoft.com/fwlink/p/?LinkId=2124703" -ForegroundColor Yellow
}

# 检查 Visual C++ 构建工具
$vcToolsPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
if (Test-Path $vcToolsPath) {
    Write-Host "✅ Visual C++ 构建工具已安装" -ForegroundColor Green
} else {
    Write-Host "⚠️ Visual C++ 构建工具可能未安装" -ForegroundColor Yellow
    Write-Host "   Rust 编译可能需要此工具" -ForegroundColor Yellow
}

Write-Host ""
if ($allPassed) {
    Write-Host "🎉 环境检查完成！所有必需组件已安装" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步:" -ForegroundColor Cyan
    Write-Host "  pnpm dev    # 启动开发服务器" -ForegroundColor White
    Write-Host "  pnpm build  # 构建生产版本" -ForegroundColor White
} else {
    Write-Host "❌ 环境检查未完全通过，请安装缺失的组件" -ForegroundColor Red
    exit 1
}