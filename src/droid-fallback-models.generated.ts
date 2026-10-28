import { ReasoningEffort } from "@factory/droid-sdk";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

export interface DroidFallbackModelItem {
	id: string;
	displayName: string;
	supportsReasoning: boolean;
	supportedReasoningEfforts: ReasoningEffort[];
	defaultReasoningEffort: ReasoningEffort;
	thinkingLevelMap?: ThinkingLevelMap;
	noImageSupport?: boolean;
	isCustom?: boolean;
	tokenMultiplier?: number;
}

const claudeReasoning = {
	supportsReasoning: true,
	supportedReasoningEfforts: [
		ReasoningEffort.Off,
		ReasoningEffort.Low,
		ReasoningEffort.Medium,
		ReasoningEffort.High,
		ReasoningEffort.Max,
	],
	defaultReasoningEffort: ReasoningEffort.High,
	thinkingLevelMap: {
		off: ReasoningEffort.Off,
		minimal: null,
		low: ReasoningEffort.Low,
		medium: ReasoningEffort.Medium,
		high: ReasoningEffort.High,
		xhigh: ReasoningEffort.Max,
		max: ReasoningEffort.Max,
	} satisfies ThinkingLevelMap,
};

const gptReasoning = {
	supportsReasoning: true,
	supportedReasoningEfforts: [
		ReasoningEffort.Low,
		ReasoningEffort.Medium,
		ReasoningEffort.High,
		ReasoningEffort.ExtraHigh,
	],
	defaultReasoningEffort: ReasoningEffort.Medium,
	thinkingLevelMap: {
		off: null,
		minimal: null,
		low: ReasoningEffort.Low,
		medium: ReasoningEffort.Medium,
		high: ReasoningEffort.High,
		xhigh: ReasoningEffort.ExtraHigh,
		max: null,
	} satisfies ThinkingLevelMap,
};

const coreReasoning = {
	supportsReasoning: true,
	supportedReasoningEfforts: [ReasoningEffort.Off, ReasoningEffort.High],
	defaultReasoningEffort: ReasoningEffort.High,
	thinkingLevelMap: {
		off: ReasoningEffort.Off,
		minimal: null,
		low: null,
		medium: null,
		high: ReasoningEffort.High,
		xhigh: null,
		max: null,
	} satisfies ThinkingLevelMap,
};

