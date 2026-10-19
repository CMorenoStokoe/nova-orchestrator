import { generateGeminiCompletion, ApiTransportError } from '$lib/ai/gemini';
import {
	VibeCriterionScoreSchema,
	AgentFingerprintSchema,
	PresentIssueResolutionSchema,
	type VibeCriterionScoreData,
	type AgentFingerprintData
} from './validators';
import type { VibeCriterionDef } from '$lib/types';
import type { z } from 'zod';

const MAX_STAGE_RETRIES = 2;

export class SchemaValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SchemaValidationError';
	}
}

async function executeAgentStageWithValidation<T>(
	agentName: string,
	basePrompt: string,
	systemInstruction: string,
	schema: z.ZodType<T, any, any>
): Promise<T> {
	let attempt = 0;
	let lastSchemaError: Error | null = null;
	let currentPrompt = basePrompt;

	while (attempt <= MAX_STAGE_RETRIES) {
		let rawResponse: string;

		try {
			rawResponse = await generateGeminiCompletion(
				currentPrompt +
					`\n\nCRITICAL OUTPUT SPECIFICATION:
Respond ONLY with valid, raw JSON adhering strictly to the schema without markdown formatting or commentary.
Example JSON:
{
  "score": 85,
  "status": "PASS",
  "summary": "Detailed criterion analysis summary",
  "comment": "Explicit 1-2 sentence rationale explaining precisely why this criterion passed or why it failed",
  "findings": [],
  "recommendations": []
}

If any defect is found (status "WARN" or "FAIL"), each item in "findings" MUST be structured like:
{
  "title": "Short issue title",
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "Clear explanation of the bug",
  "file_path": "path/to/file.ts",
  "diff_hunk": "@@ -10,6 +10,8 @@\\n- old line\\n+ new line",
  "recommendation": "Prescriptive remediation step"
}
Note: diff_hunk MUST contain the actual 3-to-15 line unified diff snippet (with @@ and + / - lines). Never return summary metadata or "Changed files:".`,
				systemInstruction
			);
		} catch (transportErr: any) {
			// API Transport/Quota error: Do NOT swallow as code defect, rethrow immediately without burning schema retries
			console.error(`[${agentName}] API Transport Error: ${transportErr.message}`);
			throw transportErr;
		}

		try {
			// Clean possible markdown code fences
			const cleanJson = rawResponse
				.replace(/^```json\s*/i, '')
				.replace(/^```\s*/i, '')
				.replace(/```$/i, '')
				.trim();

			const parsed = JSON.parse(cleanJson);
			const validated = schema.parse(parsed);
			return validated;
		} catch (err: any) {
			attempt++;
			lastSchemaError = err;
			console.warn(`[${agentName}] Schema validation failed on attempt ${attempt}/${MAX_STAGE_RETRIES}: ${err.message}`);

			if (attempt <= MAX_STAGE_RETRIES) {
				// Provide self-healing guidance back to LLM
				currentPrompt = `${basePrompt}

CRITICAL: Your previous response failed schema validation:
${err.message}

Please fix the JSON output:
1. Ensure all required fields exist.
2. If status is "PASS", set findings: [].
3. If status is "WARN" or "FAIL", ensure every item in findings has a valid "diff_hunk" containing 3-to-15 lines of raw unified diff with @@ and +/- lines. DO NOT output "Changed files:".`;
			}
		}
	}

	throw new SchemaValidationError(
		`[${agentName}] Schema validation failed after ${MAX_STAGE_RETRIES} retries: ${lastSchemaError?.message || 'Unknown schema violation'}`
	);
}

/**
 * Runs a single Quality Marker (of AI-Generated Code) agent in the strict serial evaluation chain.
 */
export async function runVibeCriterionAgent(
	criterion: VibeCriterionDef,
	rawDiffHunks: string,
	commitMsg: string
): Promise<VibeCriterionScoreData> {
	const prompt = `Evaluate the following commit against Quality Marker (of AI-Generated Code) [${criterion.code}] ${criterion.name}:
Criterion Mandate: ${criterion.description}

Commit Message:
${commitMsg}

Raw Unified Diff Hunks:
${rawDiffHunks}

SCORING & FLAGGING THRESHOLD RULES:
- Score: integer from 0 to 100 representing confidence and compliance.
- PASS: Score must be 85% or higher (>= 85) with zero critical defects or constraint violations. Status must be "PASS".
- FLAGGED (WARN / FAIL): If score is below 85% (< 85) or any anti-pattern, defect, or safety violation is detected, status MUST be "WARN" or "FAIL" and include detailed findings with diff_hunk.

CRITICAL: Respond ONLY with valid, raw JSON matching this schema:
{
  "code": "${criterion.code}",
  "key": "${criterion.key}",
  "name": "${criterion.name}",
  "score": 85,
  "status": "PASS",
  "summary": "Detailed technical critique against this specific criterion",
  "findings": [],
  "recommendations": []
}`;

	const result = await executeAgentStageWithValidation(
		`Vibe_${criterion.code}`,
		prompt,
		criterion.systemInstruction,
		VibeCriterionScoreSchema
	);

	const enforcedStatus =
		typeof result.score === 'number' && result.score < 85 && result.status === 'PASS'
			? 'WARN'
			: result.status;

	return {
		code: criterion.code,
		key: criterion.key,
		name: criterion.name,
		score: result.score,
		status: enforcedStatus,
		execution_status: 'VALIDATED',
		summary: result.summary,
		findings: (result.findings || []).map((f, idx) => ({
			...f,
			id: f.id || `${criterion.code}-${idx + 1}`,
			domain: criterion.key,
			criterion_code: criterion.code
		})),
		recommendations: result.recommendations || []
	};
}

export async function runAgentFingerprinting(rawDiffHunks: string, commitMsg: string): Promise<AgentFingerprintData> {
	const systemInstruction = `You are the Agent Fingerprinting Specialist. Detect written records or summaries of intent and reasoning from autonomous AI coding agents during this commit, and assess perceived risk.`;
	const prompt = `Extract agent intent, reasoning record, and risk level from this commit:
Commit Message: ${commitMsg}

Raw Unified Diff Hunks:
${rawDiffHunks}`;
	
	return await executeAgentStageWithValidation('AgentFingerprinting', prompt, systemInstruction, AgentFingerprintSchema);
}

export async function runPresentIssueResolutionAgent(
	currentReportSummary: string,
	subsequentCommitSummaries: { hash: string; message: string; diffSummary: string }[]
): Promise<{ resolved_by_commit: string | null; is_resolved: boolean; evidence: string }> {
	if (!subsequentCommitSummaries || subsequentCommitSummaries.length === 0) {
		return { resolved_by_commit: null, is_resolved: false, evidence: 'No subsequent commits exist to resolve issues.' };
	}

	const prompt = `You are the Present Issue Resolution Agent.
Review the issues identified in this commit:
${currentReportSummary}

Now walk forward chronologically through subsequent commits to identify if any commit specifically addresses and resolves these issues:
${JSON.stringify(subsequentCommitSummaries, null, 2)}

Respond with JSON:
{
  "resolved_by_commit": "<hash of commit that resolved it or null>",
  "resolution_evidence": "<explanation of how it was resolved or why it remains open>",
  "is_resolved": true|false
}`;

	const res = await executeAgentStageWithValidation(
		'PresentIssueResolutionAgent',
		prompt,
		'You evaluate whether historical bugs/issues have been resolved by subsequent commits in Git lineage.',
		PresentIssueResolutionSchema
	);
	return {
		resolved_by_commit: res.resolved_by_commit,
		is_resolved: res.is_resolved,
		evidence: res.resolution_evidence
	};
}
