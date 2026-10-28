# Changelog

## Unreleased

- Support pi 1.4 (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui` >= 1.4.0): stored Factory credentials are read with `readStoredCredential()`, Droid prompts use the normalized transcript system message, bridge tool arguments are validated as JSON objects, provider stream events are forwarded, and the `max` thinking level is supported
- Add `/droid-usage` for per-model Factory Droid token usage in the current pi session
- Remove dead permission and question formatter code plus the non-functional `refresh:droid-snapshots` script, and document every environment variable
- Add `USAGE.md`, a full usage guide

## 0.1.0

- Initial scaffold: Factory provider via `@factory/droid-sdk`
- Live model discovery from `availableModels` (all Factory models)
- Pi tool bridge via `createSdkMcpServer`
- Reasoning effort mapping to pi thinking controls
- Permission handler + ask-user UI wiring
- Fallback model catalog and `/droid-refresh-models`
