import { createSession } from "@factory/droid-sdk";
import { DROID_CONTEXT_WINDOWS } from "./droid-context-windows.generated.js";

// Factory's smallest live model reports 131K, so an unknown model that cannot be probed gets the
// smallest known window rather than an optimistic guess that would overflow the real one.
export const DROID_DEFAULT_CONTEXT_WINDOW = 131_072;

const PROBE_CONCURRENCY = 4;
const probedContextWindows = new Map<string, number>();

function isUsableLimit(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Context window for a model from the generated snapshot or an earlier probe in this process.
 *
 * `availableModels` carries no context length, and the authoritative value (`limit` from
 * `session.getContextStats()`) costs one short session per model, so discovery resolves unknown
 * models by probing and everything else from the snapshot.
 */
export function getKnownDroidContextWindow(modelId: string): number | undefined {
	return DROID_CONTEXT_WINDOWS[modelId] ?? probedContextWindows.get(modelId);
}

async function probeContextWindow(modelId: string, apiKey: string | undefined): Promise<number | undefined> {
	try {
		const session = await createSession({
			modelId,
			cwd: process.cwd(),
			...(apiKey ? { env: { ...process.env, FACTORY_API_KEY: apiKey } } : {}),
		});
		try {
			const { limit } = await session.getContextStats();
			return isUsableLimit(limit) ? limit : undefined;
		} finally {
			await session.close();
		}
	} catch {
		// A failed probe leaves the model on the conservative default; the caller reports it.
		return undefined;
	}
}

export interface ResolvedDroidContextWindows {
	/** Context window per requested model; every requested id has an entry. */
	windows: Map<string, number>;
	/** Models whose window is neither known nor probeable; they hold the conservative default. */
	unknownModelIds: string[];
}

export interface ResolveDroidContextWindowsOptions {
	apiKey?: string;
	probe?: (modelId: string) => Promise<number | undefined>;
}

export async function resolveDroidContextWindows(
	modelIds: string[],
	options: ResolveDroidContextWindowsOptions = {},
): Promise<ResolvedDroidContextWindows> {
	const probe = options.probe ?? ((modelId: string) => probeContextWindow(modelId, options.apiKey));
	const windows = new Map<string, number>();
	const unknownModelIds: string[] = [];
	const pending: string[] = [];

	for (const modelId of modelIds) {
		const known = getKnownDroidContextWindow(modelId);
		if (known !== undefined) windows.set(modelId, known);
		else pending.push(modelId);
	}

	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < pending.length) {
			const modelId = pending[cursor];
			cursor += 1;
			const probed = await probe(modelId);
			if (probed !== undefined) {
				probedContextWindows.set(modelId, probed);
				windows.set(modelId, probed);
			} else {
				windows.set(modelId, DROID_DEFAULT_CONTEXT_WINDOW);
				unknownModelIds.push(modelId);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, () => worker()));
	unknownModelIds.sort((left, right) => left.localeCompare(right));
	return { windows, unknownModelIds };
}

export const __testUtils = {
	clearProbedContextWindows: () => probedContextWindows.clear(),
};
