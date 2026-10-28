import {
	type Api,
	type AssistantMessageEventStream,
	type JsonObject,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type AssistantMessage,
	type ToolResultMessage,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	DroidMessageType,
	createSession,
	type DroidSession,
} from "@factory/droid-sdk";
import { buildDroidPrompt, estimateDroidPromptInputTokens } from "./context.js";
import { getDiscoveryApiKey, mapPiThinkingToReasoningEffort } from "./model-discovery.js";
import { handleDroidAskUserRequest } from "./droid-ask-user.js";
import { handleDroidPermissionRequest, resolveDroidAutonomyLevel } from "./droid-permissions.js";
import {
	getRegisteredDroidPiToolBridge,
	type DroidPiBridgeToolRequest,
	type DroidPiToolBridgeRun,
} from "./droid-pi-tool-bridge.js";
import { getDroidSessionCwd } from "./droid-session-cwd.js";
import { recordDroidTurnUsage } from "./droid-usage.js";

const MISSING_API_KEY_MESSAGE =
	"Factory API key required. Use /login (Use an API key -> Factory), set FACTORY_API_KEY, or pass --api-key.";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

class DroidAbortError extends Error {
	constructor() {
		super("Droid stream aborted");
		this.name = "DroidAbortError";
	}
}

type DroidStreamMessage = Awaited<ReturnType<DroidSession["stream"]>> extends AsyncGenerator<infer T> ? T : never;

interface DroidLiveRun {
	id: string;
	session: DroidSession;
	bridgeRun?: DroidPiToolBridgeRun;
	iterator?: AsyncIterator<DroidStreamMessage>;
	done: boolean;
	disposed: boolean;
	waitingForBridge: boolean;
	finalText?: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheCreationTokens?: number;
	};
	waiters: Set<() => void>;
}

const pendingLiveRuns = new Map<string, DroidLiveRun>();
let liveRunCounter = 0;

function makeInitialMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { ...ZERO_COST },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function resolveFactoryApiKey(optionsApiKey?: string): string | undefined {
	const trimmed = optionsApiKey?.trim();
	if (trimmed && trimmed !== "FACTORY_API_KEY") return trimmed;
	if (trimmed === "FACTORY_API_KEY") return process.env.FACTORY_API_KEY?.trim() || undefined;
	return undefined;
}

function getPendingLiveRun(context: TranscriptContext): DroidLiveRun | undefined {
	for (let index = context.messages.length - 1; index >= 0; index -= 1) {
		const message = context.messages[index];
		if (message.role !== "toolResult") break;
		for (const run of pendingLiveRuns.values()) {
			if (run.bridgeRun?.hasPendingPiToolCallId(message.toolCallId)) return run;
		}
	}
	return undefined;
}

function notifyRun(run: DroidLiveRun): void {
	for (const waiter of run.waiters) waiter();
	run.waiters.clear();
}

function applyUsage(
	partial: AssistantMessage,
	model: Model<Api>,
	promptInputTokens: number,
	usage?: DroidLiveRun["usage"],
): void {
	const input = usage?.inputTokens ?? promptInputTokens;
	const output = usage?.outputTokens ?? 0;
	partial.usage = {
		input,
		output,
		cacheRead: usage?.cacheReadTokens ?? 0,
		cacheWrite: usage?.cacheCreationTokens ?? 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	partial.model = model.id;
	partial.provider = model.provider;
	partial.api = model.api;
}

async function disposeLiveRun(run: DroidLiveRun): Promise<void> {
	if (run.disposed) return;
	run.disposed = true;
	pendingLiveRuns.delete(run.id);
	run.bridgeRun?.cancel("Droid live run disposed");
	try {
		await run.bridgeRun?.dispose();
	} catch {
		// ignore
	}
	try {
		await run.session.close();
	} catch {
		// ignore
	}
	notifyRun(run);
}

function toToolCallArguments(args: Record<string, unknown>): JsonObject | undefined {
	try {
		const parsed: unknown = JSON.parse(JSON.stringify(args));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as JsonObject;
	} catch {
		return undefined;
	}
}

function emitBridgeToolUseTurn(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	model: Model<Api>,
	promptInputTokens: number,
	run: DroidLiveRun,
	requests: DroidPiBridgeToolRequest[],
): void {
	for (const request of requests) {
		const contentIndex = partial.content.length;
		const args = toToolCallArguments(request.args);
		partial.content.push({
			type: "toolCall",
			id: request.piToolCallId,
			name: request.piToolName,
			arguments: args ?? {},
			...(args ? {} : { argumentsError: "Droid bridge tool arguments were not a JSON object" }),
		});
		stream.push({ type: "toolcall_start", contentIndex, partial });
		stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(args ?? {}), partial });
		const block = partial.content[contentIndex];
		if (block.type === "toolCall") {
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial });
		}
	}
	run.waitingForBridge = true;
	applyUsage(partial, model, promptInputTokens, run.usage);
	partial.stopReason = "toolUse";
	stream.push({ type: "done", reason: "toolUse", message: partial });
}

