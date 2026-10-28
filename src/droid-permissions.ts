import {
	AutonomyLevel,
	ToolConfirmationOutcome,
	ToolConfirmationType,
	type RequestPermissionRequestParams,
} from "@factory/droid-sdk";

const DROID_AUTONOMY_LEVEL_ENV = "PI_DROID_AUTONOMY_LEVEL";

export function resolveDroidAutonomyLevel(): AutonomyLevel {
	const raw = process.env[DROID_AUTONOMY_LEVEL_ENV]?.trim().toLowerCase();
	switch (raw) {
		case "off":
			return AutonomyLevel.Off;
		case "low":
			return AutonomyLevel.Low;
		case "medium":
			return AutonomyLevel.Medium;
		case "high":
		default:
			return AutonomyLevel.High;
	}
}

function isBridgeMcpTool(params: RequestPermissionRequestParams): boolean {
	return params.toolUses.some((item) => item.details.type === ToolConfirmationType.McpTool);
}

export async function handleDroidPermissionRequest(
	params: RequestPermissionRequestParams,
): Promise<ToolConfirmationOutcome> {
	if (isBridgeMcpTool(params)) {
		return ToolConfirmationOutcome.ProceedOnce;
	}

	const autonomy = resolveDroidAutonomyLevel();
	switch (autonomy) {
		case AutonomyLevel.High:
			return ToolConfirmationOutcome.ProceedAutoRunHigh;
		case AutonomyLevel.Medium:
			return ToolConfirmationOutcome.ProceedAutoRunMedium;
		case AutonomyLevel.Low:
			return ToolConfirmationOutcome.ProceedAutoRunLow;
		case AutonomyLevel.Off:
		default:
			return ToolConfirmationOutcome.Cancel;
	}
}
