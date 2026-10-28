import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	fetchDroidUsageLimits,
	type DroidLimitPool,
	type DroidLimitWindow,
	type DroidLimitWindowKey,
	type DroidUsageLimitsResult,
} from "./droid-usage-limits.js";

export const DROID_USAGE_WIDGET_KEY = "droid-usage";
const MODEL_COLUMN_WIDTH = 34;
const TOTAL_COLUMN_WIDTH = 12;
const LIMIT_LABEL_WIDTH = 16;
const LIMIT_PERCENT_WIDTH = 6;
const LIMIT_WINDOWS: ReadonlyArray<{ key: DroidLimitWindowKey; label: string }> = [
	{ key: "fiveHour", label: "5h" },
	{ key: "weekly", label: "7d" },
	{ key: "monthly", label: "1m" },
];
const LIMIT_POOLS: ReadonlyArray<{ key: "standard" | "core"; label: string }> = [
	{ key: "standard", label: "standard" },
	{ key: "core", label: "core" },
];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/**
 * Total tokens a turn was billed for. Droid reports `inputTokens` without cache reads and
 * cache writes, so all three prompt-side counters add up to the billed input volume.
 */
export function countTotalTokens(totals: DroidUsageCounts): number {
	return totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;
}

/**
 * Share of the prompt that came from the cache, or `null` when no prompt tokens were billed.
 * Matches the ratio the Droid statusline reports: cache reads over uncached + cached input.
 */
export function computeCacheHitRate(totals: DroidUsageCounts): number | null {
	const promptTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;
	return promptTokens === 0 ? null : totals.cacheReadTokens / promptTokens;
}