// Generated/maintained fallback Factory catalog snapshot.
// Refresh with: npm run refresh:droid-snapshots -- --write
export const FALLBACK_MODEL_ITEMS: DroidFallbackModelItem[] = [
	{ id: "claude-opus-4-7", displayName: "Claude Opus 4.7", ...claudeReasoning, tokenMultiplier: 2 },
	{ id: "claude-opus-4-7-fast", displayName: "Claude Opus 4.7 Fast", ...claudeReasoning, tokenMultiplier: 12 },
	{ id: "claude-opus-4-6", displayName: "Claude Opus 4.6", ...claudeReasoning, tokenMultiplier: 2 },
	{ id: "claude-opus-4-6-fast", displayName: "Claude Opus 4.6 Fast", ...claudeReasoning, tokenMultiplier: 12 },
	{ id: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", ...claudeReasoning, defaultReasoningEffort: ReasoningEffort.Off, tokenMultiplier: 2 },
	{ id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", ...claudeReasoning, tokenMultiplier: 1.2 },
	{ id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", ...claudeReasoning, defaultReasoningEffort: ReasoningEffort.Off, tokenMultiplier: 1.2 },
	{ id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", ...claudeReasoning, defaultReasoningEffort: ReasoningEffort.Off, tokenMultiplier: 0.4 },
	{ id: "gpt-5.5", displayName: "GPT-5.5", ...gptReasoning, tokenMultiplier: 2 },
	{ id: "gpt-5.5-fast", displayName: "GPT-5.5 Fast", ...gptReasoning, tokenMultiplier: 5 },
	{ id: "gpt-5.5-pro", displayName: "GPT-5.5 Pro", ...gptReasoning, tokenMultiplier: 12 },
	{ id: "gpt-5.4", displayName: "GPT-5.4", ...gptReasoning, tokenMultiplier: 1 },
	{ id: "gpt-5.4-fast", displayName: "GPT-5.4 Fast", ...gptReasoning, tokenMultiplier: 2 },
	{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", ...gptReasoning, defaultReasoningEffort: ReasoningEffort.High, tokenMultiplier: 0.3 },
	{ id: "gpt-5.3-codex", displayName: "GPT-5.3-Codex", ...gptReasoning, tokenMultiplier: 0.7 },
	{ id: "gpt-5.3-codex-fast", displayName: "GPT-5.3-Codex Fast", ...gptReasoning, tokenMultiplier: 1.4 },
	{ id: "gpt-5.2", displayName: "GPT-5.2", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.Off, ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High, ReasoningEffort.ExtraHigh], defaultReasoningEffort: ReasoningEffort.Low, thinkingLevelMap: { off: ReasoningEffort.Off, minimal: null, low: ReasoningEffort.Low, medium: ReasoningEffort.Medium, high: ReasoningEffort.High, xhigh: ReasoningEffort.ExtraHigh, max: null }, tokenMultiplier: 0.7 },
	{ id: "gpt-5.2-codex", displayName: "GPT-5.2-Codex", ...gptReasoning, tokenMultiplier: 0.7 },
	{ id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High], defaultReasoningEffort: ReasoningEffort.High, thinkingLevelMap: { off: null, minimal: null, low: ReasoningEffort.Low, medium: ReasoningEffort.Medium, high: ReasoningEffort.High, xhigh: null, max: null }, tokenMultiplier: 0.8 },
	{ id: "gemini-3-flash-preview", displayName: "Gemini 3 Flash", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.Minimal, ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High], defaultReasoningEffort: ReasoningEffort.High, thinkingLevelMap: { off: null, minimal: ReasoningEffort.Minimal, low: ReasoningEffort.Low, medium: ReasoningEffort.Medium, high: ReasoningEffort.High, xhigh: null, max: null }, tokenMultiplier: 0.2 },
	{ id: "glm-5.1", displayName: "Droid Core (GLM-5.1)", ...coreReasoning, tokenMultiplier: 0.55 },
	{ id: "kimi-k2.6", displayName: "Droid Core (Kimi K2.6)", ...coreReasoning, tokenMultiplier: 0.4 },
	{ id: "kimi-k2.5", displayName: "Droid Core (Kimi K2.5)", ...coreReasoning, tokenMultiplier: 0.25 },
	{ id: "deepseek-v4-pro", displayName: "Droid Core (DeepSeek V4 Pro)", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.Off, ReasoningEffort.High, ReasoningEffort.Max], defaultReasoningEffort: ReasoningEffort.High, thinkingLevelMap: { off: ReasoningEffort.Off, minimal: null, low: null, medium: null, high: ReasoningEffort.High, xhigh: ReasoningEffort.Max, max: ReasoningEffort.Max }, tokenMultiplier: 0.55 },
	{ id: "minimax-m2.7", displayName: "Droid Core (MiniMax M2.7)", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.High], defaultReasoningEffort: ReasoningEffort.High, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: ReasoningEffort.High, xhigh: null, max: null }, tokenMultiplier: 0.12 },
	{ id: "minimax-m2.5", displayName: "Droid Core (MiniMax M2.5)", supportsReasoning: true, supportedReasoningEfforts: [ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High], defaultReasoningEffort: ReasoningEffort.High, thinkingLevelMap: { off: null, minimal: null, low: ReasoningEffort.Low, medium: ReasoningEffort.Medium, high: ReasoningEffort.High, xhigh: null, max: null }, tokenMultiplier: 0.12 },
];
