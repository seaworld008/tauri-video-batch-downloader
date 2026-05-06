# 构建与发布（Build & Release）

更新日期：2026-05-06

## 生产包

```bash
pnpm build:prod
```

等价主路径：

```bash
pnpm build
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

## 平台说明

| 平台    | 说明                                          |
| ------- | --------------------------------------------- |
| macOS   | Tauri 默认生成 `.app` / `.dmg`                |
| Windows | 需要 WebView2 runtime；安装包应包含检测与引导 |
| Linux   | 依赖 WebKitGTK/GTK，deb 依赖见 Tauri 配置     |

## 发布前检查

1. 跑通 `pnpm test:all`。
2. 用真实 App 导入少量测试数据并验证开始、暂停、恢复、重复导入。
3. 检查 `docs/current-state.md`、`docs/roadmap.md` 是否需要同步。
4. 发布说明写清新增能力、修复问题、已知风险和升级建议。

## GitHub Actions 发布链路

当前发布 workflow 采用“先预检、后打包”的额度友好策略：

1. `Release Preflight`
   先验证 tag 存在，并运行 TypeScript、ESLint、Prettier、Vitest、`cargo fmt`、`cargo clippy -D warnings`
   和 `cargo test`。
2. 只有预检通过后，才进入 Windows、macOS Intel、macOS Apple
   Silicon、Linux 的平台矩阵。
3. 手动触发时可以只构建单个平台族，适合先用 Linux 或 Windows 做低成本验证。
4. 只有 tag push 或手动传入 `publish=true` 时，才上传到 draft GitHub Release。

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
