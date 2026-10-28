# pi-droid-sdk 使用说明

本扩展让 pi 通过本机 `@factory/droid-sdk`（spawn `droid` CLI）使用 Factory Droid 的全部模型，并保留 pi 原生的模型选择、思考档位、会话恢复与 UI。

## 前置要求

| 项目 | 要求 |
|---|---|
| Node.js | >= 22.19 |
| pi | `@earendil-works/pi-coding-agent` / `pi-ai` / `pi-tui` >= 1.4.0 |
| Droid CLI | `droid` 在 `PATH` 中（SDK 通过子进程运行它） |
| 认证 | Factory API key（三种方式见下） |

安装 Droid CLI：

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

## 安装扩展

```bash
# 从 GitHub
pi install https://github.com/bentossell/pi-droid-sdk

# 或从本地 checkout
pi install ~/repos/pi-droid-sdk
```

## 认证

按优先级从高到低：

1. `pi --api-key <key>`
2. pi 存储的凭据：pi 内执行 `/login` → 选择 “Use an API key -> Factory”
3. 环境变量 `FACTORY_API_KEY`

```bash
export FACTORY_API_KEY=your-key
pi --model factory/kimi-k2.5
```

认证只需要一种。未配置认证时扩展仍可启动，但只提供内置 fallback 模型并在会话开始时给出警告。

## 选模型

```bash
pi --model factory/kimi-k2.5          # 直接指定
pi --models 'factory/*'               # Ctrl+P 循环切换
```

pi 内用 `/model` 搜索 `factory/` 前缀即可看到全部模型，包括 Anthropic、OpenAI、Gemini、Droid Core 与自定义 BYOK 模型。

模型目录来自 Droid 的 `availableModels`。补上认证后无需重启，执行：

```text
/droid-refresh-models
```

## 思考档位

pi 的档位按每个模型的映射转换成 Droid 的 reasoning effort：

| pi 档位 | Droid effort | 说明 |
|---|---|---|
| `off` | Off | |
| `minimal` | Minimal | |
| `low` | Low | |
| `medium` | Medium | |
| `high` | High | |
| `xhigh` | ExtraHigh | 模型没有 ExtraHigh 时退回 Max |
| `max` | Max | 模型最高只到 ExtraHigh 时该档不可用 |

- TUI 中用 Shift+Tab 切换，命令行用 `--thinking off|minimal|low|medium|high|xhigh|max`，也可用 `:medium` 模型后缀。
- 模型不支持的档位会退回该模型的默认 effort，不会报错。
- Droid Core 模型（如 `kimi-k2.5`）通常只支持 `off` 与 `high`。

## 命令

### `/droid-refresh-models`

重新执行模型发现并重新注册 `factory` provider。适用于：刚完成 `/login`、刚设置 `FACTORY_API_KEY`、Droid 升级后模型列表变化。

### `/droid-usage`

显示**当前 pi 会话**内 Factory Droid 的 token 用量，以及 Factory 账户 5 小时 / 7 天 / 1 个月的额度消耗与恢复时间。

```text
Factory Droid usage — 3 turns since 21:02
model                               turns      input     output    cache R    cache W   thinking        total
claude-sonnet-4-5                       2      1,204        356     12,000      1,500        120       15,180
gpt-5.5                                 1        800        120          0          0         40          960
total                                   3      2,004        476     12,000      1,500        160       16,140
total tokens: 16,140 · cache hit 82.8%
last turn: gpt-5.5 at 21:14

Factory limits
  standard 5h        4.0% used · resets in 3h 16m
  standard 7d        0.0% used · no active window
  standard 1m       58.0% used · resets on Nov 5 (in 7d 22h)
```

- 数据来源是 Droid 每轮结束时的 `tokenUsage` 报告；**只统计已完成轮次**，被中断的轮次不计。
- 每个模型一行，最后一行是合计；`cache R` / `cache W` 分别是缓存读取与缓存写入，`total` = input + output + cache R + cache W。
- `cache hit` = cache R ÷（input + cache R + cache W），与 Droid statusline 的口径一致；没有 prompt token 时显示 `n/a`。
- 额度块来自 Factory 计费接口 `GET https://api.factory.ai/api/billing/limits`，用的是与模型发现相同的 Factory API key。`5h` / `7d` / `1m` 为已用百分比；`resets in 3h 16m`（24 小时内）或 `resets on Nov 5 (in 7d 22h)`（更远），没有活动窗口时显示 `no active window`。三个窗口都为空额度的池（通常是 `core`）整块省略。
- 额度查询失败不影响 token 报表：报表里会显示 `Factory limits: unavailable (HTTP 401)` 之类的原因（无 key 时为 `no Factory API key configured`）。
- TUI 中报表以 widget 形式显示在编辑器上方，同时弹出一行摘要（含总 token、缓存命中率与三档百分比）；无 UI 时只弹摘要。
- 计数器在每次 pi `session_start`（新建、恢复、重载、fork）时清零。

