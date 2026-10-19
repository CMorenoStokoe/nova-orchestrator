import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/db/client';

export const GET: RequestHandler = async ({ url }) => {
	const hash = url.searchParams.get('hash');

	if (!hash) {
		return json({ error: 'Missing required query parameter: hash' }, { status: 400 });
	}

	try {
		const sql = `
			SELECT 
				r.hash,
				r.branch,
				r.summary,
				r."full",
				r.resolved_by_commit,
				r.validation_status,
				r.created_at,
				r.updated_at,
				rp.id as plan_id,
				rp.title as plan_title,
				rp.plan_markdown,
				rp.status as plan_status,
				rp.approved_at,
				rp.approved_by
			FROM reports r
			LEFT JOIN remediation_plans rp ON r.hash = rp.commit_hash
			WHERE r.hash = $1 OR r.hash ILIKE $1 || '%'
			LIMIT 1;
		`;

		const result = await query<any>(sql, [hash]);

		if (result.rows.length === 0) {
			return json({ error: `Report for commit ${hash} not found` }, { status: 404 });
		}

		const row = result.rows[0];
		const fullReport = typeof row.full === 'string' ? JSON.parse(row.full) : row.full;
		const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;

		const responsePayload = {
			...fullReport,
			hash: row.hash,
			branch: row.branch,
			summary,
			validation_status: row.validation_status,
			resolved_by_commit: row.resolved_by_commit,
			created_at: row.created_at,
			updated_at: row.updated_at,
			remediation_plan: row.plan_id
				? {
						id: row.plan_id,
						commit_hash: row.hash,
						title: row.plan_title,
						plan_markdown: row.plan_markdown,
						status: row.plan_status,
						approved_at: row.approved_at,
						approved_by: row.approved_by
				  }
				: null
		};

		return json(responsePayload);
	} catch (error: any) {
		console.error(`Failed to get full report for ${hash}:`, error);
		return json(
			{ error: `Failed to retrieve full report for ${hash}`, details: error.message },
			{ status: 500 }
		);
	}
};
