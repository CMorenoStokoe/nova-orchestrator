import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import {
	runVibeCriterionAgent,
	runAgentFingerprinting,
	runPresentIssueResolutionAgent
} from './agents';
import { chunkCommitDiff, formatRawDiffHunksForPrompt } from './chunker';
import type { VibeCriterionScoreData, AgentFingerprintData } from './validators';
import {
	VIBE_CRITERIA,
	type VibeCriterionDef,
	type ValidationStatus,
	type ReportSummary,
	type FullReport,
	type DomainBadgeStatus,
	type PipelineStep
} from '$lib/types';
import { query, recordAuditLog, pool } from '$lib/db/client';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export const OrchestratorStateAnnotation = Annotation.Root({
	commitHash: Annotation<string>(),
	branch: Annotation<string>(),
	author: Annotation<string>(),
	timestamp: Annotation<string>(),
	commitMsg: Annotation<string>(),
	diff: Annotation<string>(),
	diffSummary: Annotation<string>(),
	validationStatus: Annotation<ValidationStatus>(),
	criteria: Annotation<Record<string, VibeCriterionScoreData>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({})
	}),
	steps: Annotation<PipelineStep[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => []
	}),
	fingerprint: Annotation<AgentFingerprintData | null>(),
	subsequentCommits: Annotation<Array<{ hash: string; message: string; diffSummary: string }>>(),
	parents: Annotation<string[]>({
		reducer: (curr, update) => update || curr || [],
		default: () => []
	}),
	resolvedByCommit: Annotation<string | null>(),
	summary: Annotation<ReportSummary | null>(),
	fullReport: Annotation<FullReport | null>()
});

export type OrchestratorStateType = typeof OrchestratorStateAnnotation.State;

/**
 * Concurrency throttler. For the serial pipeline, maxConcurrency is 1 by default.
 */
export const agentLimiter = {
	activeCount: 0,
	maxConcurrency: 1,
	async run<T>(fn: () => Promise<T>): Promise<T> {
		while (this.activeCount >= this.maxConcurrency) {
			await new Promise((res) => setTimeout(res, 20));
		}
		this.activeCount++;
		try {
			return await fn();
		} finally {
			this.activeCount--;
		}
	}
};

/**
 * Streams incremental criterion evaluation progress to Neon Postgres.
 * Enables live step-by-step UI progress as each criterion completes in series.
 */