export function formatCacheHitRate(totals: DroidUsageCounts): string {
	const rate = computeCacheHitRate(totals);
	return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function formatPercentage(usedPercent: number): string {
	return `${usedPercent.toFixed(1)}%`;
}

function formatResetDate(epochMs: number): string {
	const date = new Date(epochMs);
	return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

function formatLimitReset(limit: DroidLimitWindow, now: number): string {
	const endMs = limit.windowEnd === null ? Number.NaN : Date.parse(limit.windowEnd);
	const secondsRemaining = limit.secondsRemaining ?? (Number.isFinite(endMs) ? Math.round((endMs - now) / 1000) : null);
	if (secondsRemaining === null || secondsRemaining <= 0) return "no active window";

	const totalMinutes = Math.floor(secondsRemaining / 60);
	const hours = Math.floor(totalMinutes / 60);
	if (hours === 0) return `resets in ${totalMinutes}m`;
	if (hours < 24) return `resets in ${hours}h ${totalMinutes % 60}m`;
	const days = Math.floor(hours / 24);
	return `resets on ${formatResetDate(endMs)} (in ${days}d ${hours % 24}h)`;
}

/** A pool nobody is drawing from: every window is empty and no window is open. */
function isInactivePool(pool: DroidLimitPool): boolean {
	return LIMIT_WINDOWS.every(({ key }) => pool[key].windowEnd === null && pool[key].usedPercent === 0);
}

/** Render the 5-hour / weekly / monthly plan consumption fetched from Factory. */
export function formatDroidUsageLimitLines(
	result: DroidUsageLimitsResult,
	now: number = Date.now(),
): string[] {
	if (!result.ok) {
		return [`Factory limits: unavailable (${result.message})`];
	}

	const lines: string[] = [];
	for (const { key, label } of LIMIT_POOLS) {
		const pool = result.limits[key];
		if (!pool || isInactivePool(pool)) continue;
		for (const window of LIMIT_WINDOWS) {
			const limit = pool[window.key];
			lines.push(
				[
					`  ${`${label} ${window.label}`.padEnd(LIMIT_LABEL_WIDTH)}`,
					formatPercentage(limit.usedPercent).padStart(LIMIT_PERCENT_WIDTH),
					"used ·",
					formatLimitReset(limit, now),
				].join(" "),
			);
		}
	}

	if (lines.length === 0) return ["Factory limits: no active quota window for this plan"];
	return ["Factory limits", ...lines];
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
		formatCount(countTotalTokens(totals)).padStart(TOTAL_COLUMN_WIDTH),
	].join(" ");
}

/** Render the `/droid-usage` report as terminal-ready lines. */
export function formatDroidUsageReport(
	snapshot: DroidUsageSnapshot,
	limits?: DroidUsageLimitsResult,
): string[] {
	if (snapshot.models.length === 0) {
		const emptyLines = ["Factory Droid usage: no completed Droid turns in this pi session yet."];
		if (limits) emptyLines.push("", ...formatDroidUsageLimitLines(limits));
		return emptyLines;
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
		"total".padStart(TOTAL_COLUMN_WIDTH),
	].join(" ");
	const lines = [header, columns];
	for (const model of snapshot.models) lines.push(formatRow(model.modelId, model));
	lines.push(formatRow("total", snapshot.total));
	lines.push(
		`total tokens: ${formatCount(countTotalTokens(snapshot.total))} · cache hit ${formatCacheHitRate(snapshot.total)}`,
	);

	if (snapshot.lastModelId && snapshot.lastTurnAt !== null) {
		lines.push(`last turn: ${snapshot.lastModelId} at ${formatClock(snapshot.lastTurnAt)}`);
	}
	if (limits) lines.push("", ...formatDroidUsageLimitLines(limits));
	return lines;
}

function formatLimitHighlights(limits: DroidUsageLimitsResult): string | null {
	if (!limits.ok || !limits.limits.standard) return null;
	return LIMIT_WINDOWS.map(
		({ key, label }) => `${label} ${formatPercentage(limits.limits.standard[key].usedPercent)}`,
	).join(" · ");
}

function formatCommandSummary(snapshot: DroidUsageSnapshot, limits: DroidUsageLimitsResult): string {
	const turnLabel = snapshot.total.turns === 1 ? "turn" : "turns";
	const parts = [
		`Droid usage: ${formatCount(snapshot.total.inputTokens)} in / ${formatCount(snapshot.total.outputTokens)} out`,
		`${formatCount(countTotalTokens(snapshot.total))} tokens`,
		`cache hit ${formatCacheHitRate(snapshot.total)}`,
		`over ${formatCount(snapshot.total.turns)} ${turnLabel}`,
	];
	const highlights = formatLimitHighlights(limits);
	if (highlights) parts.push(highlights);
	return parts.join(" · ");
}

export interface DroidUsageCommandDeps {
	/** Injected by tests; production reads the plan quota from Factory. */
	fetchLimits?: () => Promise<DroidUsageLimitsResult>;
}

/** Register `/droid-usage`; the report renders as a widget in TUI and as a notification otherwise. */
export function registerDroidUsageCommand(pi: DroidUsageExtensionApi, deps: DroidUsageCommandDeps = {}): void {
	pi.on("session_start", (_event, ctx) => {
		resetDroidUsage();
		if (ctx.hasUI) ctx.ui.setWidget(DROID_USAGE_WIDGET_KEY, undefined);
	});

	const fetchLimits = deps.fetchLimits ?? fetchDroidUsageLimits;

	pi.registerCommand("droid-usage", {
		description: "Show Factory Droid token usage and plan limits for this pi session",
		handler: async (_args: string, ctx: DroidUsageCommandContext) => {
			const snapshot = getDroidUsageSnapshot();
			const limits = await loadLimits(fetchLimits);
			const lines = formatDroidUsageReport(snapshot, limits);
			if (snapshot.models.length === 0 && !limits.ok) {
				ctx.ui.notify(lines[0], "info");
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.setWidget(DROID_USAGE_WIDGET_KEY, lines);
			}
			ctx.ui.notify(formatCommandSummary(snapshot, limits), "info");
		},
	});
}

/** A quota lookup failure is reported in the widget, never raised into the command handler. */
async function loadLimits(fetchLimits: () => Promise<DroidUsageLimitsResult>): Promise<DroidUsageLimitsResult> {
	try {
		return await fetchLimits();
	} catch (error) {
		return {
			ok: false,
			reason: "network-error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
