# 🔧 Video Downloader Pro - 开发环境设置指南

## 🚨 系统要求

### 必需软件
- **Windows 10/11** (当前系统)
- **Node.js 18+** ✅ (已检测到)
- **Rust 1.70+** ❌ (需要安装)
- **Visual Studio Build Tools** (C++ 构建支持)
- **Git** (版本控制)

---

## 📦 第一步：安装 Rust

### 方法1：使用 Rustup (推荐)
```powershell
# 下载并安装 Rustup
Invoke-WebRequest -Uri "https://forge.rust-lang.org/infra/channel-layout.html#the-rustup-toolchain-installer" -UseBasicParsing | Invoke-Expression

# 或者手动下载安装
# 访问: https://rustup.rs/
# 下载 rustup-init.exe
```

### 方法2：使用包管理器
```powershell
# 使用 Chocolatey (如果已安装)
choco install rust

# 使用 Scoop (如果已安装)  
scoop install rustup
```

### 验证安装
```bash
rustc --version
cargo --version
```

---

## 🛠️ 第二步：安装系统依赖

### Visual Studio Build Tools
```powershell
# 下载并安装 VS Build Tools
# https://visualstudio.microsoft.com/visual-cpp-build-tools/

# 或使用 Chocolatey
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"
```

### WebView2 (Tauri 需要)
```powershell
# 通常 Windows 11 已预装，Windows 10 需要手动安装
# https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

---

## 🚀 第三步：创建项目

### 安装 Tauri CLI
```bash
# 安装 Tauri CLI
cargo install tauri-cli

# 安装前端工具链
pnpm install -g @tauri-apps/cli
```

### 初始化项目
```bash
cd video-downloader-tauri

# 使用 Tauri CLI 创建项目
pnpm create tauri-app --template react-ts

# 或手动设置项目结构 (如下)
```

---

## 📁 项目结构创建

如果自动创建失败，请手动创建以下结构：

```
video-downloader-tauri/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles/
├── public/
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

---

## ⚡ 第四步：快速启动

```bash
# 安装依赖
pnpm install

# 启动开发模式
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

---

## 🐛 常见问题解决

### 问题1: Rust 编译错误
```bash
# 更新 Rust 工具链
rustup update

# 添加目标平台
rustup target add x86_64-pc-windows-msvc
```

### 问题2: WebView2 相关错误
```powershell
# 手动下载安装 WebView2 Runtime
# https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

### 问题3: 构建工具错误
```bash
# 确保安装了正确的 MSVC 工具链
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

---

## 🎯 开发工具推荐

### VS Code 插件
- **rust-analyzer**: Rust 语言支持
- **Tauri**: Tauri 项目支持  
- **ES7+ React/Redux/React-Native snippets**: React 代码片段
- **Tailwind CSS IntelliSense**: Tailwind 自动补全
- **TypeScript Importer**: TS 导入优化

### Chrome 插件
- **React Developer Tools**: React 调试
- **Redux DevTools**: 状态管理调试

---

## 📊 环境验证脚本

创建验证脚本来检查环境是否正确设置:

```powershell
# scripts/verify-env.ps1
Write-Host "🔍 检查开发环境..." -ForegroundColor Green

# 检查 Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js 未安装" -ForegroundColor Red
}

# 检查 Rust
try {
    $rustVersion = rustc --version
    Write-Host "✅ Rust: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Rust 未安装" -ForegroundColor Red
}

# 检查 Cargo
try {
    $cargoVersion = cargo --version
    Write-Host "✅ Cargo: $cargoVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Cargo 未安装" -ForegroundColor Red
}

# 检查 pnpm
try {
    $pnpmVersion = pnpm --version
    Write-Host "✅ pnpm: $pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ pnpm 未安装" -ForegroundColor Red
}

Write-Host "🎉 环境检查完成!" -ForegroundColor Cyan
```

---

## 🏃‍♂️ 下一步

环境设置完成后，按照以下顺序进行开发：

1. ✅ **验证环境**: 运行环境检查脚本
2. 🏗️ **项目初始化**: 创建基础项目结构  
3. 📦 **依赖安装**: 安装所有必需依赖
4. 🚀 **首次运行**: 启动开发模式验证设置
5. 📝 **开始开发**: 按照 DEVELOPMENT_ROADMAP.md 进行开发

---

**🔗 相关资源**:
- [Tauri 官方文档](https://tauri.app/)
- [Rust 官方文档](https://doc.rust-lang.org/)
- [React 官方文档](https://react.dev/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)