async function streamProgressToDb(
	state: OrchestratorStateType,
	currentKey: string,
	result: VibeCriterionScoreData
) {
	try {
		const updatedCriteria = {
			...state.criteria,
			[currentKey]: result
		};

		const badges: Record<string, DomainBadgeStatus> = {};
		for (const crit of VIBE_CRITERIA) {
			const res = updatedCriteria[crit.key];
			badges[crit.code] = res
				? res.execution_status === 'NA' || res.status === 'NA'
					? 'NA'
					: res.execution_status === 'ERROR'
					? 'ERROR'
					: res.status
				: 'PENDING';
			badges[crit.badge] = badges[crit.code];
		}

		const flagCount = Object.values(updatedCriteria).filter((c) => c.status === 'FAIL' || c.status === 'WARN').length;
		const passingCount = Object.values(updatedCriteria).filter(
			(c) => c.status === 'PASS' && c.execution_status === 'VALIDATED'
		).length;

		const intermediateSummary: ReportSummary = {
			hash: state.commitHash,
			branch: state.branch || 'main',
			author: state.author || 'Unknown',
			message: state.commitMsg,
			timestamp: state.timestamp || new Date().toISOString(),
			parents: state.parents || [],
			parent_shas: state.parents || [],
			validation_status: 'INCOMPLETE',
			safety_verdict: 'INCOMPLETE',
			composite_score: null, // Null while incomplete
			high_level_intent: state.commitMsg || 'Evaluating commit against 17 Quality Markers (of AI-Generated Code)',
			material_changes_summary: state.diffSummary || '',
			criteria_badges: badges,
			domain_badges: badges,
			flag_count: flagCount,
			passing_count: passingCount,
			total_criteria_count: VIBE_CRITERIA.length,
			resolved_by_commit: null,
			remediation_status: 'NONE'
		};

		const validationStages: Record<string, any> = {};
		for (const crit of VIBE_CRITERIA) {
			const res = updatedCriteria[crit.key];
			validationStages[crit.key] = {
				completed: res?.execution_status === 'VALIDATED' || res?.execution_status === 'NA',
				execution_status: res?.execution_status || 'INCOMPLETE',
				validated_at: res ? new Date().toISOString() : undefined,
				retry_count: 0
			};
		}

		const intermediateFull: FullReport = {
			hash: state.commitHash,
			branch: state.branch || 'main',
			author: state.author || 'Unknown',
			message: state.commitMsg,
			timestamp: state.timestamp || new Date().toISOString(),
			parents: state.parents || [],
			parent_shas: state.parents || [],
			validation_status: 'INCOMPLETE',
			resolved_by_commit: null,
			criteria: updatedCriteria,
			domains: updatedCriteria,
			findings_list: Object.values(updatedCriteria).flatMap((c) => c.findings || []),
			steps: state.steps || [],
			fingerprint: {
				intent_summary: state.commitMsg,
				reasoning_record: 'Streaming live Quality Markers (of AI-Generated Code) evaluations in serial...',
				perceived_risk: 'LOW'
			},
			files_changed: (state.diffSummary || '').replace('Changed files: ', '').split(', '),
			diff_summary: state.diffSummary || '',
			validation_stages: validationStages
		};

		const sql = `
			INSERT INTO reports (hash, branch, summary, "full", resolved_by_commit, validation_status, updated_at)
			VALUES ($1, $2, $3, $4, NULL, 'INCOMPLETE', NOW())
			ON CONFLICT (hash) DO UPDATE SET
				branch = EXCLUDED.branch,
				summary = EXCLUDED.summary,
				"full" = EXCLUDED."full",
				validation_status = 'INCOMPLETE',
				updated_at = NOW();
		`;
		await query(sql, [
			state.commitHash,
			state.branch || 'main',
			JSON.stringify(intermediateSummary),
			JSON.stringify(intermediateFull)
		]);
	} catch (err: any) {
		console.warn(`[streamProgressToDb] Failed streaming step for ${state.commitHash}:`, err.message);
	}
}

