export type ValidationStatus = 'INCOMPLETE' | 'SAFE' | 'FLAGGED';

export type ExecutionStatus = 'VALIDATED' | 'INCOMPLETE' | 'ERROR' | 'NA';

export type DomainBadgeStatus = 'PASS' | 'WARN' | 'FAIL' | 'PENDING' | 'ERROR' | 'NA';

export type VibeCriterionKey =
	| 'problem_decomposition'
	| 'intent_formalisation'
	| 'context_window_economics'
	| 'context_engineering_ontology'
	| 'anchoring_bias_isolation'
	| 'advanced_code_search'
	| 'harness_engineering'
	| 'telemetry_attribution'
	| 'formal_constraint_tdd'
	| 'test_contingency_bypass'
	| 'deterministic_hooks'
	| 'unemotional_prompt_hygiene'
	| 'self_healing_reflection'
	| 'loop_mitigation_governor'
	| 'protocol_driven_mcp'
	| 'constitutional_global_rules'
	| 'diff_scepticism_and_artefacts';

export interface VibeCriterionDef {
	code: string; // 'VBC-01' .. 'VBC-17'
	key: VibeCriterionKey;
	badge: string; // 'V01' .. 'V17'
	name: string;
	description: string;
	systemInstruction: string;
}

export const VIBE_CRITERIA: VibeCriterionDef[] = [
	{
		code: 'VBC-01',
		key: 'problem_decomposition',
		badge: 'V01',
		name: 'Problem Decomposition',
		description: 'Checks atomic commit scope and alignment with structured task graphs (tasks.md / to-do artefacts).',
		systemInstruction:
			'You are the Problem Decomposition Specialist (VBC-01). Audit this commit for atomic scope and alignment with structured task decomposition. Flag oversized omnibus commits that bundle unrelated features, refactors, or bugfixes without clean decomposition.'
	},
	{
		code: 'VBC-02',
		key: 'intent_formalisation',
		badge: 'V02',
		name: 'Intent Formalisation',
		description: 'Audits commit messages, PR descriptions, and prompts for clear "what and why" intent rather than brittle implementation micromanagement.',
		systemInstruction:
			'You are the Intent Formalisation Specialist (VBC-02). Audit commit messages, comments, and instructions for clear "what and why" intent. Flag vague messages ("fix stuff", "updates"), brittle implementation micromanagement, or missing rationale.'
	},
	{
		code: 'VBC-03',
		key: 'context_window_economics',
		badge: 'V03',
		name: 'Context Window Economics',
		description: 'Checks LLM callers, RAG pipelines, and payload builders for surgical context pruning and chunking bounds rather than full-file dumping.',
		systemInstruction:
			'You are the Context Window Economics Specialist (VBC-03). Inspect LLM prompts, token budgets, RAG retrieval pipelines, and diff chunkers. Flag wasteful whole-file dumping, unbounded payload growth, or lack of surgical context pruning.'
	},
	{
		code: 'VBC-04',
		key: 'context_engineering_ontology',
		badge: 'V04',
		name: 'Context Engineering & Ontology',
		description: 'Flags inline magic numbers, raw string literals, and missing domain types/schemas where explicit constants or ontologies are required.',
		systemInstruction:
			'You are the Context Engineering & Ontology Specialist (VBC-04). Audit code changes for inline magic numbers, raw string literals, unstructured dictionaries, or missing explicit domain types, enums, and ontology definitions.'
	},
	{
		code: 'VBC-05',
		key: 'anchoring_bias_isolation',
		badge: 'V05',
		name: 'Anchoring Bias & Isolation',
		description: 'Checks multi-agent workflows to ensure critic and validator contexts remain isolated from shared generation threads.',
		systemInstruction:
			'You are the Anchoring Bias Isolation Specialist (VBC-05). In multi-agent and evaluation code, verify that validator, reviewer, and critic contexts are strictly isolated from generator prompts to avoid self-reinforcing sycophancy or confirmation bias.'
	},
	{
		code: 'VBC-06',
		key: 'advanced_code_search',
		badge: 'V06',
		name: 'Advanced Code Search',
		description: 'Audits repository search, indexing, or query logic for structured AST/indexed lookups versus naive linear scans.',
		systemInstruction:
			'You are the Advanced Code Search Specialist (VBC-06). Audit search, querying, and indexing code. Flag naive O(N) linear string scans across files where indexed, AST, regex, or structured symbol lookups should be used.'
	},
	{
		code: 'VBC-07',
		key: 'harness_engineering',
		badge: 'V07',
		name: 'Harness Engineering',
		description: 'Verifies runtime config boundaries, environment variable validation, and infrastructure containment around changed execution paths.',
		systemInstruction:
			'You are the Harness Engineering Specialist (VBC-07). Audit runtime boundary validation, environment variable presence checks, configuration schemas, and sandbox containment around execution paths.'
	},
	{
		code: 'VBC-08',
		key: 'telemetry_attribution',
		badge: 'V08',
		name: 'Telemetry & Attribution',
		description: 'Flags raw console.log/warn/error calls and silent/empty catch blocks; requires structured logging, timestamps, and error attribution.',
		systemInstruction:
			'You are the Telemetry & Attribution Specialist (VBC-08). Flag raw console.log/warn calls, empty catch blocks that swallow errors silently, or missing structured telemetry, timestamps, and causal error attribution.'
	},
	{
		code: 'VBC-09',
		key: 'formal_constraint_tdd',
		badge: 'V09',
		name: 'Formal Constraint & TDD',
		description: 'Flags material code changes that lack corresponding unit test coverage or formal acceptance assertions.',
		systemInstruction:
			'You are the Formal Constraint & TDD Specialist (VBC-09). Audit material logic changes for corresponding unit test coverage, invariant assertions, and formal regression test additions.'
	},
	{
		code: 'VBC-10',
		key: 'test_contingency_bypass',
		badge: 'V10',
		name: 'Test Contingency Bypass',
		description: 'Audits test files for weakened assertions, mocked-out core logic, or hardcoded fallback contingencies used to fake passing tests.',
		systemInstruction:
			'You are the Test Contingency Bypass Specialist (VBC-10). Heavily scrutinize modified test files for weakened assertions (e.g. toBeDefined instead of strict equality), mocked-out core logic, or hardcoded fallback contingencies added to fake passing tests.'
	},
	{
		code: 'VBC-11',
		key: 'deterministic_hooks',
		badge: 'V11',
		name: 'Deterministic Hooks',
		description: 'Verifies that invariants are enforced via deterministic code gates (Zod schemas, strict types, pre-push hooks) rather than prompt wishes.',
		systemInstruction:
			'You are the Deterministic Hooks Specialist (VBC-11). Verify that critical system invariants are enforced via deterministic runtime code gates (Zod schemas, strict TypeScript types, pre-commit/pre-push hooks) rather than conversational LLM prompting.'
	},
	{
		code: 'VBC-12',
		key: 'unemotional_prompt_hygiene',
		badge: 'V12',
		name: 'Unemotional Prompt Hygiene',
		description: 'Audits committed prompts, error messages, and code comments for concise, objective technical framing free of conversational filler.',
		systemInstruction:
			'You are the Unemotional Prompt Hygiene Specialist (VBC-12). Audit prompts, user-facing error messages, and code comments. Flag conversational filler, emotional manipulation, sycophantic disclaimers, or excessive verbosity.'
	},
	{
		code: 'VBC-13',
		key: 'self_healing_reflection',
		badge: 'V13',
		name: 'Self-Healing Reflection',
		description: 'Checks error recovery and retry paths for structured diagnostic feedback loops.',
		systemInstruction:
			'You are the Self-Healing Reflection Specialist (VBC-13). Inspect error recovery and retry routines. Verify they pass structured diagnostic feedback and previous error context into retry attempts rather than performing blind retries.'
	},
	{
		code: 'VBC-14',
		key: 'loop_mitigation_governor',
		badge: 'V14',
		name: 'Loop Mitigation & Governor',
		description: 'Inspects pollers, while-loops, retry wrappers, and agent graphs for strict Time-To-Live (TTL) hop limits, max-retry circuit breakers, and rate-limit backoff.',
		systemInstruction:
			'You are the Loop Mitigation & Governor Specialist (VBC-14). Audit while-loops, pollers, recursive calls, retry wrappers, and agent graph transitions. Verify strict iteration caps, TTL hop limits, circuit breakers, and exponential backoff.'
	},
	{
		code: 'VBC-15',
		key: 'protocol_driven_mcp',
		badge: 'V15',
		name: 'Protocol-Driven MCP',
		description: 'Audits MCP servers, tools, and API routes for strict input/output schema validation and least-privilege data scopes.',
		systemInstruction:
			'You are the Protocol-Driven MCP Specialist (VBC-15). Audit Model Context Protocol (MCP) servers, tool definitions, and REST/SSE API endpoints for strict input/output schema validation, least-privilege scoping, and parameter whitelisting.'
	},
	{
		code: 'VBC-16',
		key: 'constitutional_global_rules',
		badge: 'V16',
		name: 'Constitutional Global Rules',
		description: 'Monitors changes to global rule files (CLAUDE.md, .cursorrules, tasks.md) against constraint weakening and ensures destructive actions require human Regret Gate approval.',
		systemInstruction:
			'You are the Constitutional Global Rules Specialist (VBC-16). Audit changes to global instructions and rules files (CLAUDE.md, .cursorrules, tasks.md, prompt templates). Flag any weakening of safety constraints, bypassed approval gates, or unvetted privilege escalation.'
	},
	{
		code: 'VBC-17',
		key: 'diff_scepticism_and_artefacts',
		badge: 'V17',
		name: 'Diff Scepticism & Artefacts',
		description: 'Flags classic unreviewed AI slop (copy-pasted code duplication, dead imports, hallucinated APIs) and verifies that outputs produce compact, human-verifiable artefacts.',
		systemInstruction:
			'You are the Diff Scepticism & Artefacts Specialist (VBC-17). Scrutinize the diff for classic autonomous AI coding defects: duplicate boilerplate blocks, unused/dead imports, hallucinated external libraries or non-existent APIs, and lack of human-verifiable artefacts.'
	}
];

