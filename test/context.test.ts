import { describe, it, expect } from "vitest";
import { __testUtils } from "../src/droid-pi-tool-bridge.js";
import { buildDroidPrompt } from "../src/context.js";
import { normalizeContext } from "@earendil-works/pi-ai";

describe("droid-pi-tool-bridge", () => {
	it("is enabled by default", () => {
		expect(__testUtils.resolveDroidPiToolBridgeEnabled({})).toBe(true);
	});

	it("prefixes bridged tool names", () => {
		expect(__testUtils.toMcpToolName("grep")).toBe("pi__grep");
	});
});

describe("buildDroidPrompt", () => {
	it("includes bridge contract and transcript", () => {
		const context = normalizeContext({
			systemPrompt: "You are helpful.",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		});
		const prompt = buildDroidPrompt(context);
		expect(prompt.text).toContain("Droid pi bridge contract");
		expect(prompt.text).toContain("User: hello");
	});

	it("reads the prompt from transcript system messages", () => {
		const context = normalizeContext({
			systemPrompt: "You are helpful.",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		});
		expect(buildDroidPrompt(context).text).toContain("You are helpful.");
	});

	it("keeps later system sections and omits the tool catalog", () => {
		const context = normalizeContext({
			systemPrompt: "Base prompt\n\n<tools>\n- read: Read files\n</tools>",
			messages: [
				{ role: "system", content: "", sections: { rules: "<rules>later rules</rules>" }, timestamp: 1 },
				{ role: "user", content: "hello", timestamp: 2 },
			],
		});
		const prompt = buildDroidPrompt(context);
		expect(prompt.text).toContain("Base prompt");
		expect(prompt.text).toContain("<rules>later rules</rules>");
		expect(prompt.text).not.toContain("<tools>");
		expect(prompt.text).not.toContain("- read: Read files");
		expect(prompt.text).not.toContain("System: ");
	});
});