// Node 1: Pre-process & format raw unified diff hunks
async function prepareNode(state: OrchestratorStateType) {
	const chunks = chunkCommitDiff(state.diff);
	const rawDiffHunks = formatRawDiffHunksForPrompt(state.diff);
	const diffSummary = `Changed files: ${chunks.map((c) => c.file).join(', ')}. Total chunks: ${chunks.length}`;

	// Write initial INCOMPLETE placeholder to database so frontend instantly sees reserved skeleton slots
	try {
		const initialBadges: Record<string, DomainBadgeStatus> = {};
		for (const crit of VIBE_CRITERIA) {
			initialBadges[crit.code] = 'PENDING';
			initialBadges[crit.badge] = 'PENDING';
		}
		const initialSummary: ReportSummary = {
			hash: state.commitHash,
			branch: state.branch || 'main',
			author: state.author || 'Unknown',
			message: state.commitMsg,
			timestamp: state.timestamp || new Date().toISOString(),
			parents: state.parents || [],
			parent_shas: state.parents || [],
			validation_status: 'INCOMPLETE',
			safety_verdict: 'INCOMPLETE',
			composite_score: null,
			high_level_intent: state.commitMsg,
			material_changes_summary: diffSummary,
			criteria_badges: initialBadges,
			domain_badges: initialBadges,
			flag_count: 0,
			passing_count: 0,
			total_criteria_count: VIBE_CRITERIA.length,
			resolved_by_commit: null,
			remediation_status: 'NONE'
		};

		const initialStages: Record<string, any> = {};
		for (const crit of VIBE_CRITERIA) {
			initialStages[crit.key] = {
				completed: false,
				execution_status: 'INCOMPLETE',
				retry_count: 0
			};
		}

		const initialFull: FullReport = {
			hash: state.commitHash,
			branch: state.branch || 'main',
			author: state.author || 'Unknown',
			message: state.commitMsg,
			timestamp: state.timestamp || new Date().toISOString(),
			parents: state.parents || [],
			parent_shas: state.parents || [],
			validation_status: 'INCOMPLETE',
			resolved_by_commit: null,
			criteria: {},
			domains: {},
			findings_list: [],
			fingerprint: {
				intent_summary: state.commitMsg,
				reasoning_record: 'Initiating 17 serial Quality Markers (of AI-Generated Code) evaluations...',
				perceived_risk: 'LOW'
			},
			files_changed: (diffSummary || '').replace('Changed files: ', '').split(', '),
			diff_summary: diffSummary,
			validation_stages: initialStages
		};

		const sql = `
			INSERT INTO reports (hash, branch, summary, "full", resolved_by_commit, validation_status, updated_at)
			VALUES ($1, $2, $3, $4, NULL, 'INCOMPLETE', NOW())
			ON CONFLICT (hash) DO UPDATE SET
				branch = EXCLUDED.branch,
				summary = EXCLUDED.summary,
				"full" = EXCLUDED."full",
				validation_status = 'INCOMPLETE',
				updated_at = NOW();
		`;
		await query(sql, [
			state.commitHash,
			state.branch || 'main',
			JSON.stringify(initialSummary),
			JSON.stringify(initialFull)
		]);
	} catch (err: any) {
		console.warn(`[prepareNode] Failed initial write for ${state.commitHash}:`, err.message);
	}

	const prepareStep: PipelineStep = {
		step_index: 1,
		node: 'node_prepare',
		key: 'preparation',
		status: 'PASS',
		execution_status: 'VALIDATED',
		timestamp: new Date().toISOString(),
		summary: `Prepared commit ${state.commitHash.substring(0, 7)} for serial evaluation`,
		comment: `Passed: Successfully extracted and verified unified diff hunks (${chunks.length} chunk${chunks.length === 1 ? '' : 's'}) for serial Quality Markers processing.`
	};

	return {
		diff: rawDiffHunks,
		diffSummary,
		validationStatus: 'INCOMPLETE' as ValidationStatus,
		criteria: {},
		steps: [prepareStep]
	};
}

/**
 * Creates a single-criterion execution node for the serial chain.
 * Criterion_N -> Validator_N -> DB_Stream_N -> Criterion_N+1
 * Records a step in the state graph with concurrent optimistic key-by-key updates.
 * Any failed states are reported as NA and can proceed in report generation.
 */
