import type { ExtensionAPI, ExtensionContext, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { discoverModels, type DroidModelFallbackIssue } from "./model-discovery.js";
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
	const models = await discoverModels({
		onFallback: (issue) => {
			fallbackIssue = issue;
		},
		onUnknownContextWindow: (modelIds) => {
			unknownContextWindowIds = modelIds;
		},
	});

	if (fallbackIssue) {
		const issue = fallbackIssue;
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(issue.message, "warning");
		});
	}

	if (unknownContextWindowIds.length > 0) {
		const modelIds = unknownContextWindowIds;
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(unknownContextWindowNotice(modelIds), "warning");
		});
	}

	pi.registerCommand("droid-refresh-models", {
		description: "Refresh the live Factory model catalog without restarting pi",
		handler: async (_args, ctx) => {
			let refreshFallbackIssue: DroidModelFallbackIssue | undefined;
			let refreshUnknownContextWindowIds: string[] = [];
			const refreshedModels = await discoverModels({
				onFallback: (issue) => {
					refreshFallbackIssue = issue;
				},
				onUnknownContextWindow: (modelIds) => {
					refreshUnknownContextWindowIds = modelIds;
				},
			});
			registerDroidProvider(pi, refreshedModels);
			if (!ctx.hasUI) return;
			if (refreshFallbackIssue) {
				ctx.ui.notify(`Factory model catalog refresh still using fallback models: ${refreshFallbackIssue.message}`, "warning");
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
