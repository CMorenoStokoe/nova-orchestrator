import { query } from '$lib/db/client';

let cachedMainAncestors: Set<string> | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Returns a Set containing all commit hashes (full SHA and 7-character prefix)
 * that belong to the base branch ('main' or 'master') or its ancestry graph.
 * Server-only: runs directly against Neon Postgres.
 */
export async function getMainAncestrySet(forceRefresh: boolean = false): Promise<Set<string>> {
	const now = Date.now();
	if (!forceRefresh && cachedMainAncestors && now - lastCacheTime < CACHE_TTL_MS) {
		return cachedMainAncestors;
	}

	try {
		const res = await query<{ hash: string; branch: string; summary: any }>(
			'SELECT hash, branch, summary FROM reports;'
		);

		const commitMap = new Map<string, { hash: string; branch: string; parents: string[] }>();
		const commits = res.rows.map((r) => {
			const sum = typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary || {};
			const parents: string[] =
				Array.isArray(sum.parents) && sum.parents.length > 0
					? sum.parents
					: Array.isArray(sum.parent_shas) && sum.parent_shas.length > 0
					? sum.parent_shas
					: [];
			return { hash: r.hash, branch: r.branch || 'main', parents };
		});

		commits.forEach((c) => {
			commitMap.set(c.hash, c);
			if (c.hash.length >= 7) commitMap.set(c.hash.substring(0, 7), c);
		});

		const baseAncestors = new Set<string>();
		const queue: string[] = [];

		for (const c of commits) {
			const b = (c.branch || '').toLowerCase();
			if (b === 'main' || b === 'master') {
				baseAncestors.add(c.hash);
				if (c.hash.length >= 7) baseAncestors.add(c.hash.substring(0, 7));
				queue.push(c.hash);
			}
		}

		while (queue.length > 0) {
			const currHash = queue.shift()!;
			const curr = commitMap.get(currHash);
			if (!curr) continue;
			for (const p of curr.parents) {
				const parent = commitMap.get(p) ?? commitMap.get(p.substring(0, 7));
				if (parent && !baseAncestors.has(parent.hash)) {
					baseAncestors.add(parent.hash);
					if (parent.hash.length >= 7) baseAncestors.add(parent.hash.substring(0, 7));
					queue.push(parent.hash);
				}
			}
		}

		cachedMainAncestors = baseAncestors;
		lastCacheTime = now;
		return baseAncestors;
	} catch (err) {
		console.warn('Failed to compute main ancestry set, fallback to empty:', err);
		return cachedMainAncestors || new Set<string>();
	}
}