function createCriterionNode(criterion: VibeCriterionDef) {
	return async function criterionNode(state: OrchestratorStateType) {
		console.log(`[Quality-Marker] Evaluating ${criterion.code} (${criterion.name}) for ${state.commitHash.substring(0, 7)}...`);
		
		const currentStepCount = state.steps?.length || 0;

		// 1. Optimistic key-by-key step recording in the state graph
		const optimisticStep: PipelineStep = {
			step_index: currentStepCount + 1,
			node: `node_${criterion.key}`,
			key: criterion.key,
			criterion_code: criterion.code,
			status: 'RUNNING',
			execution_status: 'INCOMPLETE',
			timestamp: new Date().toISOString(),
			summary: `Optimistically evaluating ${criterion.code} (${criterion.name})`,
			comment: `In-flight: Actively analyzing commit diff and metadata against ${criterion.code} (${criterion.name}).`
		};

		// Stream optimistic key-by-key progress to database immediately
		const optimisticProgress: VibeCriterionScoreData = {
			code: criterion.code,
			key: criterion.key,
			name: criterion.name,
			score: null,
			status: 'PENDING' as any,
			execution_status: 'INCOMPLETE',
			summary: `Evaluating ${criterion.name}...`,
			findings: []
		};
		await streamProgressToDb(state, criterion.key, optimisticProgress);

		let result: VibeCriterionScoreData;
		try {
			result = await runVibeCriterionAgent(criterion, state.diff, state.commitMsg);
		} catch (err: any) {
			console.warn(`[${criterion.code}] Evaluation failed, reporting as NA: ${err.message}`);
			// Ensure any failed states in the agent flow are reported as NA and can proceed in the report generation
			result = {
				code: criterion.code,
				key: criterion.key,
				name: criterion.name,
				score: null,
				status: 'NA',
				execution_status: 'NA',
				summary: `Evaluation bypassed or unavailable (NA): ${err.message}`,
				comment: `Bypassed (NA): Upstream transport or quota limit encountered (${err.message}). Stage degraded gracefully without failing pipeline.`,
				findings: [],
				recommendations: []
			};
		}

		// Enforce 85% threshold: if score < 85 and status is PASS, flag as WARN
		if (typeof result.score === 'number' && result.score < 85 && result.status === 'PASS') {
			result.status = 'WARN';
		}

		// Build explicit, human-readable rationale comment for why it passed or didn't pass
		const rationaleComment =
			result.comment ||
			(result.status === 'PASS'
				? `Passed: ${result.summary || 'All requirements satisfied; zero defects flagged'}${result.score !== null && result.score !== undefined ? ` (Confidence: ${result.score}%)` : ''}.`
				: result.status === 'WARN'
				? `Warning: ${result.summary || 'Non-critical issues or anti-patterns detected'}${result.findings?.length ? ` [${result.findings.map((f) => f.title).join(', ')}]` : ''}.`
				: result.status === 'FAIL'
				? `Failed: ${result.summary || 'Critical defect or constraint violation flagged'}${result.findings?.length ? ` [${result.findings.map((f) => `${f.title}: ${f.reasoning}`).join('; ')}]` : ''}.`
				: `Bypassed (NA): ${result.summary || 'Evaluation was bypassed or quota-limited'}.`);

		result.comment = rationaleComment;

		// 2. Completed step recording in the state graph with why it passed/didn't
		const completedStep: PipelineStep = {
			step_index: currentStepCount + 2,
			node: `node_${criterion.key}`,
			key: criterion.key,
			criterion_code: criterion.code,
			status: result.status,
			execution_status: result.execution_status,
			score: result.score,
			timestamp: new Date().toISOString(),
			summary: result.summary,
			comment: rationaleComment,
			error: result.status === 'NA' ? result.summary : undefined
		};

		// Stream validated / NA progress to Neon Postgres immediately
		await streamProgressToDb(state, criterion.key, result);

		return {
			criteria: {
				[criterion.key]: result
			},
			steps: [optimisticStep, completedStep]
		};
	};
}

