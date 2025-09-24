@echo off
setlocal enabledelayedexpansion

REM 智能开发启动脚本 (批处理版本)
REM 适合不支持PowerShell的环境

echo.
echo 🎯 Video Downloader Pro - 开发助手
echo ==================================================

REM 检查参数
set "CLEAN_MODE="
set "BUILD_MODE="
set "KILL_MODE="

if /i "%1"=="--clean" set "CLEAN_MODE=1"
if /i "%1"=="--build" set "BUILD_MODE=1"
if /i "%1"=="--kill" set "KILL_MODE=1"
if /i "%1"=="--help" goto :help

REM 设置环境变量
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

REM 强制终止模式
if defined KILL_MODE (
    echo ⚠️ 强制终止所有相关进程...
    taskkill /f /im node.exe >nul 2>&1
    taskkill /f /im cargo.exe >nul 2>&1
    taskkill /f /im rustc.exe >nul 2>&1
    echo ✅ 已清理完成
    goto :end
)

REM 构建模式
if defined BUILD_MODE (
    echo 🔨 构建生产版本...
    pnpm build
    if errorlevel 1 (
        echo ❌ 构建失败
        exit /b 1
    )
    echo ✅ 构建完成
    goto :end
)

REM 检查环境
echo 🔍 检查开发环境...

REM 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js 未安装或不可用
    echo    请访问 https://nodejs.org 下载安装
    goto :error
) else (
    for /f "tokens=*" %%i in ('node --version') do echo ✅ Node.js: %%i
)

REM 检查 pnpm
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ pnpm 未安装
    echo    正在安装 pnpm...
    npm install -g pnpm
    if errorlevel 1 (
        echo ❌ pnpm 安装失败
        goto :error
    )
) else (
    for /f "tokens=*" %%i in ('pnpm --version') do echo ✅ pnpm: v%%i
)

REM 检查 Rust
rustc --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Rust 未安装或不可用
    echo    请运行 rustup-init.exe 安装 Rust
    goto :error
) else (
    for /f "tokens=*" %%i in ('rustc --version') do echo ✅ Rust: %%i
)

REM 检查端口占用
netstat -an | findstr ":1420 " >nul 2>&1
if not errorlevel 1 (
    echo ⚠️ 端口 1420 被占用，正在清理...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":1420 "') do (
        taskkill /pid %%p /f >nul 2>&1
    )
    echo ✅ 端口已释放
    timeout /t 2 >nul
) else (
    echo ✅ 端口 1420 可用
)

REM 清理模式
if defined CLEAN_MODE (
    echo 🧹 清理开发环境...
    taskkill /f /im node.exe >nul 2>&1
    taskkill /f /im cargo.exe >nul 2>&1
    echo ✅ 环境已清理
    timeout /t 2 >nul
)

REM 检查依赖
if not exist "node_modules" (
    echo 📦 安装依赖...
    pnpm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        goto :error
    )
)

REM 启动开发服务器
echo.
echo 🚀 启动开发服务器...
echo    前端服务器: http://localhost:1420
echo    按 Ctrl+C 停止服务器
echo.

pnpm dev
if errorlevel 1 (
    echo ❌ 开发服务器启动失败
    echo.
    echo 🔧 故障排除建议:
    echo    1. 检查端口是否被占用: netstat -an ^| findstr ":1420"
    echo    2. 清理环境: %~nx0 --clean
    echo    3. 重新安装依赖: pnpm install
    goto :error
)

goto :end

:help
echo.
echo 用法: %~nx0 [选项]
echo.
echo 选项:
echo   --clean    清理环境后启动
echo   --build    构建生产版本
echo   --kill     强制终止所有进程
echo   --help     显示此帮助信息
echo.
echo 示例:
echo   %~nx0           # 正常启动
echo   %~nx0 --clean   # 清理后启动
echo   %~nx0 --build   # 构建生产版本
echo.
goto :end

:error
echo.
echo ❌ 启动失败，请检查上述错误信息
echo    如需帮助，请运行: %~nx0 --help
exit /b 1

:end
echo.
pause