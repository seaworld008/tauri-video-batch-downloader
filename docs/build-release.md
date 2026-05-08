# 构建与发布（Build & Release）

更新日期：2026-05-07

## 生产包

```bash
pnpm build:prod
```

生产构建会先执行严格 sidecar 预检：

```bash
pnpm sidecars:check
```

当前 `pnpm build` 也走同一条严格链路。只要当前 target 的 `yt-dlp` 或 `ffmpeg`
仍是占位文件、缺少可执行权限或 capability 配置不完整，生产构建会直接失败。

如果当前机器需要准备真实 sidecar：

```bash
pnpm sidecars:prepare
pnpm sidecars:check
```

输出目录：

```text
src-tauri/target/release/bundle/
```

生产包默认不写本地前端/后端日志文件。

## 本地测试包

```bash
pnpm build:local
```

本地测试包用于真实 App 回归，启用日志落地：

```text
./log/backend.log
./log/frontend.log
```

相关配置：

- `src-tauri/tauri.conf.local.json`
- `.env.localtest`

本地测试包允许保留 sidecar 占位文件，便于先验证桌面壳、IPC 和普通下载链路：

```bash
pnpm sidecars:check:local
```

## 平台说明

| 平台    | 说明                                          |
| ------- | --------------------------------------------- |
| macOS   | Tauri 默认生成 `.app` / `.dmg`                |
| Windows | 需要 WebView2 runtime；安装包应包含检测与引导 |
| Linux   | 依赖 WebKitGTK/GTK，deb 依赖见 Tauri 配置     |

## sidecar 外部工具

当前 Tauri 配置声明了三个随包 sidecar：

```text
src-tauri/binaries/yt-dlp-$TARGET_TRIPLE
src-tauri/binaries/ffmpeg-$TARGET_TRIPLE
src-tauri/binaries/deno-$TARGET_TRIPLE
```

Windows 目标文件需要 `.exe`
后缀。真实发布前必须把当前占位文件替换为真实二进制，并确认：

- 文件名与 Tauri target triple 完全匹配。
- macOS/Linux 文件具有可执行权限。
- `yt-dlp --version`、`yt-dlp --help`、`ffmpeg -version`、`deno --version`
  在打包后可执行。
- `yt-dlp` release 下载源必须校验 checksum。
- `ffmpeg` 暂不做 App 内自动下载，发布包应使用项目选择的可信构建来源。

可用预检命令：

```bash
# 当前平台下载/复制真实 sidecar
pnpm sidecars:prepare

# 当前平台，严格发布模式
pnpm sidecars:check

# 当前平台，允许占位文件，仅用于本地 smoke
pnpm sidecars:check:local

# 四个正式发布 target 全量检查
pnpm sidecars:check:all

# 指定单个平台 target
node scripts/validate-sidecars.mjs --target x86_64-pc-windows-msvc
```

预检内容包括：

- `tauri.conf.json#bundle.externalBin` 是否声明 `binaries/yt-dlp` 和
  `binaries/ffmpeg`。
- `src-tauri/capabilities/migrated.json` 是否允许 shell sidecar `execute` /
  `spawn`。
- `src-tauri/binaries/<name>-$TARGET_TRIPLE(.exe)` 是否存在。
- macOS/Linux sidecar 是否具有可执行权限。
- 正式模式下是否仍是占位脚本或明显过小的不完整文件。

`sidecars:prepare` 默认行为：

- `yt-dlp` 从官方 GitHub latest release 下载对应平台 asset，并校验
  `SHA2-256SUMS`。
- `ffmpeg` 默认从 `ffmpeg-static`
  当前 runner 二进制复制；如果项目选择了其他可信来源，可设置 `VDP_FFMPEG_BINARY`
  指向本地二进制。
- `deno` 从 Deno 官方 GitHub latest release 下载对应平台 zip，并校验
  `.sha256sum`，用于 yt-dlp 的 YouTube EJS 解密/挑战脚本执行。
- 如需使用已审计的 `yt-dlp` 二进制，可设置 `VDP_YTDLP_BINARY`。
- 如需使用已审计的 `deno` 二进制，可设置 `VDP_DENO_BINARY`。
- `src-tauri/binaries/` 下真实二进制不入库；release
  workflow 会在每个平台 runner 上按目标准备。

App 运行时的外部工具优先级：

```text
用户指定路径 -> App 管理版本 -> 随包 sidecar -> PATH fallback
```

`yt-dlp`
App 管理更新会在启用前做 checksum、版本和兼容性契约检查，并保留上一版用于回退。

## 发布前检查

1. 跑通 `pnpm test:all`。
2. 跑通 `pnpm risk:gitnexus`，普通 PR 不允许 `critical` 影响面。
3. 用真实 App 导入少量测试数据并验证开始、暂停、恢复、重复导入。
4. 用真实 App 验证 `yt-dlp` 探测、公开视频下载、工具更新提示和回退按钮。
5. 跑通 `pnpm sidecars:check:all`，不允许占位 sidecar 进入正式发布。
6. 检查 `docs/current-state.md`、`docs/roadmap.md` 是否需要同步。
7. 发布说明写清新增能力、修复问题、已知风险和升级建议。

## GitNexus 风险门禁

普通改动应通过：

```bash
pnpm risk:gitnexus
```

该脚本运行 `gitnexus detect-changes --scope all`，并在风险等级为 `critical`
时失败。只有下载核心迁移、状态机迁移或跨模块架构调整才允许显式放行：

```bash
GITNEXUS_ALLOW_CRITICAL=1 pnpm risk:gitnexus
```

放行时 PR 描述必须写明影响面、验证命令和人工回归范围。

## GitHub Actions 发布链路

当前发布 workflow 采用“先预检、后打包”的额度友好策略：

1. `Release Preflight`
   先验证 tag 存在，并运行 TypeScript、ESLint、Prettier、Vitest、`cargo fmt`、`cargo clippy -D warnings`
   和 `cargo test`。
2. 只有预检通过后，才进入 Windows、macOS Intel、macOS Apple
   Silicon、Linux 的平台矩阵。
3. 手动触发时可以只构建单个平台族，适合先用 Linux 或 Windows 做低成本验证。
4. 只有 tag push 或手动传入 `publish=true` 时，才上传到 draft GitHub Release。
5. 每个平台进入 `pnpm tauri build` 前都会按 matrix
   target 准备并严格预检 sidecar。

手动低成本冒烟：

```bash
gh workflow run release.yml -f tag=v1.2.3 -f platforms=linux -f publish=false
```

全平台 draft release：

```bash
gh workflow run release.yml -f tag=v1.2.3 -f platforms=all -f publish=true
```

平台矩阵：

| 平台             | Runner           | Rust target                |
| ---------------- | ---------------- | -------------------------- |
| Windows x64      | `windows-latest` | `x86_64-pc-windows-msvc`   |
| macOS Intel      | `macos-15-intel` | `x86_64-apple-darwin`      |
| macOS Apple 芯片 | `macos-14`       | `aarch64-apple-darwin`     |
| Linux x64        | `ubuntu-22.04`   | `x86_64-unknown-linux-gnu` |

Linux 打包依赖与 Tauri v2 官方要求保持一致，使用 `libwebkit2gtk-4.1-dev`。