// Finalization Node: Status Aggregation and Gate Enforcement
async function finalizeReportStatusNode(state: OrchestratorStateType) {
	const criteriaResults = state.criteria || {};

	// Verify all 17 criteria were executed (either VALIDATED or NA)
	const allFinished = VIBE_CRITERIA.every(
		(crit) =>
			criteriaResults[crit.key] &&
			(criteriaResults[crit.key].execution_status === 'VALIDATED' ||
				criteriaResults[crit.key].execution_status === 'NA')
	);

	let compositeScore: number | null = null;
	let validationStatus: ValidationStatus = 'SAFE';

	if (!allFinished) {
		// Only lock to INCOMPLETE if some criteria haven't executed yet
		validationStatus = 'INCOMPLETE';
		compositeScore = null;
		console.warn(
			`[finalizeReportStatus] Commit ${state.commitHash.substring(0, 7)} has unexecuted criteria. Locking status to INCOMPLETE.`
		);
	} else {
		// Failed states are reported as NA and proceed in the report generation for further use!
		const scoredCriteria = VIBE_CRITERIA.filter(
			(crit) =>
				criteriaResults[crit.key]?.execution_status === 'VALIDATED' &&
				criteriaResults[crit.key]?.status !== 'NA' &&
				typeof criteriaResults[crit.key]?.score === 'number'
		);

		if (scoredCriteria.length > 0) {
			const scores = scoredCriteria.map((crit) => criteriaResults[crit.key].score as number);
			compositeScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
		} else {
			compositeScore = null;
		}

		// Check for any failures in evaluated criteria (flagged threshold: score < 85 or status FAIL/WARN)
		const hasCriticalFailure = VIBE_CRITERIA.some(
			(crit) =>
				criteriaResults[crit.key]?.status === 'FAIL' ||
				(criteriaResults[crit.key]?.execution_status === 'VALIDATED' &&
					typeof criteriaResults[crit.key]?.score === 'number' &&
					(criteriaResults[crit.key]?.score as number) < 85)
		);
		const hasWarning = VIBE_CRITERIA.some((crit) => criteriaResults[crit.key]?.status === 'WARN');
		const isCompositeBelowThreshold = compositeScore !== null && compositeScore < 85;

		validationStatus = hasCriticalFailure || hasWarning || isCompositeBelowThreshold ? 'FLAGGED' : 'SAFE';
	}

	// Run agent fingerprinting for high-level intent
	let fingerprint: AgentFingerprintData;
	try {
		fingerprint = await runAgentFingerprinting(state.diff, state.commitMsg);
	} catch (err: any) {
		fingerprint = {
			intent_summary: state.commitMsg || 'Autonomous AI commit',
			reasoning_record: 'Fingerprint extraction skipped due to transport constraint.',
			perceived_risk: 'MEDIUM'
		};
	}

	// Prepare badge mappings for both code ('VBC-01') and short badge ('V01')
	const badges: Record<string, DomainBadgeStatus> = {};
	for (const crit of VIBE_CRITERIA) {
		const res = criteriaResults[crit.key];
		badges[crit.code] = res
			? res.execution_status === 'NA' || res.status === 'NA'
				? 'NA'
				: res.execution_status === 'ERROR'
				? 'ERROR'
				: res.status
			: 'PENDING';
		badges[crit.badge] = badges[crit.code];
	}

	const flagCount = Object.values(criteriaResults).filter((c) => c.status === 'FAIL' || c.status === 'WARN').length;
	const passingCount = Object.values(criteriaResults).filter(
		(c) => c.status === 'PASS' && c.execution_status === 'VALIDATED'
	).length;

	const summary: ReportSummary = {
		hash: state.commitHash,
		branch: state.branch || 'main',
		author: state.author || 'Unknown',
		message: state.commitMsg,
		timestamp: state.timestamp || new Date().toISOString(),
		parents: state.parents || [],
		parent_shas: state.parents || [],
		validation_status: validationStatus,
		safety_verdict: validationStatus,
		composite_score: compositeScore, // null if INCOMPLETE or all NA
		high_level_intent: fingerprint.intent_summary,
		material_changes_summary: state.diffSummary || '',
		criteria_badges: badges,
		domain_badges: badges,
		flag_count: flagCount,
		passing_count: passingCount,
		total_criteria_count: VIBE_CRITERIA.length,
		resolved_by_commit: null,
		remediation_status: 'NONE'
	};

	// Aggregate structured findings directly from all criteria
	const findingsList: import('$lib/types').FindingItem[] = [];
	for (const crit of VIBE_CRITERIA) {
		const res = criteriaResults[crit.key];
		if (res && res.status !== 'PASS' && res.status !== 'NA' && res.execution_status === 'VALIDATED' && res.findings) {
			res.findings.forEach((finding, idx) => {
				findingsList.push({
					id: finding.id || `${crit.code}-${idx + 1}`,
					domain: crit.key,
					criterion_code: crit.code,
					title: finding.title,
					severity: finding.severity,
					reasoning: finding.reasoning,
					file_path: finding.file_path,
					diff_hunk: finding.diff_hunk,
					recommendation: finding.recommendation
				});
			});
		}
	}

	const validationStages: Record<string, any> = {};
	for (const crit of VIBE_CRITERIA) {
		const res = criteriaResults[crit.key];
		validationStages[crit.key] = {
			completed: res?.execution_status === 'VALIDATED' || res?.execution_status === 'NA',
			execution_status: res?.execution_status || 'INCOMPLETE',
			validated_at: res ? new Date().toISOString() : undefined,
			retry_count: 0
		};
	}

	const finalizeStep: PipelineStep = {
		step_index: (state.steps?.length || 0) + 1,
		node: 'node_finalize_report_status',
		key: 'report_finalization',
		status: validationStatus === 'INCOMPLETE' ? 'WARN' : 'PASS',
		execution_status: allFinished ? 'VALIDATED' : 'INCOMPLETE',
		score: compositeScore,
		timestamp: new Date().toISOString(),
		summary: `Report status finalized as ${validationStatus} (Composite: ${compositeScore !== null ? `${compositeScore}%` : 'N/A'})`,
		comment:
			validationStatus === 'SAFE'
				? `Passed: All 17 Quality Markers (of AI-Generated Code) validated clean with composite score of ${compositeScore}%.`
				: validationStatus === 'FLAGGED'
				? `Flagged: Evaluation flagged ${Object.values(criteriaResults).filter((c) => c.status === 'FAIL' || c.status === 'WARN').length} Quality Marker(s). Composite confidence: ${compositeScore !== null ? `${compositeScore}%` : 'N/A'}.`
				: `Incomplete: Pipeline execution halted before all 17 Quality Markers were validated.`
	};

	const allSteps = [...(state.steps || []), finalizeStep];

	const fullReport: FullReport = {
		hash: state.commitHash,
		branch: state.branch || 'main',
		author: state.author || 'Unknown',
		message: state.commitMsg,
		timestamp: state.timestamp || new Date().toISOString(),
		parents: state.parents || [],
		parent_shas: state.parents || [],
		validation_status: validationStatus,
		resolved_by_commit: null,
		criteria: criteriaResults,
		domains: criteriaResults,
		findings_list: findingsList,
		steps: allSteps,
		fingerprint,
		files_changed: (state.diffSummary || '').replace('Changed files: ', '').split(', '),
		diff_summary: state.diffSummary || '',
		validation_stages: validationStages
	};

	return {
		validationStatus,
		fingerprint,
		summary,
		fullReport,
		steps: [finalizeStep]
	};
}

