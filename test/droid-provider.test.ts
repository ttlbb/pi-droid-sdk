import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeContext, type Api, type AssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { DroidMessageType, createSession } from "@factory/droid-sdk";
import { streamDroid, __testUtils as providerTestUtils } from "../src/droid-provider.js";
import { getDroidUsageSnapshot, resetDroidUsage } from "../src/droid-usage.js";

vi.mock("@factory/droid-sdk", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@factory/droid-sdk")>();
	return { ...actual, createSession: vi.fn() };
});

const mockedCreateSession = vi.mocked(createSession);

const model = {
	id: "kimi-k2.5",
	name: "Droid Core (Kimi K2.5)",
	api: "droid-sdk",
	provider: "factory",
	baseUrl: "https://factory.ai",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: true,
	contextWindow: 200_000,
	maxTokens: 16_384,
} as unknown as Model<Api>;

function fakeSession(messages: unknown[]) {
	return {
		stream: async function* () {
			for (const message of messages) yield message;
		},
		close: vi.fn(async () => {}),
	};
}

function contextFor(text: string) {
	return normalizeContext({ messages: [{ role: "user", content: text, timestamp: Date.now() }] });
}

async function collect(stream: AssistantMessageEventStream) {
	const events: Array<{ type: string }> = [];
	for await (const event of stream) events.push(event as { type: string });
	return events;
}

describe("streamDroid", () => {
	beforeEach(() => {
		resetDroidUsage();
		providerTestUtils.pendingLiveRuns.clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("streams text and records the completed turn usage", async () => {
		mockedCreateSession.mockResolvedValue(
			fakeSession([
				{ type: DroidMessageType.AssistantTextDelta, text: "pong" },
				{
					type: DroidMessageType.TurnComplete,
					tokenUsage: {
						inputTokens: 120,
						outputTokens: 30,
						cacheReadTokens: 40,
						cacheCreationTokens: 10,
						thinkingTokens: 5,
					},
				},
			]) as never,
		);

		const events = await collect(streamDroid(model, contextFor("ping"), { apiKey: "test-key" }));
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(events.at(-1)).toMatchObject({ type: "done", reason: "stop" });

		const snapshot = getDroidUsageSnapshot();
		expect(snapshot.models).toEqual([
			{
				modelId: "kimi-k2.5",
				turns: 1,
				inputTokens: 120,
				outputTokens: 30,
				cacheReadTokens: 40,
				cacheCreationTokens: 10,
				thinkingTokens: 5,
			},
		]);
	});

	it("reports a readable error message when the run fails", async () => {
		mockedCreateSession.mockResolvedValue(
			fakeSession([{ type: DroidMessageType.Error, message: "droid exploded" }]) as never,
		);

		const events = await collect(streamDroid(model, contextFor("ping"), { apiKey: "test-key" }));
		const terminal = events.at(-1) as { type: string; error?: { errorMessage?: string; stopReason?: string } };
		expect(terminal.type).toBe("error");
		expect(terminal.error?.stopReason).toBe("error");
		expect(terminal.error?.errorMessage).toBe("droid exploded");
		expect(getDroidUsageSnapshot().total.turns).toBe(0);
	});

	it("fails fast without a Factory key", async () => {
		const previousKey = process.env.FACTORY_API_KEY;
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		// An empty agent dir keeps a real stored credential out of the provider's key lookup.
		const emptyAgentDir = mkdtempSync(join(tmpdir(), "pi-droid-provider-"));
		delete process.env.FACTORY_API_KEY;
		process.env.PI_CODING_AGENT_DIR = emptyAgentDir;
		try {
			const events = await collect(streamDroid(model, contextFor("ping")));
			const terminal = events.at(-1) as { type: string; error?: { errorMessage?: string } };
			expect(terminal.type).toBe("error");
			expect(terminal.error?.errorMessage).toContain("Factory API key required");
			expect(mockedCreateSession).not.toHaveBeenCalled();
		} finally {
			rmSync(emptyAgentDir, { recursive: true, force: true });
			if (previousKey !== undefined) process.env.FACTORY_API_KEY = previousKey;
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});
});
