# 🚀 Video Downloader Pro

> 基于 Rust + Tauri + React 的现代化企业级视频批量下载器

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)](https://rust-lang.org)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org)
[![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

*专业、高效、现代的视频下载解决方案*

</div>

## ✨ 核心特性

### 🎯 强大的下载能力
- **多协议支持**: HTTP/HTTPS 直链、M3U8 流媒体、YouTube 视频
- **高性能下载**: 多线程并发，智能分片，断点续传
- **批量处理**: 支持 CSV/Excel/ODS 导入，一键批量下载
- **智能重试**: 网络中断自动恢复，错误处理机制

### 🎨 现代化界面
- **响应式设计**: 适配各种屏幕尺寸
- **暗黑模式**: 护眼的深色主题
- **实时进度**: 详细的下载统计和进度追踪
- **直观操作**: 拖拽导入，一键操作

### ⚡ 高性能架构
- **内存安全**: Rust 零成本抽象，编译时安全保证
- **快速启动**: < 1 秒启动时间
- **低内存占用**: 运行时占用 < 50MB
- **跨平台**: Windows、macOS、Linux 原生支持

## 📦 快速开始

### 系统要求
- **Windows 10/11**, macOS 10.15+, 或 Ubuntu 18.04+
- **Node.js 18+** 和 **pnpm 8+**
- **Rust 1.70+** 和 **Cargo**
- **WebView2** (Windows) 或系统 WebKit（Windows 10/11 安装包已内置并在启动时自动检测，详见 `docs/windows-compatibility.md`）

### 安装依赖
```bash
# 克隆项目
git clone https://github.com/your-org/video-downloader-pro.git
cd video-downloader-pro

# 安装 Node.js 依赖
pnpm install

# 安装 Rust 依赖 (首次运行时自动安装)
```

### 开发模式
```bash
# 启动开发服务器 (热重载)
pnpm dev

# 类型检查
pnpm type-check

# 代码格式化
pnpm format

# 运行测试
pnpm test
```

### 生产构建
```bash
# 构建应用程序
pnpm build

# 生成跨平台安装包
pnpm tauri build
```

## 🏗️ 项目架构

### 技术栈
- **前端**: React 18 + TypeScript + Tailwind CSS
- **后端**: Rust + Tauri + Tokio (异步运行时)
- **状态管理**: Zustand + React Query
- **UI 组件**: Headless UI + Heroicons
- **构建工具**: Vite + ESBuild

### 目录结构
```
video-downloader-pro/
├── src/                    # React 前端代码
│   ├── components/         # UI 组件
│   ├── stores/            # 状态管理
│   ├── hooks/             # 自定义 Hook
│   ├── types/             # TypeScript 类型定义
│   └── utils/             # 前端工具函数
├── src-tauri/             # Rust 后端代码
│   ├── src/
│   │   ├── commands/      # Tauri 命令处理
│   │   ├── core/          # 核心业务逻辑
│   │   ├── downloaders/   # 下载器实现
│   │   └── parsers/       # 文件解析器
│   └── Cargo.toml         # Rust 依赖配置
├── docs/                  # 项目文档
└── scripts/               # 构建和部署脚本
```

## 🎮 使用指南

### 1. 导入下载任务
支持多种导入方式:
- **拖拽文件**: 直接拖拽 CSV/Excel/ODS 文件到界面
- **文件选择**: 点击导入按钮选择文件
- **手动输入**: 直接添加视频链接

### 2. 配置下载设置
- **并发数量**: 调整同时下载的任务数
- **输出目录**: 选择视频保存位置
- **文件命名**: 自定义文件命名规则
- **网络设置**: 代理、超时等高级选项

### 3. 开始下载
- **一键开始**: 批量启动所有下载任务
- **选择性下载**: 勾选特定任务进行下载
- **暂停/恢复**: 随时控制下载进程
- **实时监控**: 查看下载进度和统计信息

## 🔧 配置说明

### CSV 文件格式
支持的字段名称 (自动识别):
```csv
专栏ID,专栏名称,视频链接,课程ID,课程名称
column_id,column_name,video_url,course_id,course_name
zl_id,zl_name,record_url,kc_id,kc_name
```

### YouTube 下载
- 自动检测 YouTube 链接
- 支持播放列表批量下载
- 多清晰度选择 (720p, 1080p, 4K)
- 字幕下载支持
- 参阅 `docs/youtube_downloader_usage.md` 了解依赖、配置与常见问题

### M3U8 流媒体
- 自动解析 HLS 播放列表
- 分片下载和合并
- 需要 FFmpeg 支持

## 🧪 测试

```bash
# 运行单元测试
pnpm test

# 运行测试并生成覆盖率报告
pnpm test:coverage

# 运行测试 UI
pnpm test:ui

# Rust 后端测试
cd src-tauri && cargo test
```

## 📦 构建部署

### Windows
```bash
pnpm tauri build --target x86_64-pc-windows-msvc
```

### macOS
```bash
pnpm tauri build --target x86_64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin  # Apple Silicon
```

### Linux
```bash
pnpm tauri build --target x86_64-unknown-linux-gnu
```

### Docker 部署
```bash
docker build -t video-downloader-pro .
docker run -p 8080:8080 video-downloader-pro
```

## 🤝 贡献指南

我们欢迎各种形式的贡献！

### 开发流程
1. **Fork** 本仓库
2. **创建特性分支**: `git checkout -b feature/amazing-feature`
3. **提交更改**: `git commit -m 'Add amazing feature'`
4. **推送分支**: `git push origin feature/amazing-feature`
5. **提交 Pull Request**

### 代码规范
- 遵循 ESLint 和 Prettier 配置
- 使用 Conventional Commits 格式
- 添加必要的测试覆盖
- 更新相关文档

## 🐛 问题反馈

遇到问题？请提供详细信息：
- 操作系统和版本
- 应用程序版本
- 复现步骤
- 错误日志

[提交 Issue](https://github.com/your-org/video-downloader-pro/issues)

## 📜 许可证

本项目基于 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

感谢以下开源项目的支持：
- [Tauri](https://tauri.app) - 跨平台桌面应用框架
- [React](https://reactjs.org) - 用户界面库
- [Rust](https://rust-lang.org) - 系统编程语言
- [Tailwind CSS](https://tailwindcss.com) - 实用优先的 CSS 框架

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给我们一个 Star！**

Made with ❤️ by [Video Downloader Team](https://github.com/your-org)

</div>
