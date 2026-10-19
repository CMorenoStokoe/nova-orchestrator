import dotenv from 'dotenv';
import { query } from '../src/lib/db/client';
import { getCommitDetails } from '../src/lib/github/client';

dotenv.config();

const BASE_URL = 'http://localhost:5173';
const BEARER_TOKEN = process.env.INTERNAL_BEARER_SECRET || 'nova_bearer_secret_2026';

interface BenchmarkMetric {
	hash: string;
	shortHash: string;
	dbQueryMs: number;
	httpFullReportMs: number;
	payloadBytes: number;
	githubApiMs: number;
	diffBytes: number;
}

async function auditLatencies() {
	console.log('================================================================================');
	console.log('⚡ NOVA ORCHESTRATOR COMMIT DETAIL FETCH LATENCY AUDIT');
	console.log('================================================================================\n');

	// 1. Retrieve sample commits from Neon Postgres
	const reportsRes = await query<{ hash: string; validation_status: string }>(
		`SELECT hash, validation_status FROM reports ORDER BY created_at DESC LIMIT 8;`
	);

	if (reportsRes.rows.length === 0) {
		console.error('No reports found in database to audit.');
		process.exit(1);
	}

	const hashes = reportsRes.rows.map((r) => r.hash);
	console.log(`Auditing ${hashes.length} commits across:`);
	console.log(`- 1. Public API Endpoint: GET /v1/public/get/reports/full?hash={hash} (Dashboard View)`);
	console.log(`- 2. Direct Neon Postgres Query: SELECT ... FROM reports WHERE hash = $1`);
	console.log(`- 3. Private Agent Route / GitHub API: GET /v1/private/get/commit?hash={hash}\n`);

	const metrics: BenchmarkMetric[] = [];

	// Cold run test on first commit to measure cold-start vs warm
	const firstHash = hashes[0];
	console.log(`--- [Cold Request Baseline] ---`);
	const coldStart = performance.now();
	const coldRes = await fetch(`${BASE_URL}/v1/public/get/reports/full?hash=${firstHash}`);
	const coldDuration = performance.now() - coldStart;
	const coldJson = await coldRes.json();
	const coldSize = JSON.stringify(coldJson).length;
	console.log(`Cold HTTP /v1/public/get/reports/full: ${coldDuration.toFixed(2)}ms (HTTP ${coldRes.status}, size: ${(coldSize / 1024).toFixed(2)} KB)\n`);

	console.log(`--- [Multi-Commit Benchmark Run] ---`);
	for (let i = 0; i < hashes.length; i++) {
		const hash = hashes[i];
		const shortHash = hash.substring(0, 7);

		// Metric A: Direct Neon DB query latency
		const dbStart = performance.now();
		const dbResult = await query(
			`SELECT 
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
			WHERE r.hash = $1
			LIMIT 1;`,
			[hash]
		);
		const dbQueryMs = performance.now() - dbStart;

		// Metric B: HTTP Endpoint GET /v1/public/get/reports/full?hash={hash}
		const httpStart = performance.now();
		const httpRes = await fetch(`${BASE_URL}/v1/public/get/reports/full?hash=${hash}`);
		const httpFullReportMs = performance.now() - httpStart;
		const httpData = await httpRes.json();
		const payloadBytes = Buffer.byteLength(JSON.stringify(httpData), 'utf8');

		// Metric C: Raw GitHub commit diff fetch (via getCommitDetails / Octokit)
		let githubApiMs = 0;
		let diffBytes = 0;
		try {
			const ghStart = performance.now();
			const commitDetails = await getCommitDetails(hash);
			githubApiMs = performance.now() - ghStart;
			diffBytes = Buffer.byteLength(commitDetails.diff, 'utf8');
		} catch (err: any) {
			console.warn(`[GitHub API] Note: ${shortHash} not found in remote or rate limited: ${err.message}`);
		}

		metrics.push({
			hash,
			shortHash,
			dbQueryMs,
			httpFullReportMs,
			payloadBytes,
			githubApiMs,
			diffBytes
		});

		console.log(
			`Commit ${shortHash}: ` +
			`HTTP Full Report = ${httpFullReportMs.toFixed(1)}ms | ` +
			`DB Query = ${dbQueryMs.toFixed(1)}ms | ` +
			`Payload = ${(payloadBytes / 1024).toFixed(1)} KB` +
			(githubApiMs > 0 ? ` | GitHub API = ${githubApiMs.toFixed(1)}ms (${(diffBytes / 1024).toFixed(1)} KB diff)` : '')
		);
	}

	// Statistical calculations
	const httpTimes = metrics.map((m) => m.httpFullReportMs).sort((a, b) => a - b);
	const dbTimes = metrics.map((m) => m.dbQueryMs).sort((a, b) => a - b);
	const ghTimes = metrics.filter((m) => m.githubApiMs > 0).map((m) => m.githubApiMs).sort((a, b) => a - b);

	const avg = (arr: number[]) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
	const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
	const p95 = (arr: number[]) => arr[Math.floor(arr.length * 0.95)] || arr[arr.length - 1];

	console.log('\n================================================================================');
	console.log('📊 AUDIT SUMMARY & SLA COMPLIANCE REPORT');
	console.log('================================================================================\n');

	console.log('1. User-Facing Full Report Query (`GET /v1/public/get/reports/full`):');
	console.log(`   - Target SLA (<250ms Target): ${httpTimes.every((t) => t < 250) ? '✅ COMPLIANT' : '⚠️ EXCEEDED'}`);
	console.log(`   - Mean Latency:               ${avg(httpTimes).toFixed(2)} ms`);
	console.log(`   - Median (p50):               ${median(httpTimes).toFixed(2)} ms`);
	console.log(`   - 95th Percentile (p95):       ${p95(httpTimes).toFixed(2)} ms`);
	console.log(`   - Min / Max:                  ${httpTimes[0].toFixed(2)} ms / ${httpTimes[httpTimes.length - 1].toFixed(2)} ms`);
	console.log(`   - Average Payload Size:       ${(avg(metrics.map((m) => m.payloadBytes)) / 1024).toFixed(2)} KB\n`);

	console.log('2. Neon Postgres Database Query Layer:');
	console.log(`   - Mean DB Execution:          ${avg(dbTimes).toFixed(2)} ms`);
	console.log(`   - Median DB Execution:        ${median(dbTimes).toFixed(2)} ms`);
	console.log(`   - Min / Max DB Execution:     ${dbTimes[0].toFixed(2)} ms / ${dbTimes[dbTimes.length - 1].toFixed(2)} ms\n`);

	if (ghTimes.length > 0) {
		console.log('3. Upstream GitHub Raw Commit & Diff Fetch (`GET /v1/private/get/commit` / Octokit):');
		console.log(`   - Mean Latency:               ${avg(ghTimes).toFixed(2)} ms`);
		console.log(`   - Median (p50):               ${median(ghTimes).toFixed(2)} ms`);
		console.log(`   - Min / Max:                  ${ghTimes[0].toFixed(2)} ms / ${ghTimes[ghTimes.length - 1].toFixed(2)} ms\n`);
	}

	console.log('================================================================================');
	process.exit(0);
}

auditLatencies().catch((err) => {
	console.error('Audit failed with error:', err);
	process.exit(1);
});