/**
 * Quality Markers (of AI-Generated Code)
 * Rebranded from Vibe-Check criteria: 17 empirical software engineering quality standards.
 */
export const QUALITY_MARKERS = VIBE_CRITERIA;
export type QualityMarkerDef = VibeCriterionDef;
export type QualityMarkerKey = VibeCriterionKey;
export type QualityMarkerScore = VibeCriterionScore;

export interface FindingItem {
	id: string;
	domain: string;
	criterion_code?: string;
	title: string;
	severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
	reasoning: string;
	file_path?: string;
	diff_hunk?: string;
	recommendation?: string;
}

export interface PipelineStep {
	step_index: number;
	node: string;
	key: string;
	criterion_code?: string;
	status: 'PENDING' | 'RUNNING' | 'PASS' | 'WARN' | 'FAIL' | 'NA';
	execution_status: ExecutionStatus;
	score?: number | null;
	timestamp: string;
	summary?: string;
	comment?: string; // explicit explanation of why this step passed or didn't pass
	error?: string;
}

export interface VibeCriterionScore {
	code?: string; // 'VBC-01'
	key?: string;
	name?: string;
	score?: number | null; // 0-100 or null for NA
	status: 'PASS' | 'WARN' | 'FAIL' | 'NA';
	execution_status: ExecutionStatus;
	summary: string;
	comment?: string; // explicit explanation of why this criterion passed or didn't pass
	findings: FindingItem[];
	recommendations?: string[];
}

