import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	computeCacheHitRate,
	countTotalTokens,
	DROID_USAGE_WIDGET_KEY,
	formatCacheHitRate,
	formatDroidUsageLimitLines,
	formatDroidUsageReport,
	getDroidUsageSnapshot,
	recordDroidTurnUsage,
	registerDroidUsageCommand,
	resetDroidUsage,
	type DroidTurnUsage,
} from "../src/droid-usage.js";
import type { DroidUsageLimitsResult } from "../src/droid-usage-limits.js";

const NO_LIMITS: DroidUsageLimitsResult = { ok: false, reason: "missing-api-key", message: "no Factory API key configured" };

function limitsResult(overrides: {
	fiveHour?: { usedPercent: number; windowEnd: string | null; secondsRemaining: number | null };
	weekly?: { usedPercent: number; windowEnd: string | null; secondsRemaining: number | null };
	monthly?: { usedPercent: number; windowEnd: string | null; secondsRemaining: number | null };
	core?: boolean;
} = {}): DroidUsageLimitsResult {
	const empty = { usedPercent: 0, windowEnd: null, secondsRemaining: null };
	const standard = {
		fiveHour: overrides.fiveHour ?? empty,
		weekly: overrides.weekly ?? empty,
		monthly: overrides.monthly ?? empty,
	};
	return {
		ok: true,
		limits: {
			standard,
			...(overrides.core ? { core: { fiveHour: empty, weekly: empty, monthly: { ...empty, usedPercent: 12 } } } : {}),
		},
	};
}

function turnUsage(overrides: Partial<DroidTurnUsage> = {}): DroidTurnUsage {
	return {
		modelId: "claude-sonnet-4-5",
		inputTokens: 100,
		outputTokens: 20,
		cacheReadTokens: 5,
		cacheCreationTokens: 2,
		thinkingTokens: 1,
		...overrides,
	};
}

type CommandHandler = (args: string, ctx: { hasUI: boolean; ui: { notify: (message: string, type?: string) => void; setWidget: (key: string, lines: string[] | undefined) => void } }) => Promise<void>;

function registerUsageExtension(limits: DroidUsageLimitsResult = NO_LIMITS): {
	handler: CommandHandler;
	setWidget: ReturnType<typeof vi.fn>;
	sessionStart: () => void;
} {
	let handler: CommandHandler | undefined;
	let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
	const setWidget = vi.fn();
	registerDroidUsageCommand(
		{
			registerCommand: (name, options) => {
				expect(name).toBe("droid-usage");
				expect(options.description).toContain("Droid");
				handler = options.handler as unknown as CommandHandler;
			},
			on: (event, registered) => {
				expect(event).toBe("session_start");
				sessionStart = registered as unknown as (event: unknown, ctx: unknown) => void;
			},
		} as never,
		{ fetchLimits: async () => limits },
	);
	if (!handler || !sessionStart) throw new Error("droid-usage extension was not registered");
	return {
		handler,
		setWidget,
		sessionStart: () => sessionStart?.(undefined, { hasUI: true, ui: { setWidget } }),
	};
}

function captureCommandHandler(limits: DroidUsageLimitsResult = NO_LIMITS): CommandHandler {
	return registerUsageExtension(limits).handler;
}

