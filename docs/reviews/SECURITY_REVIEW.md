# 安全评审报告 — Video Downloader Pro

> 评审日期：2026-05-05
> 范围：Tauri 配置、CSP、Capabilities、子进程调用、依赖漏洞
> 不在范围：Rust 代码内存安全详细审计（需 cargo + miri，环境受限）

## 一、TL;DR

| 维度 | 结果 |
|------|------|
| `pnpm audit --prod` | ✅ 0 known vuln |
| `.claude/settings.local.json` 权限 | ✅ 仅放行受限指令 |
| Tauri capabilities | ⚠️ 仅 `core:default` + `dialog:default`，权限面小，OK |
| **CSP** | 🔴 含 `'unsafe-eval'` + `connect-src` 重复条目 |
| 子进程调用 | 🟡 yt-dlp/youtube-dl 输入 URL 缺 scheme 白名单 |
| Windows 安装 | 🟡 `webviewInstallMode.silent: true` |

## 二、CSP 详评（src-tauri/tauri.conf.json:63）

当前 CSP：

```
default-src 'self';
img-src 'self' asset: https://asset.localhost data: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self' asset: https://asset.localhost;
script-src 'self' 'unsafe-eval';
connect-src ipc: http://ipc.localhost 'self' ipc: http://ipc.localhost;
media-src 'self' asset: https://asset.localhost
```

### 🔴 S-01 `script-src 'unsafe-eval'`

**风险**：`'unsafe-eval'` 允许 `eval()`、`new Function()`、`setTimeout(string, ...)` 等动态代码执行路径。一旦页面被注入恶意字符串（例如来自远端 API 返回、剪贴板、文件名等渠道），就可以直接落地为代码执行。

**Tauri v2 是否真的需要？**

- 生产构建：通常**不需要**。Vite v7 + esbuild 的产物不依赖 eval；React 19 也不依赖。
- 开发模式：Vite 的 HMR 在某些情况下会用 `Function()`，但 Tauri v2 推荐用 `tauri.conf.local.json` 单独覆盖 dev 配置，而不是在主配置里放行 unsafe-eval。

**建议**：

1. 移除主 `tauri.conf.json` 中的 `'unsafe-eval'`，改为：
   ```
   script-src 'self';
   ```
2. 若 dev 模式 HMR 需要，仅在 `tauri.conf.local.json`（已存在）里追加 `'unsafe-eval'`，并在 `build:local` 任务中使用。
3. 启动一次 `pnpm tauri dev` + `pnpm tauri build`，分别验证：
   - dev 仍可热更新；
   - prod 包打开后控制台无 CSP 违规。

### 🟡 S-02 `connect-src` 重复条目

```
connect-src ipc: http://ipc.localhost 'self' ipc: http://ipc.localhost;
```

`ipc:` 与 `http://ipc.localhost` 各自被列了两次。规范上不会"出错"，但浏览器会照单解析重复 token，是一处明显的复制粘贴瑕疵。

**建议**：去重为：

```
connect-src 'self' ipc: http://ipc.localhost;
```

### 🟡 S-03 `style-src 'unsafe-inline'`

Tailwind v4 + shadcn/ui v4 是会注入 inline 样式的（动态 class、变量主题）。继续保留 `'unsafe-inline'` 是合理的；可在未来切到 nonce 或 hash 方案，但当前不阻塞。

**结论**：保留，但写在配置注释/文档里说明已知。

## 三、Tauri Capabilities

### `src-tauri/capabilities/migrated.json`

```json
{
  "identifier": "migrated",
  "description": "permissions that were migrated from v1",
  "local": true,
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default"]
}
```

### 🟢 C-01 权限面极小，符合最小权限原则

仅放行 `core:default` 与 `dialog:default`，未授予 `fs:*`、`shell:open`、`http:*` 等高风险权限。✅

### 🟡 C-02 文件名与代码引用不一致

`AGENTS.md:89` 描述 "添加 Tauri 插件"流程时说：

> 3. Update `src-tauri/capabilities/default.json` for whitelist permissions.

