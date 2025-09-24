# 🔧 Rust 编译环境修复指南

## 🚨 问题诊断

如果你看到类似这样的错误：
```
error: linking with `link.exe` failed: exit code: 1
note: in the Visual Studio installer, ensure the "C++ build tools" workload is selected
```

这表示缺少 **Visual Studio Build Tools** 的 C++ 构建支持。

---

## 🛠️ 解决方案

### 方案一：安装 Visual Studio Build Tools（推荐）

1. **下载 Visual Studio Installer**
   - 访问：https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - 下载 "Visual Studio 2022 生成工具"

2. **安装必需组件**
   ```
   ✅ C++ 生成工具
   ✅ Windows 10/11 SDK (最新版本)
   ✅ MSVC v143 编译器工具集
   ✅ CMake tools for Visual Studio
   ```

3. **验证安装**
   ```bash
   # 重新打开命令行，然后测试
   rustc --version
   cargo --version
   ```

### 方案二：使用 Chocolatey 自动安装

```powershell
# 以管理员权限运行 PowerShell
Set-ExecutionPolicy Bypass -Scope Process -Force

# 安装 Chocolatey（如果未安装）
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 安装 Visual Studio Build Tools
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"

# 重启终端后测试
rustc --version
```

### 方案三：使用 MinGW（备选方案）

如果无法安装 Visual Studio Build Tools，可以使用 MinGW：

```bash
# 安装 MinGW
choco install mingw

# 配置 Rust 使用 GNU 工具链
rustup toolchain install stable-gnu
rustup default stable-gnu
```

---

## 🧪 测试编译环境

创建测试项目验证环境：

```bash
# 创建测试项目
cargo new rust_test
cd rust_test

# 编译测试
cargo build

# 如果成功，删除测试项目
cd ..
rm -rf rust_test
```

---

## 🔄 重新尝试启动项目

环境修复后，重新启动开发服务器：

```bash
cd video-downloader-tauri

# 清理之前的编译缓存
cd src-tauri
cargo clean
cd ..

# 重新启动开发环境
pnpm start
```

---

## 📋 完整环境检查清单

运行以下命令确保所有环境都正确：

```bash
# 1. 检查 Rust 版本
rustc --version

# 2. 检查 Cargo 版本  
cargo --version

# 3. 检查工具链
rustup show

# 4. 检查目标平台
rustup target list --installed

# 5. 测试简单编译
echo 'fn main() { println!("Hello, world!"); }' > test.rs
rustc test.rs && ./test.exe && rm test.rs test.exe
```

---

## 🎯 成功标准

当你看到类似输出时，表示环境配置成功：

```
✅ Rust: rustc 1.89.0 (29483883e 2025-08-04)
✅ Cargo: cargo 1.89.0 (c24e10642 2025-06-23)
✅ 工具链: stable-x86_64-pc-windows-msvc (default)
✅ 编译测试通过
```

---

## 🆘 常见问题

### Q: 安装 Build Tools 后仍然报错？
A: 重启计算机，确保环境变量生效

### Q: 不想安装 Visual Studio？
A: 使用 MinGW 工具链，但可能会有兼容性问题

### Q: 编译速度很慢？
A: 这是正常的，首次编译会下载和编译大量依赖

### Q: 磁盘空间不足？
A: Visual Studio Build Tools 约需 3-5GB 空间

---

**💡 提示**: 修复环境后，建议重启终端以确保环境变量生效。