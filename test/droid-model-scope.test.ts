import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyDroidModelScope,
	parseDroidModelScope,
	readDroidFavoriteModelIds,
	resolveDroidModelScope,
	__testUtils,
} from "../src/droid-model-scope.js";

interface CatalogItem {
	id: string;
	modelId?: string;
}

const catalog: CatalogItem[] = [
	{ id: "claude-opus-5-5", modelId: "claude-opus-5-5" },
	{ id: "claude-sonnet-5-5", modelId: "claude-sonnet-5-5" },
	{ id: "glm-5.3" },
];

function keysOf(item: CatalogItem): Array<string | undefined> {
	return [item.id, item.modelId];
}

describe("parseDroidModelScope", () => {
	it("accepts the favorites spellings", () => {
		expect(parseDroidModelScope("favorites")).toBe("favorites");
		expect(parseDroidModelScope(" FAVORITE ")).toBe("favorites");
		expect(parseDroidModelScope("fav")).toBe("favorites");
	});

	it("accepts the full-catalog spellings", () => {
		expect(parseDroidModelScope("all")).toBe("all");
		expect(parseDroidModelScope("full")).toBe("all");
	});

	it("rejects empty and unknown values", () => {
		expect(parseDroidModelScope(undefined)).toBeUndefined();
		expect(parseDroidModelScope("   ")).toBeUndefined();
		expect(parseDroidModelScope("favourites")).toBeUndefined();
	});
});

describe("resolveDroidModelScope", () => {
	it("defaults to the full catalog", () => {
		expect(resolveDroidModelScope({})).toBe("all");
		expect(__testUtils.SCOPE_ENV_VAR).toBe("PI_DROID_MODEL_SCOPE");
	});

	it("reads PI_DROID_MODEL_SCOPE and ignores unrecognized values", () => {
		expect(resolveDroidModelScope({ PI_DROID_MODEL_SCOPE: "favorites" })).toBe("favorites");
		expect(resolveDroidModelScope({ PI_DROID_MODEL_SCOPE: "all" })).toBe("all");
		expect(resolveDroidModelScope({ PI_DROID_MODEL_SCOPE: "something-else" })).toBe("all");
	});
});

describe("readDroidFavoriteModelIds", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-droid-favorites-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeSettings(contents: string): string {
		const path = join(tmpDir, "settings.json");
		writeFileSync(path, contents);
		return path;
	}

	it("reads the favorites the Droid TUI stored", () => {
		const path = writeSettings(JSON.stringify({ modelFavorites: [" glm-5.3 ", "claude-opus-5-5", "", 7] }));
		expect(readDroidFavoriteModelIds(path)).toEqual(["glm-5.3", "claude-opus-5-5"]);
	});

	it("reports an empty array when Droid has no favorites yet", () => {
		expect(readDroidFavoriteModelIds(writeSettings(JSON.stringify({ modelFavorites: [] })))).toEqual([]);
	});

	it("returns undefined for a missing file, invalid JSON, or settings without favorites", () => {
		expect(readDroidFavoriteModelIds(join(tmpDir, "absent.json"))).toBeUndefined();
		expect(readDroidFavoriteModelIds(writeSettings("{not json"))).toBeUndefined();
		expect(readDroidFavoriteModelIds(writeSettings(JSON.stringify({ modelFavorites: "glm-5.3" })))).toBeUndefined();
		expect(readDroidFavoriteModelIds(writeSettings(JSON.stringify({ theme: "factory-dark" })))).toBeUndefined();
	});
});

describe("applyDroidModelScope", () => {
	it("passes the whole catalog through for the all scope without reading settings", () => {
		const result = applyDroidModelScope(catalog, "all", {
			keysOf,
			settingsPath: "/definitely/not/here/settings.json",
		});
		expect(result.items).toBe(catalog);
		expect(result).toMatchObject({ requestedScope: "all", appliedScope: "all", catalogCount: 3, modelCount: 3 });
		expect(result.fallbackReason).toBeUndefined();
	});

	it("keeps only the favorites in catalog order and reports the ones it could not show", () => {
		const result = applyDroidModelScope(catalog, "favorites", {
			keysOf,
			favoriteIds: ["glm-5.3", "claude-opus-5-5", "gone-model"],
		});
		expect(result.items.map((item) => item.id)).toEqual(["claude-opus-5-5", "glm-5.3"]);
		expect(result).toMatchObject({
			requestedScope: "favorites",
			appliedScope: "favorites",
			catalogCount: 3,
			modelCount: 2,
			unmatchedFavoriteIds: ["gone-model"],
		});
	});

	it("matches a favorite against the catalog modelId as well as the id", () => {
		const result = applyDroidModelScope(catalog, "favorites", { keysOf, favoriteIds: ["glm-5.3"] });
		expect(result.items.map((item) => item.id)).toEqual(["glm-5.3"]);
		expect(result.unmatchedFavoriteIds).toEqual([]);
	});

	it("keeps the full catalog when favorites are unavailable", () => {
		const result = applyDroidModelScope(catalog, "favorites", {
			keysOf,
			settingsPath: "/definitely/not/here/settings.json",
		});
		expect(result.items).toBe(catalog);
		expect(result).toMatchObject({ appliedScope: "all", fallbackReason: "favorites-unavailable" });
	});

	it("keeps the full catalog when no favorite is configured", () => {
		const result = applyDroidModelScope(catalog, "favorites", { keysOf, favoriteIds: [] });
		expect(result.items).toBe(catalog);
		expect(result.fallbackReason).toBe("favorites-empty");
	});

	it("keeps the full catalog when no favorite exists in the catalog", () => {
		const result = applyDroidModelScope(catalog, "favorites", { keysOf, favoriteIds: ["gone-model"] });
		expect(result.items).toBe(catalog);
		expect(result).toMatchObject({ appliedScope: "all", fallbackReason: "favorites-not-in-catalog" });
	});
});
