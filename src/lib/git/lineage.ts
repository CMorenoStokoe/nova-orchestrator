/**
 * Client-safe pure graph utilities for Git branch attribution and lineage.
 * Zero database, network, or server dependencies.
 */

/**
 * In-memory normalization of commit branch attribution given a set of commits:
 * If a commit is an ancestor of 'main', its effective branch is attributed to 'main'.
 */
export function normalizeCommitBranches<
	T extends { hash: string; branch?: string; parents?: string[]; parent_shas?: string[] }
>(commits: T[], baseBranch: string = 'main', knownMainHashes?: Set<string>): T[] {
	if (!commits || commits.length === 0) return commits;

	const commitMap = new Map<string, T>();
	commits.forEach((c) => {
		commitMap.set(c.hash, c);
		if (c.hash.length >= 7) {
			commitMap.set(c.hash.substring(0, 7), c);
		}
	});

	const baseAncestors = new Set<string>(knownMainHashes || []);
	const queue: string[] = [];

	commits.forEach((c) => {
		const b = (c.branch || '').toLowerCase();
		if (b === baseBranch.toLowerCase() || b === 'main' || b === 'master') {
			baseAncestors.add(c.hash);
			if (c.hash.length >= 7) baseAncestors.add(c.hash.substring(0, 7));
			queue.push(c.hash);
		}
	});

	while (queue.length > 0) {
		const currHash = queue.shift()!;
		const curr = commitMap.get(currHash);
		if (!curr) continue;
		const parents = curr.parents || curr.parent_shas || [];
		for (const p of parents) {
			const parentCommit = commitMap.get(p) ?? commitMap.get(p.substring(0, 7));
			if (parentCommit && !baseAncestors.has(parentCommit.hash)) {
				baseAncestors.add(parentCommit.hash);
				if (parentCommit.hash.length >= 7) baseAncestors.add(parentCommit.hash.substring(0, 7));
				queue.push(parentCommit.hash);
			}
		}
	}

	return commits.map((c) => {
		if (baseAncestors.has(c.hash) || (c.hash.length >= 7 && baseAncestors.has(c.hash.substring(0, 7)))) {
			if (c.branch !== baseBranch) {
				return { ...c, branch: baseBranch };
			}
		}
		return c;
	});
}