describe("droid usage tracking", () => {
	beforeEach(() => {
		resetDroidUsage();
	});

	it("starts empty", () => {
		const snapshot = getDroidUsageSnapshot();
		expect(snapshot.models).toEqual([]);
		expect(snapshot.total.turns).toBe(0);
		expect(formatDroidUsageReport(snapshot)).toEqual([
			"Factory Droid usage: no completed Droid turns in this pi session yet.",
		]);
	});

	it("accumulates per model and in total", () => {
		recordDroidTurnUsage(turnUsage(), 1_000);
		recordDroidTurnUsage(turnUsage({ inputTokens: 50, outputTokens: 10 }), 2_000);
		recordDroidTurnUsage(turnUsage({ modelId: "gpt-5.5", inputTokens: 7 }), 3_000);

		const snapshot = getDroidUsageSnapshot();
		expect(snapshot.since).toBe(1_000);
		expect(snapshot.lastTurnAt).toBe(3_000);
		expect(snapshot.lastModelId).toBe("gpt-5.5");
		expect(snapshot.total).toEqual({
			turns: 3,
			inputTokens: 157,
			outputTokens: 50,
			cacheReadTokens: 15,
			cacheCreationTokens: 6,
			thinkingTokens: 3,
		});
		expect(snapshot.models.map((model) => model.modelId)).toEqual(["claude-sonnet-4-5", "gpt-5.5"]);
	});

	it("orders models by turn count then name", () => {
		recordDroidTurnUsage(turnUsage({ modelId: "zeta" }), 1);
		recordDroidTurnUsage(turnUsage({ modelId: "alpha" }), 2);
		recordDroidTurnUsage(turnUsage({ modelId: "alpha" }), 3);
		expect(getDroidUsageSnapshot().models.map((model) => model.modelId)).toEqual(["alpha", "zeta"]);
	});

	it("renders a report with totals and the last turn", () => {
		recordDroidTurnUsage(turnUsage({ inputTokens: 1234, outputTokens: 56 }), new Date(2026, 9, 28, 9, 5).getTime());
		const lines = formatDroidUsageReport(getDroidUsageSnapshot());
		expect(lines[0]).toContain("1 turn");
		expect(lines).toContainEqual(expect.stringContaining("claude-sonnet-4-5"));
		expect(lines).toContainEqual(expect.stringContaining("1,234"));
		expect(lines).toContainEqual(expect.stringContaining("total tokens: 1,297 · cache hit 0.4%"));
		expect(lines.at(-1)).toContain("last turn: claude-sonnet-4-5 at 09:05");
	});

	it("counts total tokens across every billed counter", () => {
		expect(countTotalTokens({ inputTokens: 157, outputTokens: 50, cacheReadTokens: 15, cacheCreationTokens: 6, thinkingTokens: 3 })).toBe(228);
	});

	it("computes the cache hit rate over the whole prompt", () => {
		expect(computeCacheHitRate({ inputTokens: 157, outputTokens: 50, cacheReadTokens: 15, cacheCreationTokens: 6, thinkingTokens: 3 })).toBeCloseTo(15 / 178);
		expect(formatCacheHitRate({ inputTokens: 157, outputTokens: 50, cacheReadTokens: 15, cacheCreationTokens: 6, thinkingTokens: 3 })).toBe("8.4%");
		expect(computeCacheHitRate({ inputTokens: 0, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 })).toBeNull();
		expect(formatCacheHitRate({ inputTokens: 0, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 })).toBe("n/a");
	});

	it("renders each usage pool with its reset time", () => {
		const lines = formatDroidUsageLimitLines(
			limitsResult({
				fiveHour: { usedPercent: 4, windowEnd: "2026-10-28T15:22:00.000Z", secondsRemaining: 12120 },
				monthly: { usedPercent: 58, windowEnd: "2026-11-05T13:16:01.573Z", secondsRemaining: 684421 },
				core: true,
			}),
			Date.parse("2026-10-28T12:00:00.000Z"),
		);

		expect(lines[0]).toBe("Factory limits");
		expect(lines).toContainEqual(expect.stringContaining("standard 5h"));
		expect(lines).toContainEqual(expect.stringMatching(/standard 5h\s+4\.0% used · resets in 3h 22m/));
		expect(lines).toContainEqual(expect.stringContaining("standard 7d"));
		expect(lines).toContainEqual(expect.stringMatching(/standard 7d\s+0\.0% used · no active window/));
		expect(lines).toContainEqual(expect.stringMatching(/standard 1m\s+58\.0% used · resets on Nov 5 \(in 7d 22h\)/));
		expect(lines).toContainEqual(expect.stringMatching(/core 1m\s+12\.0% used/));
	});

	it("skips pools with no active window and reports unavailable limits", () => {
		expect(formatDroidUsageLimitLines(limitsResult())).toEqual([
			"Factory limits: no active quota window for this plan",
		]);
		expect(formatDroidUsageLimitLines(NO_LIMITS)).toEqual([
			"Factory limits: unavailable (no Factory API key configured)",
		]);
	});

	it("appends the plan limits to the report", () => {
		recordDroidTurnUsage(turnUsage(), new Date(2026, 9, 28, 9, 5).getTime());
		const lines = formatDroidUsageReport(
			getDroidUsageSnapshot(),
			limitsResult({ fiveHour: { usedPercent: 4, windowEnd: null, secondsRemaining: 12120 } }),
		);
		expect(lines).toContainEqual(expect.stringContaining("total tokens:"));
		expect(lines).toContainEqual(expect.stringContaining("Factory limits"));
		expect(lines).toContainEqual(expect.stringMatching(/standard 5h\s+4\.0% used · resets in 3h 22m/));
	});

	it("resets every counter", () => {
		recordDroidTurnUsage(turnUsage(), 1_000);
		resetDroidUsage();
		const snapshot = getDroidUsageSnapshot();
		expect(snapshot.since).toBeNull();
		expect(snapshot.total.turns).toBe(0);
		expect(snapshot.models).toEqual([]);
	});
});

