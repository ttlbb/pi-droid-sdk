import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	discoverModels,
	mapPiThinkingToReasoningEffort,
	getDroidModelMetadata,
	__testUtils,
} from "../src/model-discovery.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@factory/droid-sdk", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@factory/droid-sdk")>();
	return {
		...actual,
		createSession: vi.fn(),
	};
});

import { createSession } from "@factory/droid-sdk";
import { ReasoningEffort } from "@factory/droid-sdk";

const mockedCreateSession = vi.mocked(createSession);

function writeStoredFactoryApiKey(apiKey: string): void {
	writeFileSync(
		join(process.env.PI_CODING_AGENT_DIR!, "auth.json"),
		JSON.stringify({ factory: { type: "api_key", key: apiKey } }, null, 2),
	);
}

describe("discoverModels", () => {
	const originalEnv = process.env;
	let tmpAgentDir: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.FACTORY_API_KEY;
		tmpAgentDir = mkdtempSync(join(tmpdir(), "pi-droid-discovery-"));
		process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
		process.argv = ["node", "vitest"];
		__testUtils.clearMetadata();
	});

	afterEach(() => {
		rmSync(tmpAgentDir, { recursive: true, force: true });
		process.env = originalEnv;
		vi.clearAllMocks();
	});

	it("returns fallback models when no API key", async () => {
		const models = await discoverModels();
		expect(models.some((model) => model.id === "kimi-k2.5")).toBe(true);
		expect(models.some((model) => model.id === "glm-5.1")).toBe(true);
		expect(mockedCreateSession).not.toHaveBeenCalled();
	});

	it("discovers live models when API key is available", async () => {
		writeStoredFactoryApiKey("factory-test-key");
		mockedCreateSession.mockResolvedValue({
			initResult: {
				availableModels: [
					{
						id: "kimi-k2.5",
						displayName: "Droid Core (Kimi K2.5)",
						shortDisplayName: "Kimi K2.5",
						modelProvider: "factory",
						supportedReasoningEfforts: [ReasoningEffort.Off, ReasoningEffort.High],
						defaultReasoningEffort: ReasoningEffort.High,
						isCustom: false,
					},
				],
			},
			close: vi.fn(),
		} as never);

		const models = await discoverModels();
		expect(models).toEqual([
			expect.objectContaining({ id: "kimi-k2.5", name: "Droid Core (Kimi K2.5)" }),
		]);
		expect(mockedCreateSession).toHaveBeenCalled();
	});
});

describe("mapPiThinkingToReasoningEffort", () => {
	beforeEach(async () => {
		await discoverModels();
	});

	it("maps off to ReasoningEffort.Off for core models", () => {
		expect(mapPiThinkingToReasoningEffort("kimi-k2.5", "off")).toBe(ReasoningEffort.Off);
	});

	it("maps high to ReasoningEffort.High for core models", () => {
		expect(mapPiThinkingToReasoningEffort("kimi-k2.5", "high")).toBe(ReasoningEffort.High);
	});

	it("returns metadata for discovered models", () => {
		expect(getDroidModelMetadata("kimi-k2.5")?.displayName).toContain("Kimi");
	});

	it("maps the pi max level to Droid Max", () => {
		const map = getDroidModelMetadata("claude-opus-4-7")?.thinkingLevelMap;
		expect(map?.max).toBe(ReasoningEffort.Max);
		expect(map?.xhigh).toBe(ReasoningEffort.Max);
		expect(mapPiThinkingToReasoningEffort("claude-opus-4-7", "max")).toBe(ReasoningEffort.Max);
	});

	it("reports max as unsupported when the model tops out at ExtraHigh", () => {
		const map = getDroidModelMetadata("gpt-5.5")?.thinkingLevelMap;
		expect(map?.xhigh).toBe(ReasoningEffort.ExtraHigh);
		expect(map?.max).toBeNull();
	});
});
