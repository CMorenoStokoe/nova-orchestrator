import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { transaction } from '$lib/db/client';
import { createIssue, type GitHubIssue } from '$lib/github/client';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const {
			plan_id,
			commit_hash,
			approver = 'human_reviewer',
			issue_title,
			issue_body,
			issue_labels,
			resolved_by_commit = null
		} = await request.json();

		let targetCommitHash = commit_hash;
		let effectivePlanId = plan_id;

		// 1. Log or Mock GitHub Issue
		const defaultTitle = issue_title || `fix: remediate Quality Markers for commit ${(targetCommitHash || 'HEAD').substring(0, 7)}`;
		const defaultBody = issue_body || `### Remediation Issue\n\nAutomatically created by Nova Orchestrator upon verbatim sign-off for commit ${targetCommitHash}.`;
		const githubIssue: GitHubIssue = await createIssue({
			title: defaultTitle,
			body: defaultBody,
			labels: issue_labels || ['quality-markers', 'ai-generated-code', 'remediation']
		});

		const issueRef = resolved_by_commit || `gh-issue-${githubIssue.number}`;

		// 2. Execute atomic ACID transaction transitioning PENDING_APPROVAL to RESOLVED and logging audit
		const result = await transaction(async (client) => {
			// If plan_id exists, fetch and update it; otherwise create it
			let plan: any = null;
			if (effectivePlanId) {
				const checkRes = await client.query(
					`SELECT id, commit_hash, status FROM remediation_plans WHERE id = $1 FOR UPDATE;`,
					[effectivePlanId]
				);
				if (checkRes.rows.length > 0) {
					plan = checkRes.rows[0];
					targetCommitHash = targetCommitHash || plan.commit_hash;
				}
			}

			if (!effectivePlanId) {
				effectivePlanId = `plan_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).substring(2, 18)}`;
			}

			if (!targetCommitHash) {
				throw new Error('Missing commit_hash for remediation and issue filing.');
			}

			// Ensure canonical matching report hash exists in Neon Postgres (handles full 40-char vs short 7-char hash)
			const reportCheck = await client.query(
				`SELECT hash FROM reports WHERE hash = $1 OR hash LIKE $2 OR $1 LIKE (hash || '%') LIMIT 1;`,
				[targetCommitHash, `${targetCommitHash.substring(0, 7)}%`]
			);

			if (reportCheck.rows.length > 0) {
				targetCommitHash = reportCheck.rows[0].hash;
			} else {
				// Create report entry if not yet recorded to satisfy foreign key constraint
				await client.query(
					`INSERT INTO reports (hash, branch, summary, "full", validation_status, created_at, updated_at)
					 VALUES ($1, 'main', '{}'::jsonb, '{}'::jsonb, 'FLAGGED', NOW(), NOW())
					 ON CONFLICT (hash) DO NOTHING;`,
					[targetCommitHash]
				);
			}

			// Upsert remediation plan with RESOLVED status
			const updatePlanRes = await client.query(
				`INSERT INTO remediation_plans (id, commit_hash, title, plan_markdown, status, created_at, approved_at, approved_by)
				 VALUES ($1, $2, $3, $4, 'RESOLVED', NOW(), NOW(), $5)
				 ON CONFLICT (id) DO UPDATE SET
				   status = 'RESOLVED',
				   approved_at = NOW(),
				   approved_by = EXCLUDED.approved_by
				 RETURNING id, commit_hash, status, approved_at, approved_by;`,
				[effectivePlanId, targetCommitHash, defaultTitle, defaultBody, approver]
			);

			// Update report resolved_by_commit in Neon Postgres
			await client.query(
				`UPDATE reports
				 SET resolved_by_commit = $1, updated_at = NOW()
				 WHERE hash = $2;`,
				[issueRef, targetCommitHash]
			);

			// Record atomic audit log entry in the same transaction
			await client.query(
				`INSERT INTO audit_logs (action, actor, target_type, target_id, details, created_at)
				 VALUES ($1, $2, $3, $4, $5, NOW());`,
				[
					'GITHUB_ISSUE_FILED_COMMIT_RESOLVED',
					approver,
					'github_issue',
					String(githubIssue.number),
					JSON.stringify({
						commit_hash: targetCommitHash,
						github_issue: {
							number: githubIssue.number,
							title: githubIssue.title,
							html_url: githubIssue.html_url,
							state: githubIssue.state
						},
						plan_id: effectivePlanId,
						resolved_by_commit: issueRef
					})
				]
			);

			return updatePlanRes.rows[0];
		});

		return json({
			success: true,
			plan: result,
			github_issue: githubIssue,
			commit_hash: targetCommitHash,
			resolved_by_commit: issueRef,
			message: `GitHub Issue #${githubIssue.number} logged and commit marked as RESOLVED.`
		});
	} catch (error: any) {
		console.error('Approval & GitHub issue creation failed:', error);
		return json(
			{ error: 'Failed to approve plan and file GitHub issue', details: error.message },
			{ status: 500 }
		);
	}
};