## 工具桥（pi 工具 → Droid）

扩展通过 `createSdkMcpServer` 把 pi 当前启用的工具以 `pi__<工具名>` 暴露给 Droid，Droid 的调用最终走 pi 正常的工具流程（含权限、渲染、结果回传）。

- 默认**不**暴露与 Droid 原生工具重叠的内置工具：`read`、`bash`、`write`、`edit`、`grep`、`find`、`ls`。
- `PI_DROID_EXPOSE_BUILTIN_TOOLS=1` 可强制暴露这些内置工具。
- `PI_DROID_PI_TOOL_BRIDGE=0` 完全关闭工具桥（Droid 只能用自己的原生工具）。
- 桥接的 MCP 工具自动放行，不弹权限确认。

## 权限与提问

- Droid 原生工具确认（执行命令、写文件等）由 `PI_DROID_AUTONOMY_LEVEL` 决定，默认 `high`：

| 取值 | 行为 |
|---|---|
| `off` | 取消所有非桥接确认（等同拒绝） |
| `low` | 低自治自动执行 |
| `medium` | 中自治自动执行 |
| `high` | 高自治自动执行（默认） |

- Droid 通过 `askUserHandler` 发起的提问会路由到 pi 的 UI（选择列表/输入框）。
- `droid_ask_question` 工具仅在“当前模型是 `factory` 且工具桥开启”时出现在可用工具中，模型不在 factory 模型上时会自动移除。

## 会话与输入

- Droid 子进程使用当前 pi 会话的工作目录。
- pi 的系统提示（preamble、规则、AGENTS.md、cwd）会作为 Droid 的提示前缀；pi 的工具目录会被替换成桥接说明，避免 Droid 误以为自己能调用未暴露的工具。
- 历史消息（用户、助手、工具调用与结果）会格式化成文本转录传给 Droid。
- 只有**最近一条用户消息**里的图片会随请求发送，支持 jpeg/png/gif/webp；历史图片以占位文本表示。
- 中断（Esc）会中止 Droid 流并把该轮标记为 aborted，不计入用量。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `FACTORY_API_KEY` | 未设置 | Factory API key；优先级低于 `--api-key` 与 `/login` 存储凭据 |
| `PI_DROID_PI_TOOL_BRIDGE` | 开启 | `0`/`false`/`off` 关闭 `pi__*` 工具桥 |
| `PI_DROID_EXPOSE_BUILTIN_TOOLS` | 关闭 | `1`/`true`/`on` 额外暴露重叠的内置工具 |
| `PI_DROID_AUTONOMY_LEVEL` | `high` | Droid 原生工具自治级别：`off`、`low`、`medium`、`high` |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi 配置目录；其中的 `auth.json` 提供存储凭据 |

## 故障排查

| 现象 | 处理 |
|---|---|
| `Factory API key required. Use /login ...` | 配置任一认证方式后重启 pi，或执行 `/droid-refresh-models` |
| 提示 Droid CLI 未找到 / `spawn` 失败 | 安装 `droid` 并确认 `command -v droid` 有输出 |
| 只有 fallback 模型、没有实时目录 | 没有有效认证或模型发现失败；补认证后 `/droid-refresh-models` |
| 请求返回 401/403 | key 无效或无该模型权限；重新 `/login` 或换 key |
| `/droid-usage` 显示 “no completed Droid turns” | 本会话还没有完成的 Droid 轮次；中断的轮次不计 |
| 桥接工具在 Droid 侧看不到 | 检查 `PI_DROID_PI_TOOL_BRIDGE` 是否被设为 0；内置工具需 `PI_DROID_EXPOSE_BUILTIN_TOOLS=1` |
| `droid_ask_question` 不在工具列表 | 当前模型不是 `factory` 模型，或工具桥被关闭 |

## 已知限制

- `/droid-usage` 只统计本 pi 会话内已完成的轮次，不读取 Droid 历史会话；额度块是账户级数据，来自 Factory 计费接口，与本地统计无关。
- fallback 模型目录是仓库内维护的快照（`src/droid-fallback-models.generated.ts`），需要按 https://docs.factory.ai/models 手工更新。
- 各模型的上下文长度来自 `src/droid-context-windows.generated.ts`（Factory 只通过 `getContextStats()` 逐模型返回，`availableModels` 里没有）。表里没有的新模型会在发现时实测一次；实测失败则按 131K 保守值处理并在启动时提示。整表刷新：`npm run refresh:droid-context-windows`（需要 Factory key 与 PATH 上的 `droid`）。
- 输出上限（`maxTokens`）仍是固定 16.4K，SDK 未提供逐模型来源。
- Droid 原生工具与 pi 内置工具同时存在；默认只把非重叠的 pi 工具暴露给 Droid，避免模型混用两套同名工具。

## 开发

```bash
npm install
npm run typecheck
npm test
```
