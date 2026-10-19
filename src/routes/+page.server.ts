import type { PageServerLoad } from './$types';
import { query } from '$lib/db/client';
import { getRepoCommits, getRepoBranches } from '$lib/github/client';
import { normalizeCommitBranches } from '$lib/git/lineage';
import { getMainAncestrySet } from '$lib/server/lineage';

export const load: PageServerLoad = async ({ url }) => {
	const startTime = Date.now();
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
	const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10));
	const branchParam = url.searchParams.get('branch');
	const targetBranch = branchParam && branchParam !== 'all' ? branchParam : null;
	const selectedBranch = targetBranch || 'all';

	try {
		const mainHashes = await getMainAncestrySet();

		// 1. Fetch reports with remediation info
		let reportsSql = `
			SELECT 
				r.hash,
				r.branch,
				r.summary,
				r.resolved_by_commit,
				r.validation_status,
				r.created_at,
				r.updated_at,
				rp.status as remediation_status,
				rp.id as remediation_plan_id
			FROM reports r
			LEFT JOIN remediation_plans rp ON r.hash = rp.commit_hash
		`;
		const params: unknown[] = [];
		if (targetBranch) {
			if (targetBranch.toLowerCase() === 'main' || targetBranch.toLowerCase() === 'master') {
				const mainHashArr = Array.from(mainHashes).filter((h) => h.length === 40);
				params.push(targetBranch, mainHashArr);
				reportsSql += ` WHERE (r.branch = $1 OR r.hash = ANY($2::text[]))`;
			} else {
				params.push(targetBranch);
				reportsSql += ` WHERE r.branch = $1`;
			}
		}
		params.push(limit, (page - 1) * limit);
		reportsSql += ` ORDER BY COALESCE((r.summary->>'timestamp')::timestamptz, r.created_at) DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;
		const reportsRes = await query<any>(reportsSql, params);

		// 2. Fetch stats
		let statsSql = `
			SELECT 
				COUNT(*) as total_reports,
				COUNT(*) FILTER (WHERE validation_status = 'SAFE') as safe_count,
				COUNT(*) FILTER (WHERE validation_status = 'FLAGGED' AND resolved_by_commit IS NULL) as flagged_count,
				COUNT(*) FILTER (WHERE resolved_by_commit IS NOT NULL) as resolved_count
			FROM reports
		`;
		const statsParams: unknown[] = [];
		if (targetBranch) {
			if (targetBranch.toLowerCase() === 'main' || targetBranch.toLowerCase() === 'master') {
				const mainHashArr = Array.from(mainHashes).filter((h) => h.length === 40);
				statsParams.push(targetBranch, mainHashArr);
				statsSql += ` WHERE (branch = $1 OR hash = ANY($2::text[]));`;
			} else {
				const mainHashArr = Array.from(mainHashes).filter((h) => h.length === 40);
				statsParams.push(targetBranch, mainHashArr);
				statsSql += ` WHERE (branch = $1 AND NOT (hash = ANY($2::text[])));`;
			}
		} else {
			statsSql += `;`;
		}
		const statsRes = await query<any>(statsSql, statsParams);
		const totalReports = Number(statsRes.rows[0]?.total_reports) || reportsRes.rows.length;
		const totalPages = Math.max(1, Math.ceil(totalReports / limit));

		// 3. Fetch all branches across GitHub and DB reports
		let repoBranches: string[] = [];
		try {
			repoBranches = await getRepoBranches();
		} catch (err) {
			console.warn('Could not fetch repo branches from GitHub:', err);
		}
		const branchesRes = await query<{ branch: string }>(
			`SELECT DISTINCT branch FROM reports WHERE branch IS NOT NULL ORDER BY branch;`
		);
		const dbBranches = branchesRes.rows.map((r) => r.branch).filter(Boolean);
		const allBranches = Array.from(new Set([...repoBranches, ...dbBranches])).filter(Boolean);

		// 4. Fetch latest audit logs
		const auditSql = `
			SELECT id, action, actor, details, created_at
			FROM audit_logs
			ORDER BY created_at DESC
			LIMIT 10;
		`;
		const auditRes = await query<any>(auditSql);

		const summaries = reportsRes.rows.map((row) => {
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
				remediation_plan_id: row.remediation_plan_id || null,
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

		// If any commit summaries lack parent relations, fetch from GitHub
		const needsParents = summaries.some((s) => !s.parents || s.parents.length === 0);
		if (needsParents) {
			try {
				const repoCommits = await getRepoCommits({ branch: targetBranch || undefined, per_page: 50 });
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
				console.warn('Could not fetch commit parents from GitHub:', githubErr);
			}
		}

		// Normalize branch attribution: ensure duplicate commits from older branches like 'main' are attributed to 'main'
		const normalizedSummaries = normalizeCommitBranches(summaries, 'main', mainHashes);
		const finalSummaries = targetBranch && targetBranch !== 'all'
			? normalizedSummaries.filter((s) => s.branch && s.branch.toLowerCase() === targetBranch.toLowerCase())
			: normalizedSummaries;

		const latencyMs = Date.now() - startTime;

		return {
			branch: selectedBranch,
			selectedBranch,
			branches: allBranches,
			page,
			limit,
			totalReports,
			totalPages,
			latencyMs,
			summaries: finalSummaries,
			stats: statsRes.rows[0] || { total_reports: 0, safe_count: 0, flagged_count: 0, resolved_count: 0 },
			recentAuditLogs: auditRes.rows
		};
	} catch (error: any) {
		console.error('Error loading page data:', error);
		return {
			branch: selectedBranch,
			selectedBranch,
			branches: ['main', 'feature-dataAPI', 'feature-v3'],
			page,
			limit,
			totalReports: 0,
			totalPages: 1,
			latencyMs: Date.now() - startTime,
			summaries: [],
			stats: { total_reports: 0, safe_count: 0, flagged_count: 0, resolved_count: 0 },
			recentAuditLogs: [],
			error: error.message
		};
	}
};
