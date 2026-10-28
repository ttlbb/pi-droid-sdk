import { describe, it, expect, vi } from "vitest";
import {
	FACTORY_LIMITS_URL,
	fetchDroidUsageLimits,
	type FetchDroidUsageLimitsOptions,
} from "../src/droid-usage-limits.js";

const empty = { usedPercent: 0, windowEnd: null, secondsRemaining: null };
const fullPayload = {
	usesTokenRateLimitsBilling: true,
	limits: {
		standard: {
			fiveHour: { usedPercent: 4, windowEnd: "2026-10-28T18:31:35.820Z", secondsRemaining: 12155 },
			weekly: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
			monthly: { usedPercent: 58, windowEnd: "2026-11-05T13:16:01.573Z", secondsRemaining: 684421 },
		},
		core: { fiveHour: empty, weekly: empty, monthly: empty },
	},
	overagePreference: "droidCore",
	extraUsageAllowed: true,
};

function jsonResponse(payload: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	} as unknown as Response;
}

function fetchOptions(response: () => Promise<Response> | Response, overrides: Partial<FetchDroidUsageLimitsOptions> = {}) {
	const fetchImpl = vi.fn(async () => response());
	return { fetchImpl, options: { apiKey: "test-key", fetchImpl, ...overrides } as FetchDroidUsageLimitsOptions };
}

describe("fetchDroidUsageLimits", () => {
	it("reads the plan windows with the Factory API key", async () => {
		const { fetchImpl, options } = fetchOptions(() => jsonResponse(fullPayload));

		const result = await fetchDroidUsageLimits(options);

		expect(fetchImpl).toHaveBeenCalledWith(
			FACTORY_LIMITS_URL,
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
			}),
		);
		expect(result).toEqual({
			ok: true,
			limits: {
				standard: fullPayload.limits.standard,
				core: fullPayload.limits.core,
			},
		});
	});

	it("accepts a response without a core pool", async () => {
		const { options } = fetchOptions(() =>
			jsonResponse({ limits: { standard: fullPayload.limits.standard } }),
		);

		const result = await fetchDroidUsageLimits(options);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.limits.core).toBeUndefined();
	});

	it("reports a missing API key without calling Factory", async () => {
		const fetchImpl = vi.fn();

		const result = await fetchDroidUsageLimits({ resolveApiKey: async () => undefined, fetchImpl: fetchImpl as never });

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: false, reason: "missing-api-key", message: "no Factory API key configured" });
	});

	it("reports an HTTP failure with its status", async () => {
		const { options } = fetchOptions(() => jsonResponse({ error: "unauthorized" }, 401));

		const result = await fetchDroidUsageLimits(options);

		expect(result).toEqual({ ok: false, reason: "http-error", message: "HTTP 401" });
	});

	it("rejects a body that is not JSON or not the billing shape", async () => {
		const notJson = await fetchDroidUsageLimits(
			fetchOptions(() => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) }) as unknown as Response)
				.options,
		);
		const wrongShape = await fetchDroidUsageLimits(fetchOptions(() => jsonResponse({ limits: { standard: {} } })).options);

		expect(notJson).toEqual({ ok: false, reason: "invalid-response", message: "response body was not JSON" });
		expect(wrongShape).toMatchObject({ ok: false, reason: "invalid-response" });
	});

	it("reports network and timeout failures", async () => {
		const networkFailure = await fetchDroidUsageLimits(
			fetchOptions(() => Promise.reject(new TypeError("fetch failed"))).options,
		);
		const timeout = new Error("The operation was aborted due to timeout");
		timeout.name = "TimeoutError";
		const timeoutFailure = await fetchDroidUsageLimits(fetchOptions(() => Promise.reject(timeout)).options);

		expect(networkFailure).toEqual({ ok: false, reason: "network-error", message: "fetch failed" });
		expect(timeoutFailure).toMatchObject({ ok: false, reason: "timeout" });
	});
});
