@echo off
REM 快速启动脚本 - 一键启动开发环境

cd /d "%~dp0.."

echo.
echo 🚀 Video Downloader Pro - 快速启动
echo =====================================

REM 设置环境变量
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

REM 静默清理端口
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":1420 " 2^>nul') do (
    taskkill /pid %%p /f >nul 2>&1
)

REM 直接启动
pnpm dev

if errorlevel 1 (
    echo.
    echo ❌ 启动失败，正在尝试修复...
    echo.
    
    REM 尝试修复常见问题
    pnpm install >nul 2>&1
    
    REM 再次尝试启动
    pnpm dev
    
    if errorlevel 1 (
        echo ❌ 仍然失败，请运行完整诊断: scripts\dev.bat
        pause
    )
)