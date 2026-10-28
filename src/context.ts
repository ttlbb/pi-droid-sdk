import { getCurrentSystemPrompt, type Message, type ToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { getDroidPiBridgeContractText } from "./droid-bridge-contract.js";

export interface DroidPrompt {
	text: string;
	images: Array<{ data: string; mimeType: string }>;
}

export interface DroidPromptOptions {
	maxInputTokens?: number;
	charsPerToken?: number;
	imageTokenEstimate?: number;
}

export const DROID_APPROX_CHARS_PER_TOKEN = 4;
export const DROID_IMAGE_TOKEN_ESTIMATE = 1200;
const SECTION_SEPARATOR = "\n\n";

function isTextBlock(block: { type: string }): block is { type: "text"; text: string } {
	return block.type === "text";
}

function isImageBlock(block: { type: string }): block is { type: "image"; data: string; mimeType: string } {
	return block.type === "image";
}

function isToolCallBlock(block: { type: string }): block is ToolCall {
	return block.type === "toolCall";
}

function extractLatestImages(messages: Message[]): DroidPrompt["images"] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "user") continue;
		if (typeof msg.content === "string") return [];

		const images: DroidPrompt["images"] = [];
		for (const block of msg.content) {
			if (isImageBlock(block) && block.data && block.mimeType) {
				images.push({ data: block.data, mimeType: block.mimeType });
			}
		}
		return images;
	}
	return [];
}

function formatContentBlocks(content: string | { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.map((block) => {
			if (isTextBlock(block)) return block.text;
			if (block.type === "image") return "[image omitted from transcript]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function formatToolCall(toolCall: ToolCall): string {
	const args = JSON.stringify(toolCall.arguments) ?? "";
	return `Tool call (${toolCall.name}, call ${toolCall.id}): ${args}`;
}

function sanitizeSystemPromptForDroid(systemPrompt: string): string {
	let sanitized = systemPrompt;
	// pi 1.x renders the tool catalog as a <tools> section and no longer includes it in
	// context.systemPrompt; Droid must not be told about tools it cannot call.
	sanitized = sanitized.replace(
		/<tools>[\s\S]*?<\/tools>\n?/,
		"Pi tool catalog omitted: Droid can call only Droid SDK / bridged MCP tools exposed in this run.\n\n",
	);
	sanitized = sanitized.replace(
		/\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/g,
		"",
	);
	return sanitized.trim();
}

function formatMessage(msg: Message): string | undefined {
	switch (msg.role) {
		case "user": {
			const text = formatContentBlocks(msg.content);
			return text ? `User: ${text}` : undefined;
		}
		case "assistant": {
			const blocks = Array.isArray(msg.content) ? msg.content : [{ type: "text" as const, text: String(msg.content) }];
			const textParts: string[] = [];
			for (const block of blocks) {
				if (isTextBlock(block)) textParts.push(block.text);
				else if (isToolCallBlock(block)) textParts.push(formatToolCall(block));
			}
			return textParts.length > 0 ? `Assistant: ${textParts.join("\n")}` : undefined;
		}
		case "toolResult": {
			const text = formatContentBlocks(msg.content);
			const label = msg.isError ? "Tool error" : "Tool result";
			return `${label} (${msg.toolName}, call ${msg.toolCallId}): ${text}`;
		}
		case "system":
			// The current system prompt is rendered once from the whole transcript below.
			return undefined;
	}
}

function getLatestUserMessageIndex(messages: Message[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") return index;
	}
	return -1;
}

export function buildDroidPrompt(context: TranscriptContext): DroidPrompt {
	const images = extractLatestImages(context.messages);
	const sections: string[] = [];

	const systemPrompt = getCurrentSystemPrompt(context.messages).trim();
	if (systemPrompt) {
		sections.push(sanitizeSystemPromptForDroid(systemPrompt));
	}

	sections.push(getDroidPiBridgeContractText());

	const transcriptParts: string[] = [];
	const latestUserIndex = getLatestUserMessageIndex(context.messages);
	for (let index = 0; index < context.messages.length; index += 1) {
		const formatted = formatMessage(context.messages[index]);
		if (!formatted) continue;
		if (index === latestUserIndex && images.length > 0) {
			transcriptParts.push(`${formatted}\n[Latest user turn includes ${images.length} image(s) attached to this request.]`);
		} else {
			transcriptParts.push(formatted);
		}
	}

	if (transcriptParts.length > 0) {
		sections.push(transcriptParts.join("\n\n"));
	}

	const text = sections.join(SECTION_SEPARATOR);
	return { text, images };
}

export function estimateDroidPromptInputTokens(prompt: DroidPrompt, options: DroidPromptOptions = {}): number {
	const charsPerToken = options.charsPerToken ?? DROID_APPROX_CHARS_PER_TOKEN;
	const imageTokenEstimate = options.imageTokenEstimate ?? DROID_IMAGE_TOKEN_ESTIMATE;
	return Math.ceil(prompt.text.length / charsPerToken) + prompt.images.length * imageTokenEstimate;
}