interface TurnEmitState {
	thinkingContentIndex: number;
	textContentIndex: number;
}

function createTurnEmitState(): TurnEmitState {
	return { thinkingContentIndex: -1, textContentIndex: -1 };
}

function processStreamEvent(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	model: Model<Api>,
	run: DroidLiveRun,
	state: TurnEmitState,
	msg: DroidStreamMessage,
): "continue" | "done" | "error" {
	if (msg.type === DroidMessageType.ThinkingTextDelta) {
		if (state.textContentIndex >= 0) {
			const block = partial.content[state.textContentIndex];
			if (block.type === "text") {
				stream.push({ type: "text_end", contentIndex: state.textContentIndex, content: block.text, partial });
			}
			state.textContentIndex = -1;
		}
		if (state.thinkingContentIndex < 0) {
			state.thinkingContentIndex = partial.content.length;
			partial.content.push({ type: "thinking", thinking: "" });
			stream.push({ type: "thinking_start", contentIndex: state.thinkingContentIndex, partial });
		}
		const block = partial.content[state.thinkingContentIndex];
		if (block.type === "thinking") {
			block.thinking += msg.text;
			stream.push({ type: "thinking_delta", contentIndex: state.thinkingContentIndex, delta: msg.text, partial });
		}
		return "continue";
	}

	if (msg.type === DroidMessageType.AssistantTextDelta) {
		if (state.thinkingContentIndex >= 0) {
			const block = partial.content[state.thinkingContentIndex];
			if (block.type === "thinking") {
				stream.push({ type: "thinking_end", contentIndex: state.thinkingContentIndex, content: block.thinking, partial });
			}
			state.thinkingContentIndex = -1;
		}
		if (state.textContentIndex < 0) {
			state.textContentIndex = partial.content.length;
			partial.content.push({ type: "text", text: "" });
			stream.push({ type: "text_start", contentIndex: state.textContentIndex, partial });
		}
		const block = partial.content[state.textContentIndex];
		if (block.type === "text") {
			block.text += msg.text;
			run.finalText = block.text;
			stream.push({ type: "text_delta", contentIndex: state.textContentIndex, delta: msg.text, partial });
		}
		return "continue";
	}

	if (msg.type === DroidMessageType.TokenUsageUpdate) {
		run.usage = {
			inputTokens: msg.inputTokens,
			outputTokens: msg.outputTokens,
			cacheReadTokens: msg.cacheReadTokens,
			cacheCreationTokens: msg.cacheCreationTokens,
		};
		return "continue";
	}

	if (msg.type === DroidMessageType.TurnComplete) {
		run.done = true;
		if (msg.tokenUsage) {
			run.usage = {
				inputTokens: msg.tokenUsage.inputTokens,
				outputTokens: msg.tokenUsage.outputTokens,
				cacheReadTokens: msg.tokenUsage.cacheReadTokens,
				cacheCreationTokens: msg.tokenUsage.cacheCreationTokens,
			};
			// Only completed turns are recorded: an interrupted turn has no authoritative total.
			recordDroidTurnUsage({ modelId: model.id, ...msg.tokenUsage });
		}
		return "done";
	}

	if (msg.type === DroidMessageType.Error) {
		throw new Error(msg.message);
	}

	return "continue";
}

async function emitProviderStreamEvent(
	message: DroidStreamMessage,
	model: Model<Api>,
	options?: SimpleStreamOptions,
): Promise<void> {
	const handler = options?.onProviderStreamEvent;
	if (!handler) return;
	try {
		await handler(message, model);
	} catch {
		// pi documents these observation hooks as non-blocking: a failing debug handler must
		// not break the provider stream, and the extension has no error channel to report to.
	}
}

async function pumpLiveRun(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	model: Model<Api>,
	context: TranscriptContext,
	run: DroidLiveRun,
	promptInputTokens: number,
	options?: SimpleStreamOptions,
): Promise<"toolUse" | "stop" | "pending"> {
	if (!run.iterator) return "stop";
	const state = createTurnEmitState();

	while (true) {
		if (options?.signal?.aborted) throw new DroidAbortError();
		const next = await run.iterator.next();
		if (next.done) break;

		await emitProviderStreamEvent(next.value, model, options);
		const status = processStreamEvent(stream, partial, model, run, state, next.value);
		if (status === "done") {
			if (state.thinkingContentIndex >= 0) {
				const block = partial.content[state.thinkingContentIndex];
				if (block.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: state.thinkingContentIndex, content: block.thinking, partial });
				}
			}
			if (state.textContentIndex >= 0) {
				const block = partial.content[state.textContentIndex];
				if (block.type === "text") {
					stream.push({ type: "text_end", contentIndex: state.textContentIndex, content: block.text, partial });
				}
			}
			applyUsage(partial, model, promptInputTokens, run.usage);
			partial.stopReason = "stop";
			stream.push({ type: "done", reason: "stop", message: partial });
			await disposeLiveRun(run);
			return "stop";
		}

		const bridgeRequests = run.bridgeRun?.takeQueuedToolRequests() ?? [];
		if (bridgeRequests.length > 0) {
			emitBridgeToolUseTurn(stream, partial, model, promptInputTokens, run, bridgeRequests);
			return "toolUse";
		}
	}

	if (run.done) {
		applyUsage(partial, model, promptInputTokens, run.usage);
		partial.stopReason = "stop";
		stream.push({ type: "done", reason: "stop", message: partial });
		await disposeLiveRun(run);
		return "stop";
	}

	void context;
	return "pending";
}

