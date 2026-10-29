import type { ExtensionAPI, ExtensionContext, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { discoverModels, type DroidModelFallbackIssue } from "./model-discovery.js";
import {
	parseDroidModelScope,
	resolveDroidModelScope,
	type DroidModelScope,
	type DroidModelScopeInfo,
} from "./droid-model-scope.js";
import { DROID_DEFAULT_CONTEXT_WINDOW } from "./droid-context-window.js";
import { registerDroidPiToolBridge } from "./droid-pi-tool-bridge.js";
import { registerDroidQuestionTool } from "./droid-question-tool.js";
import { registerDroidSessionCwd } from "./droid-session-cwd.js";
import { registerDroidUsageCommand } from "./droid-usage.js";
import { setDroidAskUserUiContext } from "./droid-ask-user.js";
import { streamDroid } from "./droid-provider.js";

type DroidExtensionApi =
	& Pick<ExtensionAPI, "registerProvider">
	& {
		registerCommand(name: string, options: {
			description?: string;
			handler: (args: string, ctx: Pick<ExtensionContext, "hasUI"> & { ui: Pick<ExtensionContext["ui"], "notify" | "setWidget"> }) => Promise<void> | void;
		}): void;
		on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
	}
	& Parameters<typeof registerDroidSessionCwd>[0]
	& Parameters<typeof registerDroidQuestionTool>[0]
	& Parameters<typeof registerDroidPiToolBridge>[0]
	& Parameters<typeof registerDroidUsageCommand>[0];

function createDroidProviderConfig(models: ProviderModelConfig[]): ProviderConfig {
	return {
		name: "Factory",
		baseUrl: "https://factory.ai",
		// pi 1.x treats this as a literal key for custom APIs. The extension resolves the real
		// value (cli --api-key, stored /login credential, FACTORY_API_KEY) inside streamDroid,
		// so the literal is never sent anywhere.
		apiKey: "FACTORY_API_KEY",
		api: "droid-sdk",
		models,
		streamSimple: streamDroid,
	};
}

function registerDroidProvider(pi: Pick<ExtensionAPI, "registerProvider">, models: ProviderModelConfig[]): void {
	pi.registerProvider("factory", createDroidProviderConfig(models));
}

function unknownContextWindowNotice(modelIds: string[]): string {
	const windowInThousands = Math.round(DROID_DEFAULT_CONTEXT_WINDOW / 1000);
	return `Factory reported no context window for ${modelIds.join(", ")}; using a conservative ${windowInThousands}K context window for it.`;
}

const SCOPE_USAGE = "/droid-refresh-models [--favorites|--all]";

/** `--favorites` / `--all` for one refresh; anything else is a usage error. */
function parseScopeArgument(args: string): DroidModelScope | "invalid" | undefined {
	const trimmed = args.trim();
	if (!trimmed) return undefined;
	const normalized = trimmed.replace(/^--?/, "");
	return parseDroidModelScope(normalized) ?? "invalid";
}

function unavailableFavoritesNotice(info: DroidModelScopeInfo): string {
	switch (info.fallbackReason) {
		case "favorites-unavailable":
			return "Droid favorites are unavailable (no readable modelFavorites in ~/.factory/settings.json), so the full Factory catalog stays registered.";
		case "favorites-empty":
			return "Droid has no favorite models yet, so the full Factory catalog stays registered.";
		case "favorites-not-in-catalog":
			return "None of the Droid favorites exist in the Factory catalog that was just discovered, so the full catalog stays registered.";
		default:
			return "Droid favorites could not be applied, so the full Factory catalog stays registered.";
	}
}

function scopeMessage(info: DroidModelScopeInfo): string {
	if (info.appliedScope === "favorites") {
		const count = info.modelCount;
		const hidden = info.catalogCount - count;
		const base = `Factory model catalog refreshed with ${count} favorite${count === 1 ? "" : "s"} (${hidden} other${hidden === 1 ? "" : "s"} hidden); ${SCOPE_USAGE} to change.`;
		return info.unmatchedFavoriteIds.length > 0
			? `${base} Favorites not in the catalog: ${info.unmatchedFavoriteIds.join(", ")}.`
			: base;
	}
	if (info.requestedScope === "favorites") {
		const base = `${unavailableFavoritesNotice(info)} Refreshed with ${info.modelCount} model${info.modelCount === 1 ? "" : "s"}.`;
		return info.unmatchedFavoriteIds.length > 0
			? `${base} Favorites not in the catalog: ${info.unmatchedFavoriteIds.join(", ")}.`
			: base;
	}
	return `Factory model catalog refreshed with ${info.modelCount} model${info.modelCount === 1 ? "" : "s"} (full catalog).`;
}

export default async function (pi: DroidExtensionApi) {
	registerDroidSessionCwd(pi);
	registerDroidQuestionTool(pi);
	registerDroidPiToolBridge(pi);
	registerDroidUsageCommand(pi);

	pi.on("session_start", (_event, ctx) => {
		setDroidAskUserUiContext({ hasUI: ctx.hasUI, ui: ctx.ui });
	});

	let fallbackIssue: DroidModelFallbackIssue | undefined;
	let unknownContextWindowIds: string[] = [];
	let scopeInfo: DroidModelScopeInfo | undefined;
	// Session-scoped picker scope: the environment sets the start value, a refresh can override it.
	let modelScope: DroidModelScope = resolveDroidModelScope();
	const models = await discoverModels({
		scope: modelScope,
		onFallback: (issue) => {
			fallbackIssue = issue;
		},
		onUnknownContextWindow: (modelIds) => {
			unknownContextWindowIds = modelIds;
		},
		onModelScope: (info) => {
			scopeInfo = info;
		},
	});

	if (fallbackIssue) {
		const issue = fallbackIssue;
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(issue.message, "warning");
		});
	}

	if (scopeInfo && scopeInfo.appliedScope === "all" && scopeInfo.requestedScope === "favorites") {
		const notice = unavailableFavoritesNotice(scopeInfo);
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(notice, "warning");
		});
	}

	if (unknownContextWindowIds.length > 0) {
		const modelIds = unknownContextWindowIds;
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(unknownContextWindowNotice(modelIds), "warning");
		});
	}

	pi.registerCommand("droid-refresh-models", {
		description: "Refresh the live Factory model catalog without restarting pi (--favorites keeps only Droid favorites, --all restores the full catalog)",
		handler: async (args, ctx) => {
			const requestedScope = parseScopeArgument(args);
			if (requestedScope === "invalid") {
				if (ctx.hasUI) ctx.ui.notify(`Unknown option "${args.trim()}". Usage: ${SCOPE_USAGE}.`, "error");
				return;
			}
			if (requestedScope) modelScope = requestedScope;

			let refreshFallbackIssue: DroidModelFallbackIssue | undefined;
			let refreshUnknownContextWindowIds: string[] = [];
			let refreshScopeInfo: DroidModelScopeInfo | undefined;
			const refreshedModels = await discoverModels({
				scope: modelScope,
				onFallback: (issue) => {
					refreshFallbackIssue = issue;
				},
				onUnknownContextWindow: (modelIds) => {
					refreshUnknownContextWindowIds = modelIds;
				},
				onModelScope: (info) => {
					refreshScopeInfo = info;
				},
			});
			registerDroidProvider(pi, refreshedModels);
			if (!ctx.hasUI) return;
			if (refreshFallbackIssue) {
				ctx.ui.notify(`Factory model catalog refresh still using fallback models: ${refreshFallbackIssue.message}`, "warning");
			} else if (refreshScopeInfo) {
				ctx.ui.notify(
					scopeMessage(refreshScopeInfo),
					refreshScopeInfo.requestedScope === "favorites" && refreshScopeInfo.appliedScope === "all" ? "warning" : "info",
				);
			} else {
				ctx.ui.notify(`Factory model catalog refreshed with ${refreshedModels.length} model${refreshedModels.length === 1 ? "" : "s"}.`, "info");
			}
			if (refreshUnknownContextWindowIds.length > 0) {
				ctx.ui.notify(unknownContextWindowNotice(refreshUnknownContextWindowIds), "warning");
			}
		},
	});

	registerDroidProvider(pi, models);
}
