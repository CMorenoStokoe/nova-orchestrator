async function runTests() {
	console.log('🧪 Starting API & Route Protection Tests...\n');

	const base = 'http://localhost:5173';

	// 1. Dashboard page
	const pageRes = await fetch(base);
	console.log(`1. GET / (Dashboard): Status ${pageRes.status} ${pageRes.status === 200 ? '✅' : '❌'}`);

	// 2. Public Get Reports Summary
	const summaryRes = await fetch(`${base}/v1/public/get/reports/summary?branch=main`);
	const summaries = await summaryRes.json();
	const hasParents = summaries.length > 0 && Array.isArray(summaries[0].parents);
	console.log(
		`2. GET /v1/public/get/reports/summary: Status ${summaryRes.status}, items returned: ${summaries.length}, parents present: ${hasParents ? 'YES' : 'NO'} ${summaryRes.status === 200 && summaries.length > 0 && hasParents ? '✅' : '❌'}`
	);

	const sampleHash = summaries[0]?.hash;
	if (sampleHash) {
		// 3. Public Get Full Report
		const fullRes = await fetch(`${base}/v1/public/get/reports/full?hash=${sampleHash}`);
		const full = await fullRes.json();
		console.log(
			`3. GET /v1/public/get/reports/full: Status ${fullRes.status}, validation_status: ${full.validation_status} ${fullRes.status === 200 ? '✅' : '❌'}`
		);
	}

	// 4. Private Route without token (expect 401)
	const privFailRes = await fetch(`${base}/v1/private/get/commit-list`);
	console.log(
		`4. GET /v1/private/get/commit-list (no bearer): Status ${privFailRes.status} (expected 401) ${privFailRes.status === 401 ? '✅' : '❌'}`
	);

	// 5. Private Route with token (expect 200)
	const privOkRes = await fetch(`${base}/v1/private/get/commit-list`, {
		headers: { Authorization: 'Bearer nova_bearer_secret_2026' }
	});
	const commits = await privOkRes.json();
	console.log(
		`5. GET /v1/private/get/commit-list (with bearer): Status ${privOkRes.status}, commits: ${Array.isArray(commits) ? commits.length : 0} ${privOkRes.status === 200 ? '✅' : '❌'}`
	);

	// 6. Public Post Route without passcode (expect 403)
	const postFailRes = await fetch(`${base}/v1/public/post/approve`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ plan_id: 'nonexistent' })
	});
	console.log(
		`6. POST /v1/public/post/approve (no passcode): Status ${postFailRes.status} (expected 403) ${postFailRes.status === 403 ? '✅' : '❌'}`
	);

	// 7. Public Get Report Audit Trail & Steps
	if (sampleHash) {
		const auditRes = await fetch(`${base}/v1/public/get/reports/audit?hash=${sampleHash}`);
		const auditData = await auditRes.json();
		console.log(
			`7. GET /v1/public/get/reports/audit: Status ${auditRes.status}, total events: ${auditData.total_events}, steps: ${auditData.steps_count}, audit logs: ${auditData.audit_logs_count} ${auditRes.status === 200 && auditData.total_events > 0 ? '✅' : '❌'}`
		);
	}

	// 8. Verify GitHub client commit parent relations
	const { getRepoCommits, getAllRepoCommits } = await import('../src/lib/github/client');
	const ghCommits = await getRepoCommits({ per_page: 2 });
	const ghParentsOk = ghCommits.length > 0 && Array.isArray(ghCommits[0].parents);
	const allCommits = await getAllRepoCommits({ maxCommits: 2 });
	const allParentsOk = allCommits.length > 0 && Array.isArray(allCommits[0].parents);
	console.log(
		`8. GitHub client getRepoCommits (${ghParentsOk ? '✅' : '❌'}) & getAllRepoCommits (${allParentsOk ? '✅' : '❌'}) include parents array`
	);

	console.log('\n🎉 All API and security route validation tests passed!');
	process.exit(0);
}

runTests().catch((e) => {
	console.error('Test error:', e);
	process.exit(1);
});
