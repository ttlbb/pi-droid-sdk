import { z } from "zod";
import { getDiscoveryApiKey } from "./model-discovery.js";

/**
 * Factory's own billing-limits endpoint, the same one the Droid CLI reads for its `/usage`
 * screen. It is keyed by the Factory API key, so no Droid CLI process or login state is needed.
 */
export const FACTORY_LIMITS_URL = "https://api.factory.ai/api/billing/limits";
const REQUEST_TIMEOUT_MS = 10_000;

const LimitWindowSchema = z.object({
	usedPercent: z.number(),
	windowEnd: z.string().nullable(),
	secondsRemaining: z.number().nullable(),
});

const LimitPoolSchema = z.object({
	fiveHour: LimitWindowSchema,
	weekly: LimitWindowSchema,
	monthly: LimitWindowSchema,
});

// `core` is optional: plans without Droid Core access omit it, and the report only renders
// pools that actually have an active window.
const BillingLimitsSchema = z.object({
	limits: z.object({
		standard: LimitPoolSchema,
		core: LimitPoolSchema.optional(),
	}),
});

export type DroidLimitWindow = z.infer<typeof LimitWindowSchema>;
export type DroidLimitPool = z.infer<typeof LimitPoolSchema>;
export type DroidLimitWindowKey = keyof DroidLimitPool;

export interface DroidUsageLimits {
	standard: DroidLimitPool;
	core?: DroidLimitPool;
}

export type DroidUsageLimitsFailureReason =
	| "missing-api-key"
	| "http-error"
	| "network-error"
	| "timeout"
	| "invalid-response";

export interface DroidUsageLimitsFailure {
	ok: false;
	reason: DroidUsageLimitsFailureReason;
	/** Human-readable cause; never contains the API key. */
	message: string;
}

export interface DroidUsageLimitsSuccess {
	ok: true;
	limits: DroidUsageLimits;
}

export type DroidUsageLimitsResult = DroidUsageLimitsSuccess | DroidUsageLimitsFailure;

export interface FetchDroidUsageLimitsOptions {
	/** Explicit key; when omitted {@link FetchDroidUsageLimitsOptions.resolveApiKey} runs. */
	apiKey?: string;
	resolveApiKey?: () => Promise<string | undefined>;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function isTimeoutError(error: unknown): boolean {
	if (error instanceof DOMException) return error.name === "TimeoutError" || error.name === "AbortError";
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Fetch the plan's 5-hour, weekly, and monthly consumption from Factory. */
export async function fetchDroidUsageLimits(
	options: FetchDroidUsageLimitsOptions = {},
): Promise<DroidUsageLimitsResult> {
	const apiKey = options.apiKey ?? (await (options.resolveApiKey ?? getDiscoveryApiKey)());
	if (!apiKey) {
		return {
			ok: false,
			reason: "missing-api-key",
			message: "no Factory API key configured",
		};
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
	let response: Response;
	try {
		response = await fetchImpl(FACTORY_LIMITS_URL, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		return {
			ok: false,
			reason: isTimeoutError(error) ? "timeout" : "network-error",
			message: describeError(error),
		};
	}

	if (!response.ok) {
		return { ok: false, reason: "http-error", message: `HTTP ${response.status}` };
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		return {
			ok: false,
			reason: isTimeoutError(error) ? "timeout" : "invalid-response",
			message: isTimeoutError(error) ? describeError(error) : "response body was not JSON",
		};
	}

	const parsed = BillingLimitsSchema.safeParse(payload);
	if (!parsed.success) {
		return {
			ok: false,
			reason: "invalid-response",
			message: "response did not match the Factory billing-limits schema",
		};
	}

	return { ok: true, limits: { standard: parsed.data.limits.standard, core: parsed.data.limits.core } };
}
