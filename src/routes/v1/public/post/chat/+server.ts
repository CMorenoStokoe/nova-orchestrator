import { streamText } from 'ai';
import type { RequestHandler } from './$types';
import { googleProvider, DEFAULT_MODEL_NAME } from '$lib/ai/gemini';
import { json } from '@sveltejs/kit';
import type { ScopedFindingContext } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages, current_commit, scoped_finding } = (await request.json()) as {
			messages: Array<{ role: 'user' | 'assistant'; content: string }>;
			current_commit?: any;
			scoped_finding?: ScopedFindingContext;
		};

		if (!messages || !Array.isArray(messages)) {
			return json({ error: 'Missing or invalid "messages" in request body' }, { status: 400 });
		}

		let systemPrompt = `You are Nova Assistant, a specialized code review critic for the Terminus trade research platform.
You assist human engineers in interrogating code defects, reasoning through quantitative risks, and formulating atomic remediation steps.
Be concise, mathematically and technically rigorous. Directly reference the code diff hunk and domain critique provided.`;

		if (scoped_finding) {
			systemPrompt += `\n\n### Scoped Defect Context (Stage 3 Scoped Interrogation):
- Issue ID: ${scoped_finding.issue_id}
- Domain Category: ${scoped_finding.domain_category}
- Target File: ${scoped_finding.file_path || 'Referenced commit change'}
- Finding Critique / Reasoning: ${scoped_finding.finding_reasoning || 'Flagged during automated multi-agent audit'}
- Code Diff Hunk:
\`\`\`diff
${scoped_finding.diff_hunk || 'No specific diff hunk attached.'}
\`\`\`
The human reviewer is interrogating this exact defect. Do not ask them which issue they are referencing.`;
		} else if (current_commit) {
			systemPrompt += `\n\n### General Commit Context:
- Commit Hash: ${current_commit.hash || 'N/A'}
- Message: ${current_commit.message || 'N/A'}
- Safety Verdict: ${current_commit.safety_verdict || 'N/A'}`;
		}

		const result = streamText({
			model: googleProvider(DEFAULT_MODEL_NAME),
			system: systemPrompt,
			messages
		});

		return result.toTextStreamResponse();
	} catch (error: any) {
		console.error('Chat endpoint error:', error);
		return json({ error: 'Failed to process chat request', details: error.message }, { status: 500 });
	}
};
