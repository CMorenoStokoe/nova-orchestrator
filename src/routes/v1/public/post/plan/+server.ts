import { streamText } from 'ai';
import type { RequestHandler } from './$types';
import { googleProvider, DEFAULT_MODEL_NAME } from '$lib/ai/gemini';
import { query, recordAuditLog } from '$lib/db/client';
import { json } from '@sveltejs/kit';
import type { ScopedFindingContext } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages, current_commit, scoped_finding, save_plan = true } = (await request.json()) as {
			messages: Array<{ role: 'user' | 'assistant'; content: string }>;
			current_commit?: any;
			scoped_finding?: ScopedFindingContext;
			save_plan?: boolean;
		};

		if (!messages || !Array.isArray(messages)) {
			return json({ error: 'Missing or invalid "messages" in request body' }, { status: 400 });
		}

		const commitHash = scoped_finding?.hash || current_commit?.hash || 'unknown';
		const issueId = scoped_finding?.issue_id || 'GENERAL';
		const planId = `plan_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).substring(2, 18)}`;

		let systemPrompt = `You are Nova Remediation Architect for the Terminus trade research platform.
Generate a concise, formal Remediation Specification formatted with markdown.
Your response MUST include:
1. Root Cause Summary
2. Recommended Code Patch (as a clean \`\`\`diff block)
3. Quantitative Safety Verification Steps`;

		if (scoped_finding) {
			systemPrompt += `\n\n### Scoped Defect Being Remediated:
- Issue ID: ${scoped_finding.issue_id}
- Domain Category: ${scoped_finding.domain_category}
- Target File: ${scoped_finding.file_path || 'Referenced commit change'}
- Defect Critique: ${scoped_finding.finding_reasoning || 'Flagged during automated audit'}
- Reference Diff:
\`\`\`diff
${scoped_finding.diff_hunk || ''}
\`\`\``;
		}

		const result = streamText({
			model: googleProvider(DEFAULT_MODEL_NAME),
			system: systemPrompt,
			messages,
			onFinish: async ({ text }) => {
				if (save_plan && commitHash !== 'unknown') {
					try {
						await query(
							`INSERT INTO remediation_plans (id, commit_hash, title, plan_markdown, status, created_at)
							 VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL', NOW())
							 ON CONFLICT (id) DO UPDATE SET plan_markdown = EXCLUDED.plan_markdown, status = 'PENDING_APPROVAL';`,
							[planId, commitHash, `Remediation Plan for ${issueId} in ${commitHash.substring(0, 7)}`, text]
						);

						await recordAuditLog(
							'PLAN_LOCKED_PENDING_APPROVAL',
							'remediation_agent',
							{ planId, commitHash, issueId, status: 'PENDING_APPROVAL' },
							{ type: 'remediation_plan', id: planId }
						);
					} catch (dbErr) {
						console.error('Failed to persist remediation plan in onFinish:', dbErr);
					}
				}
			}
		});

		const response = result.toTextStreamResponse({
			headers: {
				'x-nova-plan-id': planId,
				'x-nova-issue-id': issueId
			}
		});
		return response;
	} catch (error: any) {
		console.error('Plan generation error:', error);
		return json({ error: 'Failed to generate plan', details: error.message }, { status: 500 });
	}
};