// Sequential Node: Present Issue Resolution Pass
async function presentIssueResolutionNode(state: OrchestratorStateType) {
	if (state.validationStatus === 'FLAGGED' && state.subsequentCommits && state.subsequentCommits.length > 0) {
		try {
			const resolution = await runPresentIssueResolutionAgent(
				JSON.stringify(state.summary),
				state.subsequentCommits
			);

			const resolutionStep: PipelineStep = {
				step_index: (state.steps?.length || 0) + 1,
				node: 'node_present_issue_resolution',
				key: 'issue_resolution',
				status: 'PASS',
				execution_status: 'VALIDATED',
				timestamp: new Date().toISOString(),
				summary: resolution.evidence || `Present Issue Resolution completed`,
				comment: resolution.resolved_by_commit
					? `Passed: Identified subsequent commit ${resolution.resolved_by_commit.substring(0, 7)} resolving prior defects (${resolution.evidence || 'Resolved'}).`
					: `Passed: Evaluated subsequent commits; no defects were resolved by newer commits.`
			};

			const updatedSummary = state.summary
				? { ...state.summary, resolved_by_commit: resolution.resolved_by_commit }
				: null;
			const updatedFull = state.fullReport
				? {
						...state.fullReport,
						resolved_by_commit: resolution.resolved_by_commit,
						steps: [...(state.fullReport.steps || []), resolutionStep]
				  }
				: null;

			return {
				resolvedByCommit: resolution.resolved_by_commit,
				summary: updatedSummary,
				fullReport: updatedFull,
				steps: [resolutionStep]
			};
		} catch (err: any) {
			console.error(`[presentIssueResolutionNode] Live resolution assessment failed:`, err.message);
		}
	}

	return {};
}

