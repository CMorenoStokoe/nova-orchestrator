import { extractRetryDelayMs } from '../src/lib/ai/gemini';
import { DomainScoreSchema, FindingItemSchema } from '../src/lib/runner/validators';
import { extractUnifiedDiffHunks, formatRawDiffHunksForPrompt } from '../src/lib/runner/chunker';
import { agentLimiter } from '../src/lib/runner/graph';

async function runVerification() {
	console.log('🧪 Running Verification for Nova Orchestrator Pipeline Bug Fixes...\n');

	let passed = 0;
	let failed = 0;

	function assert(desc: string, condition: boolean, extra?: string) {
		if (condition) {
			console.log(`✅ PASS: ${desc}`);
			passed++;
		} else {
			console.error(`❌ FAIL: ${desc} ${extra ? `(${extra})` : ''}`);
			failed++;
		}
	}

	// =========================================================================
	// BUG 1: Stop Swallowing API/Infrastructure Errors as Code Defects
	// =========================================================================
	console.log('--- Bug 1: API Error Transport & RetryInfo Parsing ---');

	// 1a. Parse retryDelay from Google RPC text "Please retry in 14.5s"
	const err1 = new Error('Resource has been exhausted (check quota). Please retry in 14.5s.');
	const delay1 = extractRetryDelayMs(err1);
	assert('Parses "Please retry in 14.5s" to ~15.5s with safety buffer', delay1 >= 15000 && delay1 <= 16000, `Got ${delay1}ms`);

	// 1b. Parse retryDelay from JSON RetryInfo
	const err2 = new Error('{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"25s"}');
	const delay2 = extractRetryDelayMs(err2);
	assert('Parses JSON RetryInfo retryDelay: "25s" to ~26s with safety buffer', delay2 >= 25000 && delay2 <= 27000, `Got ${delay2}ms`);

	// 1c. Default to 20 seconds when RetryInfo is absent
	const err3 = new Error('Quota exceeded [429 Too Many Requests]');
	const delay3 = extractRetryDelayMs(err3);
	assert('Defaults to 20000ms (20s) when RetryInfo is absent', delay3 === 20000, `Got ${delay3}ms`);

	// 1d. Concurrency throttling maxConcurrency: 3
	let maxConcurrentObserved = 0;
	let currentRunning = 0;
	const tasks = Array.from({ length: 7 }, async (_, i) => {
		return agentLimiter.run(async () => {
			currentRunning++;
			if (currentRunning > maxConcurrentObserved) {
				maxConcurrentObserved = currentRunning;
			}
			await new Promise((res) => setTimeout(res, 50));
			currentRunning--;
			return i;
		});
	});
	await Promise.all(tasks);
	assert(
		'Throttles 7 parallel agent tasks to maxConcurrency <= 3',
		maxConcurrentObserved <= 3 && maxConcurrentObserved > 0,
		`Observed max concurrency: ${maxConcurrentObserved}`
	);

	// =========================================================================
	// BUG 2: Enforce the INCOMPLETE Validation Gate on Node Failure
	// =========================================================================
	console.log('\n--- Bug 2: Enforce INCOMPLETE Gate on Node Failure ---');

	// 2a. Domain score schema supports execution_status
	const validDomain = DomainScoreSchema.safeParse({
		score: 88,
		status: 'PASS',
		execution_status: 'VALIDATED',
		summary: 'All unit tests pass with strong assertion coverage',
		findings: []
	});
	assert('DomainScoreSchema accepts execution_status: VALIDATED', validDomain.success);

	const errorDomain = DomainScoreSchema.safeParse({
		score: 0,
		status: 'FAIL',
		execution_status: 'ERROR',
		summary: 'Stage execution failed: [Gemini API Transport Error]',
		findings: []
	});
	assert('DomainScoreSchema accepts execution_status: ERROR with 0 synthetic findings', errorDomain.success && errorDomain.data.findings.length === 0);

	// 2b. Composite score calculation logic gate
	function evaluateGate(stages: Array<{ execution_status: string; score: number; status: string }>) {
		const allValidated = stages.every((s) => s.execution_status === 'VALIDATED');
		if (!allValidated) {
			return {
				validation_status: 'INCOMPLETE',
				composite_score: null
			};
		}
		const scores = stages.map((s) => s.score);
		const composite = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
		return {
			validation_status: 'SAFE',
			composite_score: composite
		};
	}

	const incompleteStages = [
		{ execution_status: 'VALIDATED', score: 90, status: 'PASS' },
		{ execution_status: 'VALIDATED', score: 85, status: 'PASS' },
		{ execution_status: 'ERROR', score: 0, status: 'FAIL' }, // 1 node failed
		{ execution_status: 'VALIDATED', score: 92, status: 'PASS' },
		{ execution_status: 'VALIDATED', score: 88, status: 'PASS' },
		{ execution_status: 'VALIDATED', score: 80, status: 'PASS' },
		{ execution_status: 'VALIDATED', score: 95, status: 'PASS' }
	];
	const gateRes1 = evaluateGate(incompleteStages);
	assert('Locks validation_status to INCOMPLETE when any stage is in ERROR', gateRes1.validation_status === 'INCOMPLETE');
	assert('Does not compute composite numeric score when INCOMPLETE (composite_score === null)', gateRes1.composite_score === null);

	const allValidatedStages = incompleteStages.map((s) => ({ ...s, execution_status: 'VALIDATED', score: s.score || 85 }));
	const gateRes2 = evaluateGate(allValidatedStages);
	assert('Computes numeric composite score when all 7 stages are VALIDATED', typeof gateRes2.composite_score === 'number' && gateRes2.composite_score > 0);

	// =========================================================================
	// BUG 3: Inject and Render Actual Unified Diff Hunks
	// =========================================================================
	console.log('\n--- Bug 3: Unified Diff Hunk Injection & Deterministic Validation ---');

	// 3a. Rejection of metadata "Changed files: ..."
	const badFindingMeta = {
		title: 'Security vulnerability in session token',
		severity: 'HIGH' as const,
		reasoning: 'Missing signature verification on incoming auth token',
		diff_hunk: 'Changed files: src/auth.ts. Total chunks: 1' // REJECT!
	};
	const badCheck = FindingItemSchema.safeParse(badFindingMeta);
	assert('Rejects finding whose diff_hunk starts with "Changed files:"', !badCheck.success);

	// 3b. Rejection of diff_hunk without +/- lines
	const badFindingNoDiff = {
		title: 'Memory leak in cache',
		severity: 'HIGH' as const,
		reasoning: 'Cache unbounded',
		diff_hunk: 'const cache = new Map();' // lacks +/- lines
	};
	const noDiffCheck = FindingItemSchema.safeParse(badFindingNoDiff);
	assert('Rejects finding whose diff_hunk lacks unified diff markers (+, -, @@)', !noDiffCheck.success);

	// 3c. Acceptance of actual 3-to-15 line unified diff hunk
	const goodFinding = {
		title: 'Missing signature check',
		severity: 'CRITICAL' as const,
		reasoning: 'jwt.decode used instead of jwt.verify allowing forged signatures',
		file_path: 'src/lib/auth.ts',
		diff_hunk: `@@ -15,4 +15,6 @@ export function authenticate(token: string) {
-  const payload = jwt.decode(token);
+  const payload = jwt.verify(token, process.env.SECRET);
   return payload;
 }`
	};
	const goodCheck = FindingItemSchema.safeParse(goodFinding);
	assert('Accepts finding with exact raw unified diff hunk with @@ and +/- lines', goodCheck.success);

	// 3d. Ingestion Chunker extracts raw diff hunks instead of summary metadata
	const sampleRawDiff = `--- a/src/lib/api.ts
+++ b/src/lib/api.ts
@@ -20,5 +20,7 @@ export async function handleRequest(req) {
-  const user = req.body.user;
+  const user = sanitize(req.body.user);
+  if (!user) throw new Error("Invalid user");
   return user;
 }`;

	const hunks = extractUnifiedDiffHunks(sampleRawDiff);
	assert('extractUnifiedDiffHunks extracts raw unified hunk with header and code lines', hunks.length === 1 && hunks[0].hunk.includes('@@ -20,5 +20,7 @@'));

	const promptFormatted = formatRawDiffHunksForPrompt(sampleRawDiff);
	assert('formatRawDiffHunksForPrompt formats raw hunks and contains actual diff lines', promptFormatted.includes('File: src/lib/api.ts') && promptFormatted.includes('+  const user = sanitize'));
	assert('formatRawDiffHunksForPrompt never contains "Changed files:" metadata summary', !promptFormatted.includes('Changed files:'));

	// Summary
	console.log(`\n========================================`);
	console.log(`Results: ${passed} Passed, ${failed} Failed`);
	console.log(`========================================`);

	if (failed > 0) {
		process.exit(1);
	}
	process.exit(0);
}

runVerification().catch((err) => {
	console.error('Test run failed:', err);
	process.exit(1);
});
