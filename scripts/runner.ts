import dotenv from 'dotenv';
import { getAllRepoCommits, getCommitDetails, getRepoBranches } from '../src/lib/github/client';
import { createCommitEvaluationGraph } from '../src/lib/runner/graph';
import { query } from '../src/lib/db/client';

dotenv.config();

async function runBatchEvaluation() {
	console.log('🚀 Starting Nova Orchestrator Batch Commit Evaluation Runner...');

	const allBranchesFlag = process.argv.includes('--all-branches');
	const nonMainFlag = process.argv.includes('--non-main-branches') || process.argv.includes('--non-main');
	const excludeBranchArg = process.argv.find((arg) => arg.startsWith('--exclude-branch='));
	const excludedBranches = excludeBranchArg
		? excludeBranchArg.split('=')[1].split(',')
		: nonMainFlag
			? ['main', 'master']
			: [];

	const branchArg = process.argv.find((arg) => arg.startsWith('--branch='));
	const positionalArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
	const targetSingleBranch = branchArg
		? branchArg.split('=')[1]
		: !allBranchesFlag && !nonMainFlag && positionalArg
			? positionalArg
			: null;

	const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
	const maxCommits = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
	const force = process.argv.includes('--force') || process.argv.includes('-f');
	const watch = process.argv.includes('--watch') || process.argv.includes('-w');
	const intervalArg = process.argv.find((arg) => arg.startsWith('--interval='));
	const pollIntervalSec = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 60;
	const includeMainCommits = process.argv.includes('--include-main-commits');

	interface CommitMeta {
		hash: string;
		author: string;
		email: string;
		timestamp: string;
		message: string;
		url: string;
		parents: string[];
		parent_shas: string[];
		branches: string[];
		primaryBranch: string;
	}

	async function performEvaluationPass(isForce: boolean = false) {
		let targetCommits: CommitMeta[] = [];

		if (targetSingleBranch) {
			console.log(`📌 Target Branch: ${targetSingleBranch}`);
			console.log(`Fetching ${maxCommits ? maxCommits : 'all'} commits from branch '${targetSingleBranch}'...`);
			let commits = await getAllRepoCommits({ branch: targetSingleBranch, maxCommits });

			// When evaluating a newer/feature branch, filter out commits already part of main ancestry
			if (targetSingleBranch !== 'main' && targetSingleBranch !== 'master' && !includeMainCommits) {
				console.log(`📡 Checking 'main' commit ancestry to isolate commits exclusive to '${targetSingleBranch}'...`);
				const mainCommits = await getAllRepoCommits({ branch: 'main' });
				const mainHashes = new Set(mainCommits.map((c) => c.hash));
				const beforeCount = commits.length;
				commits = commits.filter((c) => !mainHashes.has(c.hash));
				console.log(
					`🎯 Filtered out ${beforeCount - commits.length} base commits already in 'main'. Found ${commits.length} commit(s) exclusive to '${targetSingleBranch}'.`
				);
			}

			targetCommits = commits.map((c) => ({
				...c,
				branches: [targetSingleBranch],
				primaryBranch: targetSingleBranch
			}));
		} else {
			console.log(`🌐 Multi-Branch Evaluation Mode: Discovering active branches...`);
			let branches = await getRepoBranches();
			if (excludedBranches.length > 0) {
				branches = branches.filter((b) => !excludedBranches.includes(b));
				console.log(`🚫 Excluded branch(es): ${excludedBranches.join(', ')}`);
			}
			console.log(`📌 Target ${branches.length} branch(es): ${branches.join(', ')}`);

			const commitsMap = new Map<string, CommitMeta>();

			for (const b of branches) {
				console.log(`📡 Fetching commits for branch '${b}'...`);
				const bCommits = await getAllRepoCommits({ branch: b });
				for (const c of bCommits) {
					const existing = commitsMap.get(c.hash);
					if (existing) {
						if (!existing.branches.includes(b)) {
							existing.branches.push(b);
						}
					} else {
						commitsMap.set(c.hash, {
							...c,
							branches: [b],
							primaryBranch: b
						});
					}
				}
			}

			targetCommits = Array.from(commitsMap.values());

			// When targeting non-main branches, filter out commits already part of main ancestry
			if (nonMainFlag && !includeMainCommits) {
				console.log(`📡 Fetching 'main' commit hashes to isolate commits exclusive to non-main branches...`);
				const mainCommits = await getAllRepoCommits({ branch: 'main' });
				const mainHashes = new Set(mainCommits.map((c) => c.hash));
				const beforeCount = targetCommits.length;
				targetCommits = targetCommits.filter((c) => !mainHashes.has(c.hash));
				console.log(
					`🎯 Filtered out ${beforeCount - targetCommits.length} base commits from 'main'. Found ${targetCommits.length} commit(s) on non-main branches.`
				);
			}
		}

		// 1. Sort strictly in reverse-chronological order (from newest to oldest)
		targetCommits.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		if (maxCommits && maxCommits < targetCommits.length) {
			targetCommits = targetCommits.slice(0, maxCommits);
		}

		console.log(`Found ${targetCommits.length} total target commits across non-main branch(es).`);

		if (targetCommits.length === 0) {
			console.log('No new commits found to evaluate.');
			return;
		}

		// 2. Query existing reports to know which commits need evaluation
		const existingReportsRes = await query<{ hash: string; validation_status: string }>(
			`SELECT hash, validation_status FROM reports;`
		);
		const evaluatedHashes = new Set(
			existingReportsRes.rows.filter((r) => r.validation_status !== 'INCOMPLETE').map((r) => r.hash)
		);

		console.log(`${evaluatedHashes.size} commits already fully evaluated in Neon Postgres.`);

		if (isForce) {
			console.log('⚡ Force re-evaluation enabled: Re-running live evaluation across all commits.');
		}

		const pendingCommits = targetCommits.filter((c) => isForce || !evaluatedHashes.has(c.hash));
		console.log(`🎯 ${pendingCommits.length} commits awaiting evaluation.`);

		if (pendingCommits.length === 0) {
			console.log('✓ All target commits on non-main branches are already evaluated.');
			return;
		}

		// 3. Evaluate commits in reverse-chronological order (from most recent working backwards)
		const appGraph = createCommitEvaluationGraph();

		let evaluatedCount = 0;

		for (let i = 0; i < targetCommits.length; i++) {
			const commitSummary = targetCommits[i];
			const hash = commitSummary.hash;

			if (!isForce && evaluatedHashes.has(hash)) {
				console.log(`⏭️  Skipping commit ${hash.substring(0, 7)} (already evaluated).`);
				continue;
			}

			evaluatedCount++;
			console.log(
				`\n🔍 Evaluating commit [${evaluatedCount}/${pendingCommits.length}] (overall [${i + 1}/${targetCommits.length}]) ${hash.substring(0, 7)} [branch: ${commitSummary.primaryBranch}]: "${commitSummary.message.split('\n')[0]}"`
			);

			// Fetch full details & diff
			try {
				const details = await getCommitDetails(hash);

				// Subsequent commits (chronologically newer commits that came after this commit)
				const subsequentCommits = targetCommits.slice(0, i).map((c) => ({
					hash: c.hash,
					message: c.message,
					diffSummary: `Commit: ${c.hash.substring(0, 7)}`
				}));

				const result = await appGraph.invoke({
					commitHash: hash,
					branch: commitSummary.primaryBranch,
					author: details.author,
					timestamp: details.timestamp,
					commitMsg: details.message,
					diff: details.diff,
					parents: commitSummary.parents || details.parents || [],
					subsequentCommits
				});

				console.log(
					`✅ Completed evaluation for ${hash.substring(0, 7)}: Status = ${result.validationStatus}, Score = ${result.summary?.composite_score !== null ? result.summary?.composite_score : 'N/A (INCOMPLETE)'}`
				);

				// Inter-commit spacing to respect free-tier RPM quota
				await new Promise((resolve) => setTimeout(resolve, 3000));
			} catch (err: any) {
				console.error(`❌ Failed evaluating commit ${hash.substring(0, 7)}:`, err?.message || err);
				// Wait 5 seconds before trying next commit
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}
	}

	let isFirstPass = true;
	do {
		await performEvaluationPass(isFirstPass && force);
		isFirstPass = false;
		if (watch) {
			console.log(`\n⏳ [Watch Mode] Waiting ${pollIntervalSec}s before checking non-main branches for new commits...`);
			await new Promise((resolve) => setTimeout(resolve, pollIntervalSec * 1000));
		}
	} while (watch);

	console.log('\n🏁 Batch commit evaluation runner finished successfully.');
	process.exit(0);
}

runBatchEvaluation().catch((err) => {
	console.error('Fatal error in batch runner:', err);
	process.exit(1);
});
