import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	DROID_USAGE_WIDGET_KEY,
	formatDroidUsageReport,
	getDroidUsageSnapshot,
	recordDroidTurnUsage,
	registerDroidUsageCommand,
	resetDroidUsage,
	type DroidTurnUsage,
} from "../src/droid-usage.js";

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

function registerUsageExtension(): {
	handler: CommandHandler;
	setWidget: ReturnType<typeof vi.fn>;
	sessionStart: () => void;
} {
	let handler: CommandHandler | undefined;
	let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
	const setWidget = vi.fn();
	registerDroidUsageCommand({
		registerCommand: (name, options) => {
			expect(name).toBe("droid-usage");
			expect(options.description).toContain("Droid");
			handler = options.handler as unknown as CommandHandler;
		},
		on: (event, registered) => {
			expect(event).toBe("session_start");
			sessionStart = registered as unknown as (event: unknown, ctx: unknown) => void;
		},
	} as never);
	if (!handler || !sessionStart) throw new Error("droid-usage extension was not registered");
	return {
		handler,
		setWidget,
		sessionStart: () => sessionStart?.(undefined, { hasUI: true, ui: { setWidget } }),
	};
}

function captureCommandHandler(): CommandHandler {
	return registerUsageExtension().handler;
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
		expect(lines.at(-1)).toContain("last turn: claude-sonnet-4-5 at 09:05");
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