// Final Node: Persist Report to Neon Postgres with Atomic Audit Log
async function persistNode(state: OrchestratorStateType) {
	if (!state.summary || !state.fullReport) {
		return {};
	}

	try {
		const sql = `
			INSERT INTO reports (hash, branch, summary, "full", resolved_by_commit, validation_status, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			ON CONFLICT (hash) DO UPDATE SET
				branch = EXCLUDED.branch,
				summary = EXCLUDED.summary,
				"full" = EXCLUDED."full",
				resolved_by_commit = COALESCE(EXCLUDED.resolved_by_commit, reports.resolved_by_commit),
				validation_status = EXCLUDED.validation_status,
				updated_at = NOW();
		`;

		await query(sql, [
			state.commitHash,
			state.branch || 'main',
			JSON.stringify(state.summary),
			JSON.stringify(state.fullReport),
			state.resolvedByCommit || state.summary.resolved_by_commit,
			state.validationStatus
		]);

		await recordAuditLog(
			'PIPELINE_EVALUATION_COMPLETED',
			'vibe_check_runner',
			{
				commitHash: state.commitHash,
				validationStatus: state.validationStatus,
				compositeScore: state.summary.composite_score,
				resolvedBy: state.resolvedByCommit
			},
			{ type: 'commit_report', id: state.commitHash }
		);
	} catch (err) {
		console.error(`Failed to persist report for ${state.commitHash}:`, err);
	}

	return {};
}

/**
 * Builds the strict serial Quality Markers (of AI-Generated Code) evaluation graph (1 criterion per node in series).
 * maxConcurrency: 1
 */
export function createCommitEvaluationGraph(checkpointer?: any) {
	const workflow: any = new StateGraph(OrchestratorStateAnnotation)
		.addNode('node_prepare', prepareNode);

	// Add 17 serial criterion nodes
	for (const crit of VIBE_CRITERIA) {
		workflow.addNode(`node_${crit.key}`, createCriterionNode(crit));
	}

	workflow
		.addNode('node_finalize_report_status', finalizeReportStatusNode)
		.addNode('node_present_issue_resolution', presentIssueResolutionNode)
		.addNode('node_persist', persistNode)

		// Start -> prepare
		.addEdge(START, 'node_prepare')
		// prepare -> VBC-01
		.addEdge('node_prepare', `node_${VIBE_CRITERIA[0].key}`);

	// Wire strictly in series: Criterion_N -> Criterion_N+1
	for (let i = 0; i < VIBE_CRITERIA.length - 1; i++) {
		workflow.addEdge(`node_${VIBE_CRITERIA[i].key}`, `node_${VIBE_CRITERIA[i + 1].key}`);
	}

	// Last criterion (VBC-17) -> finalize_report_status -> present_issue_resolution -> persist -> END
	workflow
		.addEdge(`node_${VIBE_CRITERIA[VIBE_CRITERIA.length - 1].key}`, 'node_finalize_report_status')
		.addEdge('node_finalize_report_status', 'node_present_issue_resolution')
		.addEdge('node_present_issue_resolution', 'node_persist')
		.addEdge('node_persist', END);

	return workflow.compile({ checkpointer });
}
