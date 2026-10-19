import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/db/client';
import { getRepoCommits } from '$lib/github/client';
import { normalizeCommitBranches } from '$lib/git/lineage';
import { getMainAncestrySet } from '$lib/server/lineage';

export const GET: RequestHandler = async ({ url }) => {
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
	const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10));
	const branch = url.searchParams.get('branch');
	const offset = (page - 1) * limit;

	try {
		const mainHashes = await getMainAncestrySet();

		let sql = `
			SELECT 
				r.hash,
				r.branch,
				r.summary,
				r.resolved_by_commit,
				r.validation_status,
				r.created_at,
				r.updated_at,
				rp.status as remediation_status
			FROM reports r
			LEFT JOIN remediation_plans rp ON r.hash = rp.commit_hash
		`;
		const params: unknown[] = [];

		if (branch && branch !== 'all') {
			if (branch.toLowerCase() === 'main' || branch.toLowerCase() === 'master') {
				const mainHashArr = Array.from(mainHashes).filter((h: string) => h.length === 40);
				params.push(branch, mainHashArr);
				sql += ` WHERE (r.branch = $1 OR r.hash = ANY($2::text[]))`;
			} else {
				params.push(branch);
				sql += ` WHERE r.branch = $1`;
			}
		}

		params.push(limit, offset);
		sql += ` ORDER BY COALESCE((r.summary->>'timestamp')::timestamptz, r.created_at) DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;

		const result = await query<any>(sql, params);

		const summaries = result.rows.map((row) => {
			const sum = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;
			const badges = sum.domain_badges || {
				TST: sum.category_scores?.test_integrity < 70 ? 'WARN' : 'PASS',
				API: 'PASS',
				UI: 'PASS',
				FIN: row.validation_status === 'FLAGGED' ? 'FAIL' : 'PASS',
				SYS: 'PASS',
				SEC: sum.category_scores?.safety < 70 ? 'FAIL' : 'PASS',
				OPS: sum.category_scores?.maintainability < 70 ? 'WARN' : 'PASS'
			};

			const parents: string[] = Array.isArray(sum.parents) && sum.parents.length > 0
				? sum.parents
				: Array.isArray(sum.parent_shas) && sum.parent_shas.length > 0
				? sum.parent_shas
				: [];

			return {
				...sum,
				hash: row.hash,
				branch: row.branch,
				validation_status: row.validation_status,
				domain_badges: badges,
				parents,
				parent_shas: parents,
				resolved_by_commit: row.resolved_by_commit,
				remediation_status: row.remediation_status || 'NONE',
				created_at: row.created_at,
				updated_at: row.updated_at
			};
		});

		// Ensure strictly newest first and oldest last by commit date
		summaries.sort((a, b) => {
			const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
			const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
			return timeB - timeA;
		});

		// Populate parents from GitHub if any are missing
		const needsParents = summaries.some((s) => !s.parents || s.parents.length === 0);
		if (needsParents) {
			try {
				const repoCommits = await getRepoCommits({ branch: branch || 'main', per_page: 50 });
				const parentMap = new Map<string, string[]>();
				for (const c of repoCommits) {
					if (c.parents && c.parents.length > 0) {
						parentMap.set(c.hash, c.parents);
						if (c.hash.length >= 7) {
							parentMap.set(c.hash.substring(0, 7), c.parents);
						}
					}
				}
				for (const s of summaries) {
					if (!s.parents || s.parents.length === 0) {
						const found = parentMap.get(s.hash) || [];
						if (found.length > 0) {
							s.parents = found;
							s.parent_shas = found;
						}
					}
				}
			} catch (githubErr) {
				console.warn('Could not fetch commit parents from GitHub in summary API:', githubErr);
			}
		}

		// Normalize branch attribution: ensure duplicate commits from older branches like 'main' are attributed to 'main'
		const normalizedSummaries = normalizeCommitBranches(summaries, 'main', mainHashes);
		const finalSummaries = branch && branch !== 'all'
			? normalizedSummaries.filter((s) => s.branch && s.branch.toLowerCase() === branch.toLowerCase())
			: normalizedSummaries;

		return json(finalSummaries);
	} catch (error: any) {
		console.error('Failed to get report summaries:', error);
		return json(
			{ error: 'Failed to retrieve report summaries', details: error.message },
			{ status: 500 }
		);
	}
};
