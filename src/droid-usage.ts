import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DROID_USAGE_WIDGET_KEY = "droid-usage";
const MODEL_COLUMN_WIDTH = 34;

export interface DroidUsageCounts {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	thinkingTokens: number;
}

export interface DroidTurnUsage extends DroidUsageCounts {
	modelId: string;
}

export interface DroidUsageTotals extends DroidUsageCounts {
	turns: number;
}

export interface DroidUsageModelEntry extends DroidUsageTotals {
	modelId: string;
}

export interface DroidUsageSnapshot {
	since: number | null;
	lastTurnAt: number | null;
	lastModelId: string | null;
	models: DroidUsageModelEntry[];
	total: DroidUsageTotals;
}

type DroidUsageExtensionApi = Pick<ExtensionAPI, "registerCommand" | "on">;

type DroidUsageCommandContext = Pick<ExtensionContext, "hasUI"> & {
	ui: Pick<ExtensionContext["ui"], "notify" | "setWidget">;
};

function createTotals(): DroidUsageTotals {
	return {
		turns: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		thinkingTokens: 0,
	};
}

function addUsage(totals: DroidUsageTotals, usage: DroidTurnUsage): void {
	totals.turns += 1;
	totals.inputTokens += usage.inputTokens;
	totals.outputTokens += usage.outputTokens;
	totals.cacheReadTokens += usage.cacheReadTokens;
	totals.cacheCreationTokens += usage.cacheCreationTokens;
	totals.thinkingTokens += usage.thinkingTokens;
}

const state: {
	since: number | null;
	lastTurnAt: number | null;
	lastModelId: string | null;
	byModel: Map<string, DroidUsageTotals>;
	total: DroidUsageTotals;
} = {
	since: null,
	lastTurnAt: null,
	lastModelId: null,
	byModel: new Map(),
	total: createTotals(),
};

/** Drop every counter. Called when a new pi session starts. */
export function resetDroidUsage(): void {
	state.since = null;
	state.lastTurnAt = null;
	state.lastModelId = null;
	state.byModel.clear();
	state.total = createTotals();
}

/** Record one completed Droid turn. Aborted turns never reach this point. */
export function recordDroidTurnUsage(usage: DroidTurnUsage, now: number = Date.now()): void {
	const modelTotals = state.byModel.get(usage.modelId) ?? createTotals();
	addUsage(modelTotals, usage);
	state.byModel.set(usage.modelId, modelTotals);
	addUsage(state.total, usage);

	state.since ??= now;
	state.lastTurnAt = now;
	state.lastModelId = usage.modelId;
}

function cloneTotals(totals: DroidUsageTotals): DroidUsageTotals {
	return { ...totals };
}

/** Point-in-time copy of the counters, largest consumer first. */
export function getDroidUsageSnapshot(): DroidUsageSnapshot {
	const models = [...state.byModel.entries()]
		.map(([modelId, totals]) => ({ modelId, ...cloneTotals(totals) }))
		.sort((left, right) => right.turns - left.turns || left.modelId.localeCompare(right.modelId));
	return {
		since: state.since,
		lastTurnAt: state.lastTurnAt,
		lastModelId: state.lastModelId,
		models,
		total: cloneTotals(state.total),
	};
}

function formatCount(value: number): string {
	return value.toLocaleString("en-US");
}

function formatClock(epochMs: number): string {
	const date = new Date(epochMs);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function truncateModelId(modelId: string): string {
	return modelId.length <= MODEL_COLUMN_WIDTH ? modelId : `${modelId.slice(0, MODEL_COLUMN_WIDTH - 1)}…`;
}

function formatRow(label: string, totals: DroidUsageTotals): string {
	return [
		truncateModelId(label).padEnd(MODEL_COLUMN_WIDTH),
		String(totals.turns).padStart(6),
		formatCount(totals.inputTokens).padStart(10),
		formatCount(totals.outputTokens).padStart(10),
		formatCount(totals.cacheReadTokens).padStart(10),
		formatCount(totals.cacheCreationTokens).padStart(10),
		formatCount(totals.thinkingTokens).padStart(10),
	].join(" ");
}

/** Render the `/droid-usage` report as terminal-ready lines. */
export function formatDroidUsageReport(snapshot: DroidUsageSnapshot): string[] {
	if (snapshot.models.length === 0) {
		return ["Factory Droid usage: no completed Droid turns in this pi session yet."];
	}

	const turnLabel = snapshot.total.turns === 1 ? "turn" : "turns";
	const sinceLabel = snapshot.since === null ? "" : ` since ${formatClock(snapshot.since)}`;
	const header = `Factory Droid usage — ${snapshot.total.turns} ${turnLabel}${sinceLabel}`;
	const columns = [
		"model".padEnd(MODEL_COLUMN_WIDTH),
		"turns".padStart(6),
		"input".padStart(10),
		"output".padStart(10),
		"cache R".padStart(10),
		"cache W".padStart(10),
		"thinking".padStart(10),
	].join(" ");
	const lines = [header, columns];
	for (const model of snapshot.models) lines.push(formatRow(model.modelId, model));
	lines.push(formatRow("total", snapshot.total));

	if (snapshot.lastModelId && snapshot.lastTurnAt !== null) {
		lines.push(`last turn: ${snapshot.lastModelId} at ${formatClock(snapshot.lastTurnAt)}`);
	}
	return lines;
}

/** Register `/droid-usage`; the report renders as a widget in TUI and as a notification otherwise. */
export function registerDroidUsageCommand(pi: DroidUsageExtensionApi): void {
	pi.on("session_start", (_event, ctx) => {
		resetDroidUsage();
		if (ctx.hasUI) ctx.ui.setWidget(DROID_USAGE_WIDGET_KEY, undefined);
	});

	pi.registerCommand("droid-usage", {
		description: "Show Factory Droid token usage accumulated in this pi session",
		handler: async (_args: string, ctx: DroidUsageCommandContext) => {
			const snapshot = getDroidUsageSnapshot();
			const lines = formatDroidUsageReport(snapshot);
			if (snapshot.models.length === 0) {
				ctx.ui.notify(lines[0], "info");
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.setWidget(DROID_USAGE_WIDGET_KEY, lines);
			}
			const turnLabel = snapshot.total.turns === 1 ? "turn" : "turns";
			ctx.ui.notify(
				`Droid usage: ${formatCount(snapshot.total.inputTokens)} in / ${formatCount(snapshot.total.outputTokens)} out over ${formatCount(snapshot.total.turns)} ${turnLabel}`,
				"info",
			);
		},
	});
}
