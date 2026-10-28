import { randomUUID } from "node:crypto";
import {
	createSdkMcpServer,
	tool,
	type DroidMcpServerConfig,
	type SdkMcpServer,
} from "@factory/droid-sdk";
import type { Context, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionHandler,
	SessionShutdownEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolInfo,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { buildDroidPiBridgeMcpToolDescription, DROID_PI_BRIDGE_MCP_TOOL_PREFIX } from "./droid-bridge-contract.js";

const DROID_PI_TOOL_BRIDGE_ENV = "PI_DROID_PI_TOOL_BRIDGE";
const DROID_PI_TOOL_BRIDGE_BUILTINS_ENV = "PI_DROID_EXPOSE_BUILTIN_TOOLS";
const DISABLED_ENV_VALUES = new Set(["0", "false", "off", "none", "no", "disabled"]);
const ENABLED_ENV_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const OVERLAPPING_DROID_NATIVE_PI_BUILTIN_TOOL_NAMES = new Set(["read", "bash", "write", "edit", "grep", "find", "ls"]);

export interface DroidPiBridgeToolRequest {
	runId: string;
	bridgeCallId: string;
	piToolCallId: string;
	piToolName: string;
	mcpToolName: string;
	args: Record<string, unknown>;
}

export interface DroidPiToolBridgeRun {
	id: string;
	enabled: boolean;
	mcpServers: DroidMcpServerConfig[];
	sdkServer: SdkMcpServer;
	takeQueuedToolRequests(): DroidPiBridgeToolRequest[];
	resolveToolResults(toolResults: readonly ToolResultMessage[]): void;
	resolveToolResultsFromContext(context: Context): void;
	hasPendingPiToolCallId(piToolCallId: string): boolean;
	cancel(reason: string): void;
	dispose(): Promise<void>;
}

export interface DroidPiToolBridgeRunOptions {
	onToolRequest?: (request: DroidPiBridgeToolRequest) => void;
}

export interface DroidPiToolBridge {
	isEnabled(): boolean;
	createRun(options?: DroidPiToolBridgeRunOptions): Promise<DroidPiToolBridgeRun>;
	disposeAll(reason?: string): Promise<void>;
}

type DroidPiToolBridgeSnapshotApi = Pick<ExtensionAPI, "getActiveTools" | "getAllTools">;

interface DroidPiToolBridgeExtensionApi extends DroidPiToolBridgeSnapshotApi {
	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent>): void;
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
}

interface PendingBridgeCall {
	request: DroidPiBridgeToolRequest;
	resolve: (result: string) => void;
	reject: (error: Error) => void;
	settled: boolean;
}

function resolveEnvFlag(value: string | undefined, defaultEnabled: boolean): boolean {
	if (!value) return defaultEnabled;
	const normalized = value.trim().toLowerCase();
	if (DISABLED_ENV_VALUES.has(normalized)) return false;
	if (ENABLED_ENV_VALUES.has(normalized)) return true;
	return defaultEnabled;
}

export function resolveDroidPiToolBridgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return resolveEnvFlag(env[DROID_PI_TOOL_BRIDGE_ENV], true);
}

function resolveExposeOverlappingBuiltins(env: Record<string, string | undefined> = process.env): boolean {
	return resolveEnvFlag(env[DROID_PI_TOOL_BRIDGE_BUILTINS_ENV], false);
}

