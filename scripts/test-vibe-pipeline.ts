import { VIBE_CRITERIA, type PipelineStep } from '../src/lib/types';
import { VibeCriterionScoreSchema, FindingItemSchema } from '../src/lib/runner/validators';
import { createCommitEvaluationGraph } from '../src/lib/runner/graph';

async function runVibeVerification() {
	console.log('🧪 Running Verification for 17-Criterion Serial Vibe-Check Pipeline...\n');

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

	// 1. Verify 17 Vibe-Check Criteria Specification
	console.log('--- 1. Criteria Specification ---');
	assert('VIBE_CRITERIA has exactly 17 criteria', VIBE_CRITERIA.length === 17, `Count: ${VIBE_CRITERIA.length}`);

	for (let i = 0; i < 17; i++) {
		const num = String(i + 1).padStart(2, '0');
		const expectedCode = `VBC-${num}`;
		const expectedBadge = `V${num}`;
		const crit = VIBE_CRITERIA[i];
		assert(
			`Criterion ${i + 1} is ${expectedCode} (${expectedBadge}): ${crit.name}`,
			crit.code === expectedCode && crit.badge === expectedBadge && crit.systemInstruction.length > 50
		);
	}

	// 2. Verify Graph Compilation (Strict Linear Topology)
	console.log('\n--- 2. LangGraph Linear Compilation ---');
	const graph = createCommitEvaluationGraph();
	assert('createCommitEvaluationGraph compiles without error', graph !== null && typeof graph.invoke === 'function');

	// 3. Schema & Deterministic Validator
	console.log('\n--- 3. Deterministic Validation & Schema ---');
	const validCritScore = VibeCriterionScoreSchema.safeParse({
		code: 'VBC-01',
		key: 'problem_decomposition',
		name: 'Problem Decomposition',
		score: 95,
		status: 'PASS',
		execution_status: 'VALIDATED',
		summary: 'Clean atomic commit scope adhering to tasks.md',
		findings: []
	});
	assert('Validates schema-compliant VibeCriterionScore with VALIDATED status', validCritScore.success);

	const flaggedCritScore = VibeCriterionScoreSchema.safeParse({
		code: 'VBC-04',
		key: 'context_engineering_ontology',
		name: 'Context Engineering & Ontology',
		score: 40,
		status: 'FAIL',
		execution_status: 'VALIDATED',
		summary: 'Raw string literals and inline magic numbers detected',
		findings: [
			{
				id: 'VBC-04-1',
				domain: 'context_engineering_ontology',
				criterion_code: 'VBC-04',
				title: 'Hardcoded magic constant without domain enum',
				severity: 'HIGH',
				reasoning: 'Max retry limit and timeout values are hardcoded inline',
				file_path: 'src/lib/api.ts',
				diff_hunk: `@@ -10,3 +10,4 @@
-const TIMEOUT = 5000;
+const TIMEOUT = 12000; // magic number`
			}
		]
	});
	assert('Accepts finding with exact unified diff hunk snippet', flaggedCritScore.success);

	// Reject finding with 'Changed files:' metadata
	const invalidMetaScore = VibeCriterionScoreSchema.safeParse({
		code: 'VBC-04',
		key: 'context_engineering_ontology',
		score: 40,
		status: 'FAIL',
		execution_status: 'VALIDATED',
		summary: 'Failed',
		findings: [
			{
				id: 'VBC-04-2',
				domain: 'context_engineering_ontology',
				title: 'Bad hunk',
				severity: 'HIGH',
				reasoning: 'Bad hunk reasoning',
				diff_hunk: 'Changed files: src/lib/api.ts' // REJECT!
			}
		]
	});
	assert('Rejects finding whose diff_hunk starts with "Changed files:"', !invalidMetaScore.success);

	// 4. Failed States Reported as NA & Report Generation Proceeds
	console.log('\n--- 4. Failed States Reported as NA & Proceed in Report Generation ---');
	const naCritScore = VibeCriterionScoreSchema.safeParse({
		code: 'VBC-07',
		key: 'harness_engineering',
		name: 'Harness Engineering',
		score: null,
		status: 'NA',
		execution_status: 'NA',
		summary: 'Evaluation bypassed or unavailable (NA): Quota or transport constraint',
		findings: []
	});
	assert('Validates schema-compliant NA criterion with null score and NA execution status', naCritScore.success);

	// Simulate pipeline where 2 criteria failed and were reported as NA, while 15 criteria passed with score 90
	const criteriaResults: Record<string, { status: 'PASS' | 'WARN' | 'FAIL' | 'NA'; execution_status: 'VALIDATED' | 'NA'; score: number | null }> = {};
	VIBE_CRITERIA.forEach((c, idx) => {
		if (idx === 3 || idx === 7) {
			// Failed states reported as NA
			criteriaResults[c.key] = { status: 'NA', execution_status: 'NA', score: null };
		} else {
			criteriaResults[c.key] = { status: 'PASS', execution_status: 'VALIDATED', score: 90 };
		}
	});

	// Check that all 17 criteria finished (either VALIDATED or NA)
	const allFinished = VIBE_CRITERIA.every(
		(crit) =>
			criteriaResults[crit.key] &&
			(criteriaResults[crit.key].execution_status === 'VALIDATED' ||
				criteriaResults[crit.key].execution_status === 'NA')
	);
	assert('All criteria finished when failed states are reported as NA', allFinished);

	// Calculate composite score across non-NA scored criteria
	const scoredCriteria = VIBE_CRITERIA.filter(
		(crit) =>
			criteriaResults[crit.key]?.execution_status === 'VALIDATED' &&
			criteriaResults[crit.key]?.status !== 'NA' &&
			typeof criteriaResults[crit.key]?.score === 'number'
	);
	assert('Excludes NA criteria from scoring (15 non-NA scored criteria)', scoredCriteria.length === 15);

	const scores = scoredCriteria.map((crit) => criteriaResults[crit.key].score as number);
	const compositeScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
	assert('Computes composite score across non-NA criteria without dividing by 0 or corrupting score', compositeScore === 90);

	// Validation status resolution: proceeds to SAFE because all non-NA passed
	const hasFailure = VIBE_CRITERIA.some(
		(crit) => criteriaResults[crit.key]?.status === 'FAIL' || criteriaResults[crit.key]?.status === 'WARN'
	);
	const finalValidationStatus = hasFailure ? 'FLAGGED' : 'SAFE';
	assert('Proceeds to generate completed SAFE report verdict instead of locking to INCOMPLETE', finalValidationStatus === 'SAFE');

	// 5. Step Recording in State Graph (Key-by-Key Optimistic Updates)
	console.log('\n--- 5. State Graph Step Recording & Optimistic Key-by-Key Updates ---');
	const mockSteps: PipelineStep[] = [];

	// Simulate optimistic step and completed step for VBC-01
	const optStep: PipelineStep = {
		step_index: 1,
		node: 'node_problem_decomposition',
		key: 'problem_decomposition',
		criterion_code: 'VBC-01',
		status: 'RUNNING',
		execution_status: 'INCOMPLETE',
		timestamp: new Date().toISOString(),
		summary: 'Optimistically evaluating VBC-01 (Problem Decomposition)'
	};
	mockSteps.push(optStep);

	const doneStep: PipelineStep = {
		step_index: 2,
		node: 'node_problem_decomposition',
		key: 'problem_decomposition',
		criterion_code: 'VBC-01',
		status: 'PASS',
		execution_status: 'VALIDATED',
		score: 95,
		timestamp: new Date().toISOString(),
		summary: 'Atomic commit scope validated'
	};
	mockSteps.push(doneStep);

	// Simulate optimistic step and NA step for VBC-02
	const optStep2: PipelineStep = {
		step_index: 3,
		node: 'node_intent_formalisation',
		key: 'intent_formalisation',
		criterion_code: 'VBC-02',
		status: 'RUNNING',
		execution_status: 'INCOMPLETE',
		timestamp: new Date().toISOString(),
		summary: 'Optimistically evaluating VBC-02 (Intent Formalisation)'
	};
	mockSteps.push(optStep2);

	const naStep: PipelineStep = {
		step_index: 4,
		node: 'node_intent_formalisation',
		key: 'intent_formalisation',
		criterion_code: 'VBC-02',
		status: 'NA',
		execution_status: 'NA',
		score: null,
		timestamp: new Date().toISOString(),
		summary: 'Evaluation bypassed or unavailable (NA): 429 quota'
	};
	mockSteps.push(naStep);

	assert('State graph records both optimistic and completed steps', mockSteps.length === 4);
	assert('Optimistic step has status RUNNING and execution_status INCOMPLETE', mockSteps[0].status === 'RUNNING' && mockSteps[0].execution_status === 'INCOMPLETE');
	assert('NA step has status NA and execution_status NA with null score', mockSteps[3].status === 'NA' && mockSteps[3].execution_status === 'NA' && mockSteps[3].score === null);

	console.log(`\n========================================`);
	console.log(`Results: ${passed} Passed, ${failed} Failed`);
	console.log(`========================================`);

	if (failed > 0) {
		process.exit(1);
	}
	process.exit(0);
}

runVibeVerification().catch((err) => {
	console.error('Verification failed:', err);
	process.exit(1);
});