export type DomainScore = VibeCriterionScore;

export interface AgentFingerprint {
	agent_model?: string;
	intent_summary: string;
	reasoning_record: string;
	perceived_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ReportSummary {
	hash: string;
	branch: string;
	author?: string;
	message?: string;
	timestamp?: string;
	parents?: string[];
	parent_shas?: string[];
	validation_status: ValidationStatus;
	safety_verdict: 'SAFE' | 'FLAGGED' | 'INCOMPLETE';
	composite_score: number | null; // 0-100 or null when INCOMPLETE
	high_level_intent: string;
	material_changes_summary: string;
	criteria_badges?: Record<string, DomainBadgeStatus>; // 'VBC-01' or 'V01'
	domain_badges?: Record<string, DomainBadgeStatus>; // for backwards-compatibility
	flag_count: number;
	passing_count: number;
	total_criteria_count: number;
	created_at?: string;
	updated_at?: string;
	resolved_by_commit?: string | null;
	remediation_status?: 'NONE' | 'PENDING_APPROVAL' | 'RESOLVED';
}

export interface FullReport {
	hash: string;
	branch: string;
	author: string;
	message: string;
	timestamp: string;
	parents?: string[];
	parent_shas?: string[];
	validation_status: ValidationStatus;
	resolved_by_commit: string | null;
	criteria: Record<string, VibeCriterionScore>;
	domains?: Record<string, VibeCriterionScore>; // alias for backwards-compatibility
	findings_list?: FindingItem[];
	steps?: PipelineStep[];
	fingerprint: AgentFingerprint;
	files_changed: string[];
	diff_summary: string;
	summary?: ReportSummary;
	remediation_plan?: RemediationPlan | null;
	validation_stages: {
		[key: string]: {
			completed: boolean;
			execution_status: ExecutionStatus;
			validated_at: string;
			retry_count: number;
			error?: string;
		};
	};
}

export interface RemediationPlan {
	id: string;
	commit_hash: string;
	issue_id?: string;
	title: string;
	plan_markdown: string;
	status: 'PENDING_APPROVAL' | 'RESOLVED';
	created_at: string;
	approved_at?: string | null;
	approved_by?: string | null;
}

export interface ScopedFindingContext {
	hash: string;
	issue_id: string;
	domain_category: string;
	diff_hunk?: string;
	file_path?: string;
	finding_reasoning?: string;
}

export interface AuditLogEntry {
	id?: number;
	action: string;
	actor: string;
	target_type?: string;
	target_id?: string;
	details: Record<string, unknown>;
	created_at?: string;
}

export interface GitHubIssue {
	id: number | string;
	number: number;
	title: string;
	body: string;
	html_url: string;
	state: 'open' | 'closed';
	user: string;
	created_at: string;
	labels: string[];
}