function toMcpToolName(piToolName: string): string {
	return `${DROID_PI_BRIDGE_MCP_TOOL_PREFIX}${piToolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
	const properties = schema.properties;
	if (!properties || typeof properties !== "object") return {};
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
		shape[key] = z.any().describe(typeof value === "object" && value && "description" in value ? String((value as { description?: string }).description ?? key) : key);
	}
	return shape;
}

function toolResultToText(toolResult: ToolResultMessage): string {
	return typeof toolResult.content === "string"
		? toolResult.content
		: toolResult.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
}

function toolResultEventToMessage(event: ToolResultEvent): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		content: event.content,
		isError: event.isError,
		timestamp: Date.now(),
	};
}

class DroidPiToolBridgeRunImpl implements DroidPiToolBridgeRun {
	readonly id = randomUUID();
	readonly enabled: boolean;
	readonly sdkServer: SdkMcpServer;
	readonly mcpServers: DroidMcpServerConfig[];
	private readonly onToolRequest?: (request: DroidPiBridgeToolRequest) => void;
	private readonly pendingByPiToolCallId = new Map<string, PendingBridgeCall>();
	private readonly queuedRequests: DroidPiBridgeToolRequest[] = [];
	private readonly mcpToolNameToPiToolName = new Map<string, string>();
	private disposed = false;
	private toolCallCounter = 0;

	constructor(options: {
		enabled: boolean;
		tools: ToolInfo[];
		onToolRequest?: (request: DroidPiBridgeToolRequest) => void;
	}) {
		this.enabled = options.enabled;
		this.onToolRequest = options.onToolRequest;

		const droidTools = options.tools.map((toolInfo) => {
			const mcpToolName = toMcpToolName(toolInfo.name);
			this.mcpToolNameToPiToolName.set(mcpToolName, toolInfo.name);
			const inputSchema = jsonSchemaToZodShape(toolInfo.parameters as Record<string, unknown>);
			return tool(
				mcpToolName,
				buildDroidPiBridgeMcpToolDescription({
					piToolName: toolInfo.name,
					mcpToolName,
					piToolDescription: toolInfo.description,
				}),
				inputSchema,
				(input) => this.enqueueToolRequest(mcpToolName, toolInfo.name, input),
			);
		});

		this.sdkServer = createSdkMcpServer({ name: "pi_tools", tools: droidTools });
		this.mcpServers = [this.sdkServer];
	}

	takeQueuedToolRequests(): DroidPiBridgeToolRequest[] {
		const requests = [...this.queuedRequests];
		this.queuedRequests.length = 0;
		return requests;
	}

	resolveToolResults(toolResults: readonly ToolResultMessage[]): void {
		for (const toolResult of toolResults) {
			const pending = this.pendingByPiToolCallId.get(toolResult.toolCallId);
			if (!pending || pending.settled) continue;
			pending.settled = true;
			this.pendingByPiToolCallId.delete(toolResult.toolCallId);
			pending.resolve(toolResultToText(toolResult));
		}
	}

	resolveToolResultsFromContext(context: Context): void {
		const pendingIds = new Set(this.pendingByPiToolCallId.keys());
		if (pendingIds.size === 0) return;
		const toolResults = context.messages.filter(
			(message): message is ToolResultMessage => message.role === "toolResult" && pendingIds.has(message.toolCallId),
		);
		this.resolveToolResults(toolResults);
	}

	hasPendingPiToolCallId(piToolCallId: string): boolean {
		return this.pendingByPiToolCallId.has(piToolCallId);
	}

	cancel(reason: string): void {
		const error = new Error(reason);
		this.queuedRequests.length = 0;
		for (const pending of [...this.pendingByPiToolCallId.values()]) {
			if (pending.settled) continue;
			pending.settled = true;
			pending.reject(error);
		}
		this.pendingByPiToolCallId.clear();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel("Droid pi tool bridge run disposed");
		await this.sdkServer.close();
	}

	private enqueueToolRequest(mcpToolName: string, piToolName: string, args: Record<string, unknown>): Promise<string> {
		if (this.disposed) return Promise.reject(new Error("Droid pi tool bridge run is disposed"));

		this.toolCallCounter += 1;
		const request: DroidPiBridgeToolRequest = {
			runId: this.id,
			bridgeCallId: `${this.id}-bridge-${this.toolCallCounter}`,
			piToolCallId: `${this.id}-tool-${this.toolCallCounter}`,
			piToolName,
			mcpToolName,
			args,
		};

		return new Promise<string>((resolve, reject) => {
			const pending: PendingBridgeCall = { request, resolve, reject, settled: false };
			this.pendingByPiToolCallId.set(request.piToolCallId, pending);
			if (this.onToolRequest) {
				this.onToolRequest(request);
			} else {
				this.queuedRequests.push(request);
			}
		});
	}
}

class DroidPiToolBridgeRegistry implements DroidPiToolBridge {
	private readonly pi: DroidPiToolBridgeSnapshotApi;
	private readonly env: Record<string, string | undefined>;
	private readonly runs = new Set<DroidPiToolBridgeRunImpl>();

	constructor(pi: DroidPiToolBridgeExtensionApi, env: Record<string, string | undefined> = process.env) {
		this.pi = pi;
		this.env = env;

		pi.on("tool_result", async (event) => {
			const toolResult = toolResultEventToMessage(event);
			for (const run of this.runs) {
				run.resolveToolResults([toolResult]);
			}
		});

		pi.on("session_shutdown", async () => {
			await this.disposeAll("pi session shutdown");
		});
	}

	isEnabled(): boolean {
		return resolveDroidPiToolBridgeEnabled(this.env);
	}

	private buildSnapshot(): ToolInfo[] {
		const active = new Set(this.pi.getActiveTools());
		const exposeBuiltins = resolveExposeOverlappingBuiltins(this.env);
		return this.pi.getAllTools().filter((toolInfo) => {
			if (!active.has(toolInfo.name)) return false;
			if (toolInfo.name.startsWith(DROID_PI_BRIDGE_MCP_TOOL_PREFIX)) return false;
			if (!exposeBuiltins && OVERLAPPING_DROID_NATIVE_PI_BUILTIN_TOOL_NAMES.has(toolInfo.name)) return false;
			return true;
		});
	}

	async createRun(options: DroidPiToolBridgeRunOptions = {}): Promise<DroidPiToolBridgeRun> {
		const enabled = this.isEnabled();
		const tools = enabled ? this.buildSnapshot() : [];
		const run = new DroidPiToolBridgeRunImpl({
			enabled: enabled && tools.length > 0,
			tools,
			onToolRequest: options.onToolRequest,
		});
		this.runs.add(run);
		return run;
	}

	async disposeAll(reason = "dispose all"): Promise<void> {
		await Promise.all(
			[...this.runs].map(async (run) => {
				run.cancel(reason);
				await run.dispose();
			}),
		);
		this.runs.clear();
	}
}

let registeredBridge: DroidPiToolBridge | undefined;

export function getRegisteredDroidPiToolBridge(): DroidPiToolBridge | undefined {
	return registeredBridge;
}

export function registerDroidPiToolBridge(pi: DroidPiToolBridgeExtensionApi): void {
	registeredBridge = new DroidPiToolBridgeRegistry(pi);
}

export const __testUtils = {
	resolveDroidPiToolBridgeEnabled,
	resolveExposeOverlappingBuiltins,
	toMcpToolName,
};