describe("/droid-usage command", () => {
	beforeEach(() => {
		resetDroidUsage();
	});

	it("renders the report into the widget and notifies a summary", async () => {
		const handler = captureCommandHandler();
		const setWidget = vi.fn();
		const notify = vi.fn();
		recordDroidTurnUsage(turnUsage());

		await handler("", { hasUI: true, ui: { notify, setWidget } });

		expect(setWidget).toHaveBeenCalledWith(
			DROID_USAGE_WIDGET_KEY,
			expect.arrayContaining([expect.stringContaining("claude-sonnet-4-5")]),
		);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("over 1 turn"), "info");
	});

	it("summarizes total tokens, cache hit rate, and plan limits", async () => {
		const handler = captureCommandHandler(
			limitsResult({ fiveHour: { usedPercent: 4, windowEnd: null, secondsRemaining: 12120 } }),
		);
		const setWidget = vi.fn();
		const notify = vi.fn();
		recordDroidTurnUsage(turnUsage());

		await handler("", { hasUI: true, ui: { notify, setWidget } });

		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("127 tokens · cache hit 4.7% · over 1 turn · 5h 4.0%"),
			"info",
		);
	});

	it("shows plan limits even before any turn completed", async () => {
		const handler = captureCommandHandler(
			limitsResult({ monthly: { usedPercent: 58, windowEnd: "2026-11-05T13:16:01.573Z", secondsRemaining: 684421 } }),
		);
		const setWidget = vi.fn();
		const notify = vi.fn();

		await handler("", { hasUI: true, ui: { notify, setWidget } });

		expect(setWidget).toHaveBeenCalledWith(
			DROID_USAGE_WIDGET_KEY,
			expect.arrayContaining([expect.stringContaining("Factory limits"), expect.stringContaining("standard 1m")]),
		);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("over 0 turns"), "info");
	});

	it("reports a quota lookup failure without dropping the token report", async () => {
		const handler = captureCommandHandler({ ok: false, reason: "http-error", message: "HTTP 401" });
		const setWidget = vi.fn();
		const notify = vi.fn();
		recordDroidTurnUsage(turnUsage());

		await handler("", { hasUI: true, ui: { notify, setWidget } });

		expect(getDroidUsageSnapshot().total.turns).toBe(1);
		expect(setWidget).toHaveBeenCalledWith(
			DROID_USAGE_WIDGET_KEY,
			expect.arrayContaining([expect.stringContaining("Factory limits: unavailable (HTTP 401)")]),
		);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("over 1 turn"), "info");
	});

	it("notifies the empty state instead of opening a widget", async () => {
		const handler = captureCommandHandler();
		const setWidget = vi.fn();
		const notify = vi.fn();

		await handler("", { hasUI: true, ui: { notify, setWidget } });

		expect(setWidget).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith("Factory Droid usage: no completed Droid turns in this pi session yet.", "info");
	});

	it("does not touch widgets when the UI is unavailable", async () => {
		const handler = captureCommandHandler();
		const setWidget = vi.fn();
		const notify = vi.fn();
		recordDroidTurnUsage(turnUsage());

		await handler("", { hasUI: false, ui: { notify, setWidget } });

		expect(setWidget).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalled();
	});

	it("resets counters and clears the widget on session start", () => {
		const extension = registerUsageExtension();
		recordDroidTurnUsage(turnUsage(), 1_000);

		extension.sessionStart();

		expect(getDroidUsageSnapshot().total.turns).toBe(0);
		expect(extension.setWidget).toHaveBeenCalledWith(DROID_USAGE_WIDGET_KEY, undefined);
	});
});
