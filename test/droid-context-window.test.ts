import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	DROID_DEFAULT_CONTEXT_WINDOW,
	getKnownDroidContextWindow,
	resolveDroidContextWindows,
	__testUtils,
} from "../src/droid-context-window.js";

describe("droid context windows", () => {
	beforeEach(() => {
		__testUtils.clearProbedContextWindows();
	});

	it("uses the generated snapshot without probing known models", async () => {
		const probe = vi.fn(async () => 1);
		const resolved = await resolveDroidContextWindows(["claude-sonnet-4-6"], { probe });
		expect(probe).not.toHaveBeenCalled();
		expect(resolved.windows.get("claude-sonnet-4-6")).toBe(931_000);
		expect(resolved.unknownModelIds).toEqual([]);
	});

	it("covers the bundled fallback catalog", async () => {
		const resolved = await resolveDroidContextWindows(["kimi-k2.5", "glm-5.1"], { probe: async () => undefined });
		expect(resolved.windows.get("kimi-k2.5")).toBe(256_000);
		expect(resolved.windows.get("glm-5.1")).toBe(908_928);
		expect(resolved.unknownModelIds).toEqual([]);
	});

	it("probes models missing from the snapshot", async () => {
		const probe = vi.fn(async () => 500_000);
		const resolved = await resolveDroidContextWindows(["brand-new-model"], { probe });
		expect(probe).toHaveBeenCalledWith("brand-new-model");
		expect(resolved.windows.get("brand-new-model")).toBe(500_000);
		expect(resolved.unknownModelIds).toEqual([]);
	});

	it("falls back to the conservative window and reports models it could not probe", async () => {
		const resolved = await resolveDroidContextWindows(["broken-model", "another-model"], {
			probe: async () => undefined,
		});
		expect(resolved.windows.get("broken-model")).toBe(DROID_DEFAULT_CONTEXT_WINDOW);
		expect(resolved.unknownModelIds).toEqual(["another-model", "broken-model"]);
	});

	it("reuses a probe result for later resolutions", async () => {
		const probe = vi.fn(async () => 300_000);
		await resolveDroidContextWindows(["fresh-model"], { probe });
		const resolved = await resolveDroidContextWindows(["fresh-model"], { probe });
		expect(probe).toHaveBeenCalledTimes(1);
		expect(resolved.windows.get("fresh-model")).toBe(300_000);
		expect(getKnownDroidContextWindow("fresh-model")).toBe(300_000);
	});

	it("bounds probing concurrency", async () => {
		let inFlight = 0;
		let peak = 0;
		const modelIds = Array.from({ length: 12 }, (_, index) => `unknown-${index}`);
		await resolveDroidContextWindows(modelIds, {
			probe: async () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 1));
				inFlight -= 1;
				return 100_000;
			},
		});
		expect(peak).toBeGreaterThan(1);
		expect(peak).toBeLessThanOrEqual(4);
	});
});
