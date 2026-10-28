# pi-droid-sdk

A pi provider extension that lets pi use Factory Droid models through the local `@factory/droid-sdk` runtime.

Use this extension if you want Factory's full model catalog inside pi while keeping pi's native model picker, thinking controls where Droid exposes them, session restore, and default footer UX.

## Quick start

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
# or: pi --login  (Use an API key -> Factory)
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

Shows Factory Droid token usage accumulated in the current pi session: per-model turns plus input, output, cache-read, cache-write, and thinking tokens, with a total row. Usage is counted from Droid's own turn-complete token reports, so it covers only turns that finished; interrupted turns are not counted and the counters reset on the next `session_start`.

## Pi tool bridge

Like `pi-cursor-sdk`, active pi tools are exposed to Droid via `createSdkMcpServer` under `pi__*` MCP names. Bridged calls execute through normal pi tool flow.

Env:

- `PI_DROID_PI_TOOL_BRIDGE=0` — disable bridge
- `PI_DROID_EXPOSE_BUILTIN_TOOLS=1` — expose overlapping builtins (`read`, `bash`, etc.)

## Permissions & questions

- Droid native tool confirmations use `permissionHandler` (default autonomy: `high` via `PI_DROID_AUTONOMY_LEVEL`)
- Bridge MCP tools auto-proceed
- Droid ask-user flows route to pi UI via `askUserHandler`
- `droid_ask_question` pi tool is registered when a Factory model is active

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
