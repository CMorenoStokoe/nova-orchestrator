import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query, recordAuditLog } from '$lib/db/client';

export const PUT: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { hash, branch = 'main', full, summary, resolved_by_commit = null, validation_status = 'INCOMPLETE' } = body;

		if (!hash || !full || !summary) {
			return json(
				{ error: 'Missing required fields: hash, full, and summary are required' },
				{ status: 400 }
			);
		}

		// Upsert report in Neon Postgres
		const sql = `
			INSERT INTO reports (hash, branch, summary, "full", resolved_by_commit, validation_status, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			ON CONFLICT (hash) DO UPDATE SET
				branch = EXCLUDED.branch,
				summary = EXCLUDED.summary,
				"full" = EXCLUDED."full",
				resolved_by_commit = COALESCE(EXCLUDED.resolved_by_commit, reports.resolved_by_commit),
				validation_status = EXCLUDED.validation_status,
				updated_at = NOW()
			RETURNING hash, validation_status;
		`;

		const params = [
			hash,
			branch,
			JSON.stringify(summary),
			JSON.stringify(full),
			resolved_by_commit,
			validation_status
		];

		const result = await query<{ hash: string; validation_status: string }>(sql, params);

		await recordAuditLog(
			'REPORT_UPSERT',
			'batch_runner',
			{ hash, branch, validation_status },
			{ type: 'commit_report', id: hash }
		);

		return json({
			success: true,
			hash: result.rows[0]?.hash,
			validation_status: result.rows[0]?.validation_status
		}, { status: 200 });
	} catch (error: any) {
		console.error('Failed to put report:', error);
		return json(
			{ error: 'Failed to write report to database', details: error.message },
			{ status: 500 }
		);
	}
};
