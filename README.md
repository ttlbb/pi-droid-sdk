# pi-droid-sdk

A pi provider extension that lets pi use Factory Droid models through the local `@factory/droid-sdk` runtime.

Use this extension if you want Factory's full model catalog inside pi while keeping pi's native model picker, thinking controls where Droid exposes them, session restore, and default footer UX.

## Quick start

Full usage guide (Chinese): [USAGE.md](USAGE.md).

1. Install from GitHub (not published to npm yet):

```bash
pi install https://github.com/bentossell/pi-droid-sdk
```

Or from a local checkout:

```bash
pi install ~/repos/pi-droid-sdk
```

2. Install the Droid CLI if needed:

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

3. Authenticate:

```bash
export FACTORY_API_KEY=your-key
# or: run /login inside pi and pick "Use an API key -> Factory"
# or: pi --api-key your-key --model factory/kimi-k2.5
```

4. Pick a model:

```bash
pi --model factory/kimi-k2.5
```

## Models

Discovery calls `@factory/droid-sdk` session init and registers **all** `availableModels` from Factory — Anthropic, OpenAI, Gemini, Droid Core, and custom BYOK models.

Fallback models ship in-repo when auth or discovery fails. Refresh live catalog without restart:

```text
/droid-refresh-models
```

## Thinking / reasoning

When Droid exposes reasoning effort for a model, pi's native thinking controls map through:

- Shift+Tab in the TUI
- `--thinking off|minimal|low|medium|high|xhigh|max`
- `:medium` model suffix where supported

Core models like `kimi-k2.5` typically support `off` and `high`. Models whose top effort is Droid `Max` expose it as pi's `max` level; models that top out at `ExtraHigh` leave `max` unsupported.

## Usage

```text
/droid-usage
```

Shows Factory Droid token usage accumulated in the current pi session: per-model turns plus input, output, cache-read, cache-write, thinking, and total tokens, with a total row, the session's total token count and cache-hit rate, and the plan's 5-hour, 7-day, and 1-month consumption with each window's reset time.

Session usage is counted from Droid's own turn-complete token reports, so it covers only turns that finished; interrupted turns are not counted and the counters reset on the next `session_start`. `total` is input + output + cache reads + cache writes, and the cache-hit rate is cache reads over the whole prompt (uncached + cache reads + cache writes), the same ratio the Droid statusline shows.

Plan limits come from Factory's own billing endpoint (`GET https://api.factory.ai/api/billing/limits`) using the same Factory API key resolution as model discovery. The report lists each quota pool that has an active window; when the lookup fails, the token report still renders and the limits line says why (for example `HTTP 401` or `no Factory API key configured`).

## Pi tool bridge

Like `pi-cursor-sdk`, active pi tools are exposed to Droid via `createSdkMcpServer` under `pi__*` MCP names. Bridged calls execute through normal pi tool flow.

## Permissions & questions

- Droid native tool confirmations use `permissionHandler` (default autonomy: `high` via `PI_DROID_AUTONOMY_LEVEL`)
- Bridge MCP tools auto-proceed
- Droid ask-user flows route to pi UI via `askUserHandler`
- `droid_ask_question` pi tool is registered when a Factory model is active

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `FACTORY_API_KEY` | unset | Factory API key; checked after `--api-key` and stored `/login` credentials |
| `PI_DROID_PI_TOOL_BRIDGE` | enabled | `0`/`false`/`off` disables the `pi__*` tool bridge |
| `PI_DROID_EXPOSE_BUILTIN_TOOLS` | disabled | `1`/`true`/`on` also exposes overlapping builtins (`read`, `bash`, `write`, `edit`, `grep`, `find`, `ls`) |
| `PI_DROID_AUTONOMY_LEVEL` | `high` | Droid native tool autonomy: `off`, `low`, `medium`, `high` (`off` cancels every non-bridged confirmation) |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi config dir; `auth.json` here supplies stored Factory credentials |

## Requirements

- Node >= 22.19
- pi >= 1.4.0 (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`)
- `droid` on PATH (SDK spawns it)
- `FACTORY_API_KEY`, a `--api-key`, or pi stored auth for provider `factory`

## Development

```bash
npm install
npm run typecheck
npm test
```

## Related

- [@factory/droid-sdk](https://github.com/Factory-AI/droid-sdk-typescript)
- [pi-cursor-sdk](https://github.com/fitchmultz/pi-cursor-sdk) — same bridge pattern for Cursor models
