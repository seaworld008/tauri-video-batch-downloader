@echo off
echo.
echo 🔧 Rust 环境修复助手
echo ========================

REM 检查是否以管理员权限运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 请以管理员权限运行此脚本
    echo    右键点击此文件，选择"以管理员身份运行"
    pause
    exit /b 1
)

echo ✅ 正在以管理员权限运行

REM 检查 Chocolatey
where choco >nul 2>&1
if errorlevel 1 (
    echo 📦 正在安装 Chocolatey...
    powershell -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"
    
    REM 刷新环境变量
    call refreshenv
    
    if errorlevel 1 (
        echo ❌ Chocolatey 安装失败
        goto manual_install
    )
    echo ✅ Chocolatey 安装成功
) else (
    echo ✅ Chocolatey 已安装
)

echo.
echo 🔨 正在安装 Visual Studio Build Tools...
echo    这可能需要几分钟时间，请耐心等待...

choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --yes --no-progress

if errorlevel 1 (
    echo ❌ Visual Studio Build Tools 安装失败
    goto manual_install
)

echo ✅ Visual Studio Build Tools 安装完成

echo.
echo 🔄 验证 Rust 环境...

REM 重新设置环境变量
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

rustc --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Rust 不可用，请检查安装
    goto rust_install
)

echo ✅ Rust 环境验证成功

echo.
echo 🧪 测试编译环境...

REM 创建临时测试项目
mkdir rust_compile_test >nul 2>&1
cd rust_compile_test

echo fn main() { println!("Hello from Rust!"); } > main.rs

rustc main.rs
if errorlevel 1 (
    echo ❌ 编译测试失败，可能需要手动配置
    cd ..
    rmdir /s /q rust_compile_test >nul 2>&1
    goto manual_install
)

main.exe >nul 2>&1
if errorlevel 1 (
    echo ❌ 运行测试失败
    cd ..
    rmdir /s /q rust_compile_test >nul 2>&1
    goto manual_install
)

echo ✅ 编译测试通过

REM 清理测试文件
cd ..
rmdir /s /q rust_compile_test >nul 2>&1

echo.
echo 🎉 环境修复完成！
echo.
echo 下一步:
echo   1. 重启命令行或 IDE
echo   2. 运行: pnpm start
echo   3. 开始开发！
echo.
goto end

:rust_install
echo.
echo ❌ Rust 未正确安装
echo.
echo 请手动安装 Rust:
echo   1. 访问: https://rustup.rs/
echo   2. 下载并运行 rustup-init.exe
echo   3. 选择默认安装选项
echo   4. 重新运行此脚本
echo.
goto end

:manual_install
echo.
echo ❌ 自动安装失败，请手动安装
echo.
echo 手动安装步骤:
echo   1. 访问: https://visualstudio.microsoft.com/visual-cpp-build-tools/
echo   2. 下载 "Visual Studio 2022 生成工具"
echo   3. 安装时确保选择 "C++ 生成工具" 工作负载
echo   4. 重启计算机
echo   5. 重新运行: pnpm start
echo.
echo 或者查看详细指南: RUST_SETUP_GUIDE.md
echo.

:end
pause