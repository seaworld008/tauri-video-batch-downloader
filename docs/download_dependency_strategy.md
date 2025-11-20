# 下载相关外部依赖策略

为保证后续阶段可顺利实现真实下载能力，需对核心外部依赖制定统一策略：

## 1. 依赖清单

| 组件 | 作用 | 目标版本 | 备注 |
| --- | --- | --- | --- |
| `yt-dlp` | YouTube/通用站点下载 | `2025.01.xx`（保持最新稳定版） | 以独立二进制形式分发；需支持 Windows/macOS/Linux x64 |
| `ffmpeg` | `yt-dlp` 合并音视频、转码 | `6.x LTS` | Windows 需要捆绑 `ffprobe`；mac/Linux 可依赖系统或内置 mini 版本 |
| OpenSSL / 系统证书 | HTTPS 请求必需 | 使用系统自带 | 仅需在 doc 中说明 Windows 需 VC++ 运行库 |

## 2. 分发策略

1. **开发环境**：
   - 在 `scripts/setup-dev.ps1` / `.sh` 中增加依赖检查；缺失时自动下载对应平台的 `yt-dlp`/`ffmpeg`。
   - 提供缓存目录（`tools/bin`），并加入 `.gitignore`。

2. **打包/发布**：
   - Tauri `beforeBuildCommand` 中调用脚本，将平台二进制复制到 `src-tauri/bin/<platform>`；构建时打入 App bundle。
   - 通过 `tauri.conf.json > bundle > resources` 暴露给 Rust 侧，运行时优先使用内置二进制。

3. **运行时兜底**：
   - `youtube_downloader` 初始化时检测二进制是否存在且版本满足要求；若缺失，提示用户下载或自动拉取（可复用开发脚本逻辑）。
   - 下载逻辑需支持自定义路径（从设置或环境变量读取）以适配企业环境。

## 3. 接口封装

1. 新增 `src-tauri/src/utils/dependency_manager.rs`：负责检测、下载、校验哈希、解压。
2. 在 `youtube_downloader.rs` 中仅依赖该管理器提供的 `get_binary_path("yt-dlp")`/`ensure_installed("ffmpeg")`。
3. CLI 输出需带进度/错误描述，便于 UI 提示。

## 4. 配置与文档

1. `config/AppConfig` 增加 `youtube.binary_dir`、`ffmpeg_path` 字段，默认指向内置资源；允许通过设置界面修改。
2. 更新 `README / SETUP_GUIDE`，列出平台差异：
   - Windows：提供打包的 `yt-dlp.exe` 与 `ffmpeg.exe`。
   - macOS：提供通用版二进制，需签名说明。
   - Linux：若系统已有可用版本，可配置使用系统路径。
3. 文档中附带校验方式（SHA256）与镜像地址，方便离线环境部署。

## 5. 后续任务关联

- 阶段 3 中实现 YouTube 下载时，需先完成依赖管理器。
- CI 流程需在安装阶段拉取 `yt-dlp`/`ffmpeg`，或使用 mock，避免测试失败。

以上策略确定后，后续开发即可按此约束编写代码与脚本，确保不同平台行为一致。