async function resumePendingLiveRun(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): Promise<boolean> {
	const run = getPendingLiveRun(context);
	if (!run || run.disposed) return false;

	const toolResults = context.messages.filter((message): message is ToolResultMessage => {
		return message.role === "toolResult" && (run.bridgeRun?.hasPendingPiToolCallId(message.toolCallId) ?? false);
	});
	run.bridgeRun?.resolveToolResults(toolResults);
	run.waitingForBridge = false;

	const promptInputTokens = estimateDroidPromptInputTokens(buildDroidPrompt(context));
	await pumpLiveRun(stream, partial, model, context, run, promptInputTokens, options);
	return true;
}

function toDroidImages(images: Array<{ data: string; mimeType: string }>) {
	const allowed = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
	return images
		.filter((image) => allowed.has(image.mimeType))
		.map((image) => ({
			type: "base64" as const,
			mediaType: image.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
			data: image.data,
		}));
}

export function streamDroid(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	// The Droid SDK owns its own process and transport, so there is no HTTP request payload or
	// response object for options.onPayload / options.onResponse to observe. Provider stream
	// events are forwarded through options.onProviderStreamEvent instead.
	const stream = createAssistantMessageEventStream();

	(async () => {
		const partial = makeInitialMessage(model);
		let bridgeRun: DroidPiToolBridgeRun | undefined;
		let liveRun: DroidLiveRun | undefined;

		try {
			const throwIfAborted = (): void => {
				if (options?.signal?.aborted) throw new DroidAbortError();
			};

			stream.push({ type: "start", partial });
			throwIfAborted();

			if (await resumePendingLiveRun(stream, partial, model, context, options)) {
				stream.end();
				return;
			}

			const cliApiKey = resolveFactoryApiKey(options?.apiKey);
			const apiKey = cliApiKey ?? await getDiscoveryApiKey();
			if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE);

			const cwd = getDroidSessionCwd();
			const reasoningEffort = mapPiThinkingToReasoningEffort(model.id, options?.reasoning ?? "off");
			const prompt = buildDroidPrompt(context);
			const promptInputTokens = estimateDroidPromptInputTokens(prompt);

			const registeredBridge = getRegisteredDroidPiToolBridge();
			let activeLiveRun: DroidLiveRun | undefined;
			bridgeRun = registeredBridge
				? await registeredBridge.createRun({
						onToolRequest: () => {
							if (activeLiveRun) notifyRun(activeLiveRun);
						},
					})
				: undefined;

			const session = await createSession({
				modelId: model.id,
				cwd,
				reasoningEffort,
				autonomyLevel: resolveDroidAutonomyLevel(),
				mcpServers: bridgeRun?.enabled ? bridgeRun.mcpServers : undefined,
				env: { ...process.env, FACTORY_API_KEY: apiKey },
				permissionHandler: handleDroidPermissionRequest,
				askUserHandler: handleDroidAskUserRequest,
				abortSignal: options?.signal,
			});

			liveRunCounter += 1;
			liveRun = {
				id: `droid-live-${Date.now()}-${liveRunCounter}`,
				session,
				bridgeRun,
				done: false,
				disposed: false,
				waitingForBridge: false,
				waiters: new Set(),
			};
			activeLiveRun = liveRun;
			pendingLiveRuns.set(liveRun.id, liveRun);

			const images = toDroidImages(prompt.images);
			const generator = session.stream(prompt.text, {
				images: images.length > 0 ? images : undefined,
				abortSignal: options?.signal,
			});
			liveRun.iterator = generator[Symbol.asyncIterator]();

			await pumpLiveRun(stream, partial, model, context, liveRun, promptInputTokens, options);
		} catch (error) {
			if (liveRun) await disposeLiveRun(liveRun);
			else await bridgeRun?.dispose();

			const message = error instanceof Error ? error.message : String(error);
			if (error instanceof DroidAbortError) {
				partial.stopReason = "aborted";
				partial.errorMessage = message;
				stream.push({ type: "error", reason: "aborted", error: partial });
			} else {
				partial.stopReason = "error";
				partial.errorMessage = message;
				stream.push({ type: "error", reason: "error", error: partial });
			}
		} finally {
			stream.end();
		}
	})();

	return stream;
}

export const __testUtils = {
	pendingLiveRuns,
	disposeLiveRun,
	resolveFactoryApiKey,
};
