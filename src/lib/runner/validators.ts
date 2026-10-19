import { z } from 'zod';

export const FindingItemSchema = z.object({
	id: z.string().default(() => 'ISSUE-' + Math.random().toString(36).substring(2, 7).toUpperCase()),
	domain: z.string().default('general'),
	criterion_code: z.string().optional(),
	title: z.string().min(3),
	severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
	reasoning: z.string().min(5),
	file_path: z.string().optional(),
	diff_hunk: z.string().refine(
		(val) => {
			if (!val || typeof val !== 'string') return false;
			const trimmed = val.trim();
			if (trimmed.startsWith('Changed files:')) return false;
			const lines = trimmed.split('\n');
			const hasDiffMarker = lines.some((l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
			return hasDiffMarker;
		},
		{
			message:
				'diff_hunk must contain the exact 3-to-15 line unified diff snippet (with @@, +, or -) and cannot start with "Changed files:" or lack diff lines.'
		}
	),
	recommendation: z.string().optional()
});

export const VibeCriterionScoreSchema = z
	.object({
		code: z.string().optional(),
		key: z.string().optional(),
		name: z.string().optional(),
		score: z.number().min(0).max(100).nullable().optional(),
		status: z.enum(['PASS', 'WARN', 'FAIL', 'NA']),
		execution_status: z.enum(['VALIDATED', 'INCOMPLETE', 'ERROR', 'NA']).default('VALIDATED'),
		summary: z.string().min(1),
		comment: z.string().optional(),
		findings: z.array(FindingItemSchema).default([]),
		recommendations: z.array(z.string()).optional()
	})
	.superRefine((data, ctx) => {
		// Deterministic validation: reject any finding whose diff_hunk starts with "Changed files:" or lacks diff lines
		if (data.status !== 'PASS' && data.status !== 'NA' && data.findings && data.findings.length > 0) {
			data.findings.forEach((finding, idx) => {
				if (!finding.diff_hunk || finding.diff_hunk.trim().startsWith('Changed files:')) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Finding [${idx}] diff_hunk cannot start with "Changed files:" and must contain raw unified diff lines.`,
						path: ['findings', idx, 'diff_hunk']
					});
				}
				const lines = (finding.diff_hunk || '').split('\n');
				const hasDiffLines = lines.some((l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
				if (!hasDiffLines) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Finding [${idx}] diff_hunk lacks diff lines (+, -, @@).`,
						path: ['findings', idx, 'diff_hunk']
					});
				}
			});
		}
	});

export const AgentFingerprintSchema = z.object({
	agent_model: z.string().optional(),
	intent_summary: z.string().min(5),
	reasoning_record: z.string().min(5),
	perceived_risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
});

export const PresentIssueResolutionSchema = z.object({
	resolved_by_commit: z.string().nullable(),
	resolution_evidence: z.string(),
	is_resolved: z.boolean()
});

export const DomainScoreSchema = VibeCriterionScoreSchema;
export type VibeCriterionScoreData = z.output<typeof VibeCriterionScoreSchema>;
export type DomainScoreData = VibeCriterionScoreData;
export type AgentFingerprintData = z.output<typeof AgentFingerprintSchema>;
export type FindingItemData = z.output<typeof FindingItemSchema>;
