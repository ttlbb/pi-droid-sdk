import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Which slice of the live Factory catalog pi exposes in its model picker.
 *
 * Droid always returns the whole catalog from session init and carries no favorite flag in
 * `availableModels`, so the scope is applied here, after discovery, from the ids the Droid TUI
 * stores in `modelFavorites`. It narrows what pi shows; discovery itself still fetches everything.
 */
export type DroidModelScope = "all" | "favorites";

export type DroidModelScopeFallbackReason =
	/** Settings file missing, unreadable, or without a usable `modelFavorites` array. */
	| "favorites-unavailable"
	/** `modelFavorites` is present and empty. */
	| "favorites-empty"
	/** None of the favorites exist in the catalog that was just discovered. */
	| "favorites-not-in-catalog";

export interface DroidModelScopeInfo {
	requestedScope: DroidModelScope;
	/** Scope actually applied; `all` whenever the favorites could not be honored. */
	appliedScope: DroidModelScope;
	catalogCount: number;
	modelCount: number;
	/** Favorites the catalog did not contain, so the filter could not show them. */
	unmatchedFavoriteIds: string[];
	fallbackReason?: DroidModelScopeFallbackReason;
}

export interface DroidModelScopeResult<T> extends DroidModelScopeInfo {
	items: T[];
}

const SCOPE_ENV_VAR = "PI_DROID_MODEL_SCOPE";

export function parseDroidModelScope(value: string | undefined): DroidModelScope | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "favorites" || normalized === "favorite" || normalized === "fav") return "favorites";
	if (normalized === "all" || normalized === "full") return "all";
	return undefined;
}

/** `PI_DROID_MODEL_SCOPE` wins; an unset or unrecognized value means the full catalog. */
export function resolveDroidModelScope(env: NodeJS.ProcessEnv = process.env): DroidModelScope {
	return parseDroidModelScope(env[SCOPE_ENV_VAR]) ?? "all";
}

/** Droid's user-level settings file, the same one its TUI writes favorites into. */
export function getDroidSettingsPath(): string {
	return join(homedir(), ".factory", "settings.json");
}

/**
 * Favorite model ids as the Droid TUI stored them, or `undefined` when the settings file cannot
 * supply them. A missing file, invalid JSON, or a settings file without `modelFavorites` (older
 * Droid versions) all count as unavailable rather than as "no favorites".
 */
export function readDroidFavoriteModelIds(settingsPath: string = getDroidSettingsPath()): string[] | undefined {
	let raw: string;
	try {
		raw = readFileSync(settingsPath, "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const favorites = (parsed as { modelFavorites?: unknown }).modelFavorites;
	if (!Array.isArray(favorites)) return undefined;
	return favorites
		.filter((id): id is string => typeof id === "string" && id.trim() !== "")
		.map((id) => id.trim());
}

export interface ApplyDroidModelScopeOptions<T> {
	/** Catalog fields that may carry a favorite id; the first match wins. */
	keysOf: (item: T) => Array<string | undefined>;
	/** Pre-read favorites, so one discovery reads the settings file once. */
	favoriteIds?: string[];
	settingsPath?: string;
}

/**
 * Keep only the catalog entries the requested scope allows.
 *
 * The favorites scope never yields an empty catalog: when Droid favorites are unavailable, empty,
 * or all absent from the catalog, the full catalog comes back with the reason recorded, because an
 * empty model picker is worse than a wide one. Catalog order is preserved.
 */
export function applyDroidModelScope<T>(
	items: T[],
	requestedScope: DroidModelScope,
	options: ApplyDroidModelScopeOptions<T>,
): DroidModelScopeResult<T> {
	const catalogCount = items.length;
	const fullCatalog = (fallbackReason?: DroidModelScopeFallbackReason): DroidModelScopeResult<T> => ({
		items,
		requestedScope,
		appliedScope: "all",
		catalogCount,
		modelCount: items.length,
		unmatchedFavoriteIds: [],
		...(fallbackReason ? { fallbackReason } : {}),
	});

	if (requestedScope !== "favorites") return fullCatalog();

	const favoriteIds = options.favoriteIds ?? readDroidFavoriteModelIds(options.settingsPath);
	if (favoriteIds === undefined) return fullCatalog("favorites-unavailable");
	if (favoriteIds.length === 0) return fullCatalog("favorites-empty");

	const favorites = new Set(favoriteIds);
	const matched = new Set<string>();
	const kept = items.filter((item) => {
		const hits = options.keysOf(item).filter((key): key is string => !!key && favorites.has(key));
		for (const key of hits) matched.add(key);
		return hits.length > 0;
	});
	const unmatchedFavoriteIds = favoriteIds.filter((id) => !matched.has(id));
	if (kept.length === 0) return fullCatalog("favorites-not-in-catalog");

	return {
		items: kept,
		requestedScope,
		appliedScope: "favorites",
		catalogCount,
		modelCount: kept.length,
		unmatchedFavoriteIds,
	};
}

export const __testUtils = {
	SCOPE_ENV_VAR,
};