但实际文件名是 `migrated.json`。这会误导贡献者把权限加到一个不存在的文件，从而被默认配置覆盖。

**建议**（已计入 NLPM_REPORT 与 ACTION_PLAN）：

- 方案 A（推荐）：把 `migrated.json` 重命名为 `default.json` 并相应更新 identifier；
- 方案 B：把 AGENTS.md 改为引用 `migrated.json`。

## 四、子进程调用

### `src-tauri/src/commands/system.rs`

| 行 | 调用 | 风险 |
|----|------|------|
| 67 | `Command::new("explorer.exe").spawn()` | 🟢 路径来源于 Tauri 文件对话框 / AppHandle，无 shell 注入 |
| 75 | `Command::new("open")` (macOS) | 🟢 同上 |
| 83 | `Command::new("xdg-open")` (Linux) | 🟢 同上 |
| 201 | `Command::new("yt-dlp")` | 🟡 入参中含用户提供的 URL；建议加 scheme 白名单 |
| 220 | `Command::new("youtube-dl")` | 🟡 同上 |

### 🟡 S-04 yt-dlp 入参 URL 未做 scheme 白名单

yt-dlp / youtube-dl 接受非 `http(s)` URL（如 `file://`、`ftp://`），即使本应用无意支持。建议在调用前：

```rust
let parsed = url::Url::parse(input)
    .map_err(|e| AppError::Validation(format!("invalid URL: {e}")))?;
match parsed.scheme() {
    "http" | "https" => Ok(()),
    other => Err(AppError::Validation(format!("unsupported scheme: {other}"))),
}?;
```

并在 commands 入口处统一拦截。

## 五、依赖漏洞

### 5.1 npm（pnpm audit --prod）

```
No known vulnerabilities found
```

✅ 无已知 CVE。

### 5.2 cargo audit

⚠️ 评审环境无 `cargo` 工具链，未执行。建议本地或 CI 上执行：

```bash
cargo install cargo-audit
cargo audit --manifest-path src-tauri/Cargo.toml
```

考虑到 `reqwest 0.11` / `env_logger 0.10` 偏老（详见 CODE_REVIEW.md R-06），有概率命中已知 advisory（如 idna 系列）。

## 六、Windows / macOS 部署项

### 🟡 S-05 `bundle.windows.webviewInstallMode.silent: true`

```json
"webviewInstallMode": { "type": "embedBootstrapper", "silent": true }
```

silent 安装 WebView2 在企业环境合规上可能踩 "未经用户同意安装组件" 红线。建议：

- 若目标用户群是普通消费者：保留 silent，但在安装器 EULA 中注明会安装 WebView2；
- 若目标包含企业用户：改为 `"silent": false`，让用户看到 Microsoft 的标准对话框。

### 🟢 S-06 `app.security.useHttpsScheme: true`

Tauri v2 的 `useHttpsScheme: true` 会为生产 webview 强制使用 `https://tauri.localhost` 而非 `http://`，已正确启用。✅

### 🟡 S-07 macOS `exceptionDomain: "localhost"`

```json
"macOS": { "exceptionDomain": "localhost" }
```

为应用授权 ATS 例外，允许向 localhost 发起明文连接。开发期合理；生产期应确认 release 包内**不再**通过 localhost 与外部通信，否则可能被苹果安全策略卡审核。

## 七、汇总

| ID | 等级 | 修复路径 |
|----|------|---------|
| S-01 `'unsafe-eval'` | 🔴 | PR-CSP（独立 PR，需触发完整 dev/prod 自测）|
| S-02 connect-src 去重 | 🟡 | 同 PR-CSP |
| S-04 URL scheme 白名单 | 🟡 | PR-E（与 CODE_REVIEW R-05 合并）|
| S-05 silent install | 🟡 | 视目标人群决定 |
| S-07 ATS exception | 🟡 | release 前确认 |
| C-02 capabilities 文件名 | 🟡 | 与 AGENTS.md 修复一并处理 |
| cargo-audit | ⚠️ | 在 CI 中加 step |
