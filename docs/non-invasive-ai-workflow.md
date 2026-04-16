# 无侵入 AI 开发工作流说明

## 目标

为当前仓库建立一个可持续升级的 Hermes + graphify + GSD 工作流，同时满足：

- 不修改 Hermes 上游仓库源码
- 不修改 graphify 上游包源码
- 不修改 get-shit-done / GSD 上游仓库源码
- 本地项目工作流可继续使用
- 后续上游仓库升级时，优先只调整薄封装层，而不是回改上游

---

## 设计原则

### 1. 薄封装，不侵入

本方案只增加以下内容：

- `~/.local/bin/graphify` — graphify wrapper
- `~/.local/bin/gsd-sdk` — GSD SDK wrapper
- `./scripts/ai-workflow.sh` — 项目统一工作流入口

它们都属于“外部适配层”，不改 Hermes / graphify / GSD 仓库内文件。

### 2. 只依赖相对稳定入口

封装层依赖的是：

- `hermes` CLI
- `python -m graphify`
- `node /data/ai-coding/get-shit-done/sdk/dist/cli.js`

相比直接依赖内部实现文件、私有脚本、仓库局部结构，这种方式更适合长期升级。

### 3. 上游升级时只修 wrapper

如果未来发生变化，优先处理顺序是：

1. 看 Hermes / graphify / GSD 的入口是否仍兼容
2. 若不兼容，只修改 wrapper
3. 尽量不碰上游仓库源码

也就是说，升级成本被控制在“适配层”，而不是扩散到整个工作流。

---

## 当前封装内容

## 1. graphify wrapper

位置：`~/.local/bin/graphify`

作用：
- 优先使用 `GRAPHIFY_PY`
- 否则自动寻找可 `import graphify` 的 Python
- 最后执行 `python -m graphify`

好处：
- 即使 graphify 没有安装成系统级 CLI，也可以稳定调用
- 不依赖修改 Hermes 仓库

## 2. gsd-sdk wrapper

位置：`~/.local/bin/gsd-sdk`

作用：
- 默认指向 `/data/ai-coding/get-shit-done/sdk`
- 调用 `node dist/cli.js`
- 若缺少 build 产物，给出明确修复提示

好处：
- 不需要把 GSD 真正 npm -g 安装到系统全局
- 避免全局 Node 安装污染
- 未来切换 GSD 源码路径时，只需设置 `GSD_SDK_ROOT`

## 3. 项目统一入口

位置：`./scripts/ai-workflow.sh`

支持命令：

```bash
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
./scripts/ai-workflow.sh sync
./scripts/ai-workflow.sh force
./scripts/ai-workflow.sh next
./scripts/ai-workflow.sh contract
```

用途：
- `doctor`：检查 Hermes / graphify / GSD / graphify-out / .planning / .codex
- `context`：输出建议阅读顺序并附带 graphify status
- `sync`：执行 graphify smart sync
- `force`：执行 graphify full rebuild
- `next`：输出推荐迭代节奏
- `contract`：显示无侵入升级约定

---

## 升级兼容性边界

### 一般升级不会影响的情况

以下情况通常不会影响当前工作流：

- Hermes 版本升级，但 `hermes` 命令仍存在
- graphify 内部实现调整，但 `python -m graphify` 仍可用
- GSD SDK 内部代码调整，但 `sdk/dist/cli.js` 仍为入口
- 项目继续保留 `scripts/graphify-sync.sh`、`.planning/`、`.codex/` 结构

### 可能需要改 wrapper 的情况

以下情况可能需要更新薄封装层：

- graphify 改了 Python module 入口，不再支持 `python -m graphify`
- GSD SDK 改了 dist 输出位置或 CLI 文件名
- Hermes 改了 venv 布局，导致 wrapper 的默认 Python 候选失效
- 项目迁移了 `get-shit-done` 的本地路径

### 仍然不建议的做法

为了保持可升级性，仍不建议：

- 直接改 Hermes 仓库内命令实现
- 直接改 graphify site-packages 源码
- 直接改 GSD 上游仓库的安装逻辑以适配本项目
- 把项目 workflow 强绑定到某个上游仓库的私有文件路径

---

## 推荐使用方式

前提：
- Hermes 已由用户预先安装
- 首次 bootstrap 允许联网
- graphify / GSD 可由工作流自动安装或升级

每次进入项目：

```bash
cd /data/ai-coding/tauri-video-batch-downloader
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
```

开始一次迭代：

```bash
./scripts/ai-workflow.sh sync
# 然后阅读 graphify-out/GRAPH_REPORT.md
# 如果 .planning/ 已存在，再阅读 .planning/STATE.md 和 .planning/ROADMAP.md
```

代码改动后：

```bash
./scripts/ai-workflow.sh sync
```

需要全量图谱刷新时：

```bash
./scripts/ai-workflow.sh force
```

如果 graphify 升级后仍然提示 skill 版本过旧：

```bash
graphify install --platform hermes
graphify install --platform claude
```

因为 graphify 会扫描多个平台目录的安装版本，而不只是 Hermes 本身。

---

## 总结

这套方案的核心不是“把上游改成适合我们”，而是：

- 保持 Hermes / graphify / GSD 上游可自由升级
- 我们只维护一个很薄的本地适配层
- 让当前仓库获得稳定、可复用、可迁移的 AI 开发工作流

如果未来上游变化，只要 CLI 主入口没有完全消失，通常只需要修 wrapper，而不用推翻当前 workflow。
