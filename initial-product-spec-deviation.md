# Architectural Deviation Log: Current Implementation vs. Product Documentation

**Document Version:** 2.0.0  
**Date:** October 19, 2026  
**Reference Documents:**  
- `PRODUCT_SPEC.md` (Base Specification, Sections 1–5)  
- `DATA_INGESTION_AND_REPORTING_OUTLINE.md` (System Version 2.0.0 Outline)  
- `AGENTS.md` (Agent Guidelines & Invariant Protocol)  
**Status:** Canonical Architectural Record  

---

## 1. Executive Summary & Purpose

This document provides a comprehensive, item-by-item architectural audit comparing the **Current Production Implementation** of Nova Orchestrator against the **Product Documentation** (`PRODUCT_SPEC.md` and related technical outlines).

The foundational mission—enabling human quantitative software engineers to review autonomous AI code contributions in two minutes or less via an exception-driven control plane—remains preserved. However, extensive engineering realities during development necessitated foundational evolutions across:
1. **Pipeline Execution Topology & Concurrency** (serial execution vs. parallel fan-out to overcome upstream LLM quota limits);
2. **Evaluation Taxonomy** (17 empirically grounded Quality Markers replacing 7 generic software domains);
3. **Write-Ahead Persistence** (direct SQL write-ahead streaming to Neon Postgres vs. native `PostgresSaver` checkpointer);
4. **Resilience & Fault Tolerance** (graceful `NA` stage degradation and dynamic Google RPC `RetryInfo` backoff vs. hard bounded-retry failures);
5. **Validation Gates & Scoring** (strict 85% threshold with whole-percentage formatting vs. unspecified cutoffs);
6. **Cross-Commit Resolution & Defect Tracking** (dual resolution mechanism with integrated GitHub Issue filing and tracking);
7. **Frontend Review Experience** (interactive Visual Git DAG timeline, executive D3 donut triage layer, ambient ghosted navigation, localized unified audit drawer, and rich GFM typography).

Additionally, several capabilities originally slated for post-release epics (such as Git lineage reconciliation, force-push/rebase branch normalization, and live defect-scoped chat interrogation) were pulled forward into the initial production release.

---

## 2. Comprehensive Architectural Deviation Matrix

The following matrix provides an exhaustive index of all 17 documented divergences between the product documentation and the active codebase:

| # | Subsystem / Area | Product Documentation Baseline (`PRODUCT_SPEC.md`) | Current Production Implementation | Deviation Type | Primary Driver & Architectural Rationale |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **01** | **Pipeline Topology & Concurrency** | Deterministic parallel fan-out and fan-in LangGraph DAG concurrently triaging 7 domains (`TST`, `API`, `UI`, `FIN`, `SYS`, `SEC`, `OPS`). | Strict **serial linear chain** (`node_prepare` $\rightarrow$ `Criterion_1` $\rightarrow$ ... $\rightarrow$ `Criterion_17` $\rightarrow$ `finalize` $\rightarrow$ `resolution` $\rightarrow$ `persist`) with hard concurrency limit (`maxConcurrency: 1`). | **Architectural Divergence** | Eliminates upstream LLM request-per-minute quota exhaustion (`429 Too Many Requests` on 15 RPM tiers); guarantees ordered write-ahead progress streaming. |
| **02** | **Evaluation Criteria Scope** | 7 broad software domains (`TST`, `API`, `UI`, `FIN`, `SYS`, `SEC`, `OPS`) rendered as a 7-badge strip. | **17 Quality Markers (of AI-Generated Code)** (`VBC-01` to `VBC-17`) grouped across 5 architectural pillars, with backwards-compatible 7-domain synthesized aliases. | **Domain Overhaul** | Generic software categories failed to detect characteristic AI coding failure modes (assertion weakening, copy-paste churn, empty catch blocks, hallucinated libraries). |
| **03** | **Checkpointer & Persistence** | Durable write-ahead checkpointing via `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) before every node transition. | Custom write-ahead SQL streaming (`streamProgressToDb`) updating `reports` table on every step; graph compiled with optional/unbound checkpointer. | **Persistence Optimization** | Native `PostgresSaver` created redundant checkpoint tables; direct SQL streaming updates the exact schema consumed by SvelteKit in `<250ms`. |
| **04** | **Fault Tolerance & Recovery** | Bounded retries capped at 2 attempts per stage; failed schema validation halts stage. | Graceful **`NA` fallback degradation**: unrecoverable errors set `status: 'NA'` / `execution_status: 'NA'` with explicit rationale, allowing report to finalize without stalling batch runs. | **Resilience Enhancement** | Prevents single-criterion network or quota timeouts from aborting multi-commit repository evaluation runs. |
| **05** | **Scoring Rubric & Validation Gates** | Transitions from `INCOMPLETE` to `SAFE` or `FLAGGED` upon passing stage validators; raw float scores (`0.92`). | Strict **85% confidence threshold**: scores $<85$ automatically demoted from `PASS` to `WARN`; composite $<85\%$ flags commit; formatted strictly as whole percentages (`92%`). | **Scoring Formalization** | Provides clear, objective numerical cutoffs for human safety sign-off and eliminates decimal ambiguity. |
| **06** | **Cross-Commit Resolution** | Single automated forward-walk: Present Issue Resolution Agent inspects subsequent commits to stamp `resolved_by_commit`. | **Dual Resolution Pathways**: Automated forward-walk agent (`runPresentIssueResolutionAgent`) PLUS interactive human sign-off filing a tracked GitHub issue (`gh-issue-XXX`). | **Functional Expansion** | Allows human reviewers to resolve defects immediately via issue tracking rather than waiting for future commits to be authored and ingested. |
| **07** | **Stage 1 Commit Feed & Lineage** | Flat reverse-chronological card list displaying 7-badge strip and resolution tags. | Interactive **Visual Git Directed Acyclic Graph (DAG)** with SVG rails, branch lanes, bezier fork/merge curves, 17-marker circle strip, and infinite scroll auto-paging (25/page). | **UI/UX Transformation** | Enables instantaneous comprehension of branch divergence, feature rebases, and multi-branch lineage across concurrent agent contributions. |
| **08** | **Executive Triage Layer** | No top-level visualizations; user immediately entered the two-column Stage 1 / Stage 2 feed. | **Executive Triage Layer**: Interactive D3 Donut Chart (`TriageDonutChart.svelte`) with center counter + Most Recent Flagged Hero CTA card (`RecentFlaggedHeroCard.svelte`). | **Functional Expansion** | Guides reviewer attention to the highest-priority defect within 5 seconds without manual scrolling or searching. |
| **09** | **Navigation & Initial Selection** | Static top navbar with branch name and database status dot; automatically selected commit 0 on page load. | **Ghosted ambient watermark** (`Nova Orchestrator / for Terminus`) defaulting to `selectedCommit = null`; Stage 2 displays `⌥ No Commit Selected`; active header upon selection. | **UX Invariant** | Eliminates cognitive anchoring on an arbitrary commit; prevents accidental review of the wrong change. |
| **10** | **Unified Localized Audit Drawer** | Database table (`audit_logs`) committed atomically; pipeline steps were internal to runner; no UI for inspection. | **Unified Audit Trail & Step Log**: Dedicated `/v1/public/get/reports/audit` API, localized `📜 Audit Trail & Steps` button, slide-over drawer with search/filter, and mandatory step rationale comments. | **Auditability Requirement** | Empowers quantitative trade reviewers to inspect full diagnostic traces and 1–2 sentence step rationales directly alongside database governance logs. |
| **11** | **Stage 3/4/5 Remediation & Sign-Off** | Plain chat, "Lock and Plan Fix" generating markdown diff patch, and "Approve Plan" sign-off; automated PR permanently greyed out. | Integrated **GitHub Issue Drafter & Verbatim Sign-Off**: interactive issue editing in chat, `@octokit/rest` issue creation, `GitHubIssueCard.svelte` rendering, and atomic audit logging. | **Workflow Enhancement** | Bridges read-only planning with existing repository issue trackers while preserving the disabled PR deployment guardrail. |
| **12** | **Chat Interrogation Rendering** | Plain text streaming SSE passthrough via Vercel AI SDK. | Full **GitHub Flavored Markdown (GFM)** rendering via `marked` with syntax highlighting and `@tailwindcss/typography` (`prose prose-invert prose-xs`). | **UI/UX Enhancement** | Formatted code blocks, unified diff hunks, and structured tables render cleanly during defect interrogation. |
| **13** | **Git Lineage & Branch Reconciliation** | Simple query parameters (`?branch=main`); lineage reconciliation planned for post-release Epic 2. | **Production Lineage Engine**: Transitive main ancestry caching (`getMainAncestrySet`), branch re-attribution (`normalizeCommitBranches`), and GitHub parent backfilling. | **Roadmap Pull-Forward** | Prevents duplicate commit cards and false orphan branch tags during normal merging and rebasing. |
| **14** | **Batch Runner CLI & Daemon Modes** | Basic single-branch batch evaluation runner. | **Advanced Runner CLI**: Multi-branch discovery (`--all-branches`, `--non-main-branches`), branch exclusion (`--exclude-branch`), limit caps, force re-run, and continuous `--watch` daemon mode. | **Operational Enhancement** | Supports hands-free CI/CD background monitoring and selective branch auditing in quantitative research environments. |
| **15** | **API Route Contracts & Parameters** | 8 basic endpoints with offset pagination and fixed payloads. | Added `/reports/audit` endpoint, `limit` parameter for infinite scroll, `scoped_finding` defect binding in chat/plan, custom response headers (`x-nova-plan-id`), and GitHub issue fields in approve. | **API Specification Evolution** | Enhances client-server contract to support localized audit traces, infinite scrolling, and defect-specific AI prompting. |
| **16** | **AI Model & Dynamic Rate Pacing** | Generic Vercel AI SDK LLM invocation. | Targeted **Google Gemini (`gemini-flash-lite-latest`)** with dynamic RPC `RetryInfo` header inspection and automated backoff sleeping capped at 45 seconds. | **Infrastructure Adaptation** | Guarantees self-healing rate compliance against strict free/pay-as-you-go upstream API quotas. |
| **17** | **Subagent Development Protocol** | Single human developer pairing model. | Formalized multi-agent protocol (`AGENTS.md`) with specialized subagents (`ui-engineer`, `preview`, `api-engineer`, `pipeline-manager`) and 0-error `npm run check` compilation gates. | **Process Governance** | Standardizes autonomous agent pair-programming practices and guarantees codebase consistency. |

---

## 3. Deep-Dive Architectural Divergence Analyses

### 3.1. Pipeline Topology: Serial Linear Chain vs. Parallel Fan-Out

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2, §3.1):**
  > *"Multi-agent workflows triage issues in 'expert' domains... via a deterministic parallel fan-out and fan-in graph topology defined in TypeScript code rather than using an LLM supervisor for routing, followed by the sequential Present Issue Resolution Agent pass."*

- **Current Architecture (`src/lib/runner/graph.ts` lines 51–68, 670–705):**
  The evaluation pipeline executes as a strictly sequential state graph:
  $$\text{node\_prepare} \longrightarrow \text{node\_VBC-01} \longrightarrow \dots \longrightarrow \text{node\_VBC-17} \longrightarrow \text{finalize} \longrightarrow \text{resolution} \longrightarrow \text{persist}$$
  The graph is governed by an explicit concurrency limiter (`agentLimiter`) enforcing `maxConcurrency = 1`.

- **Engineering Rationale & Drivers:**
  1. **Upstream Rate-Limit Compliance:** Parallel fan-out across 7 to 17 concurrent LLM agents instantly triggered burst requests that violated upstream Gemini API quotas (specifically the 15 Requests-Per-Minute tier), resulting in cascade `429 Too Many Requests` failures across nodes.
  2. **Granular Live Streaming:** Executing one criterion at a time allows writing intermediate state directly to Neon Postgres after each step, updating the frontend in real time without batch stalls.
  3. **Deterministic Token Pacing:** Inter-marker backoff delays can be calibrated predictably between nodes.

---

### 3.2. Evaluation Scope: 17 Quality Markers vs. 7 Generic Domains

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.1, §4.1):**
  Defined 7 generic software domains:
  - `TST`: Test suite integrity
  - `API`: Backend server & API design critique
  - `UI`: Frontend UI design & UX flow analysis
  - `FIN`: Financial analysis reasoning
  - `SYS`: System design
  - `SEC`: Security
  - `OPS`: DevOps

- **Current Architecture (`src/lib/types/index.ts` lines 7–198, `src/lib/runner/graph.ts`):**
  Superseded by the **17 Quality Markers (of AI-Generated Code)** (`VBC-01` to `VBC-17`):
  1. `problem_decomposition` (VBC-01): Atomic scope vs. oversized omnibus commits.
  2. `intent_formalisation` (VBC-02): Explicit "what and why" intent in messages and PRs.
  3. `context_window_economics` (VBC-03): Surgical context pruning vs. whole-file dumping.
  4. `context_engineering_ontology` (VBC-04): Domain contracts and schemas vs. magic numbers/literals.
  5. `anchoring_bias_isolation` (VBC-05): Critic/validator context isolation from generation loops.
  6. `advanced_code_search` (VBC-06): Structured AST/indexed search vs. naive linear file scans.
  7. `harness_engineering` (VBC-07): Runtime boundary and environment config validation.
  8. `telemetry_attribution` (VBC-08): Structured logging and causality vs. raw `console.log` / empty catch.
  9. `formal_constraint_tdd` (VBC-09): Mandatory unit/property test additions with code changes.
  10. `test_contingency_bypass` (VBC-10): Scrutiny for weakened assertions and mocked-out logic.
  11. `deterministic_hooks` (VBC-11): Enforcement via Zod schemas and pre-commit hooks vs. prompt wishes.
  12. `unemotional_prompt_hygiene` (VBC-12): Concise technical prompts free of conversational sycophancy.
  13. `self_healing_reflection` (VBC-13): Diagnostic feedback loops in error retry routines.
  14. `loop_mitigation_governor` (VBC-14): Strict TTL hop limits and circuit breakers on while loops/graphs.
  15. `protocol_driven_mcp` (VBC-15): Least-privilege schema validation on MCP tools and APIs.
  16. `constitutional_global_rules` (VBC-16): Anti-weakening checks for `AGENTS.md`, `.cursorrules`, `tasks.md`.
  17. `diff_scepticism_and_artefacts` (VBC-17): Code duplication, dead imports, and hallucinated APIs.

- **Compatibility Bridge:**
  The system synthesizes backwards-compatible `domain_badges` and `domains` maps in `ReportSummary` and `FullReport` to ensure compatibility with any legacy consumers.

---

### 3.3. Checkpointing & Persistence: Direct SQL Streaming vs. `PostgresSaver`

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2):**
  > *"Durable Write-Ahead Checkpointing: Persisted to Neon Postgres using `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) before every node transition."*

- **Current Architecture (`src/lib/runner/graph.ts` lines 19, 74–179, 673–705):**
  While `@langchain/langgraph-checkpoint-postgres` is included in `package.json` and imported, the active runner invokes `createCommitEvaluationGraph()` without passing a checkpointer instance.
  Instead, live write-ahead persistence is implemented via `streamProgressToDb()`:
  - Executes an atomic SQL `INSERT ... ON CONFLICT (hash) DO UPDATE` directly against the `reports` table in Neon Postgres after every single criterion completes.
  - Updates intermediate badge dictionaries, stage completion metadata, and optimistic running step records.

- **Engineering Rationale & Drivers:**
  1. **Zero-Latency Dashboard Read Path:** SvelteKit endpoints query the `reports` table directly. Using LangGraph's internal serialized state checkpoint tables would require an additional ETL or translation layer to populate frontend-ready JSON structures, increasing query latency beyond the `<250ms` SLA.
  2. **Fine-Grained Live UI Updates:** Direct database streaming updates optimistic skeletons and completed badge states in real time as the batch runner iterates.

---

### 3.4. Resilience: Graceful `NA` Degradation vs. Hard Bounded Retries

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2):**
  > *"Bounded Retries & Circuit Breakers: Capped at a hard maximum of 2 retries per agent stage to prevent infinite loops."*

- **Current Architecture (`src/lib/runner/graph.ts` lines 327–344, `src/lib/ai/gemini.ts` lines 80–136):**
  - **Graceful Stage Bypassing:** When an individual criterion agent encounters an unrecoverable failure (such as rate-limit exhaustion, transport drop, or malformed LLM output), it catches the error and stamps:
    ```typescript
    result = {
      code: criterion.code,
      key: criterion.key,
      name: criterion.name,
      score: null,
      status: 'NA',
      execution_status: 'NA',
      summary: `Evaluation bypassed or unavailable (NA): ${err.message}`,
      comment: `Bypassed (NA): Upstream transport or quota limit encountered. Stage degraded gracefully without failing pipeline.`,
      findings: [],
      recommendations: []
    };
    ```
  - **Pipeline Continuation:** Rather than aborting the entire commit or failing the batch runner, execution proceeds to the next criterion. The finalizer node treats `NA` as a non-fatal state, calculating composite confidence exclusively across scored criteria.
  - **Transport-Level Retries:** Gemini API calls in `src/lib/ai/gemini.ts` use a 5-attempt retry loop with dynamic RPC `RetryInfo` parsing and a 45-second sleep cap.

---

### 3.5. Scoring Rubric: Strict 85% Cutoff and Whole Percentage Formatting

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2, §4.1):**
  Specified that status transitions from `INCOMPLETE` to `SAFE` or `FLAGGED`, with confidence scores displayed in summaries. Early drafts used decimal scores (`0.92`).

- **Current Architecture (`src/lib/runner/graph.ts` lines 346–350, 403–441, `AGENTS.md`):**
  - **Enforced 85% Demotion:** If a criterion agent assigns a numerical score $< 85$ but marks status as `PASS`, the pipeline automatically overrides the status to `WARN`.
  - **Deterministic Flagging:** A commit resolves to `FLAGGED` if:
    1. Any criterion receives `status === 'FAIL'`, OR
    2. Any criterion receives `status === 'WARN'`, OR
    3. Any validated criterion scores $< 85$, OR
    4. The aggregate composite score is $< 85\%$.
  - **Formatting Invariant:** All confidence scores are strictly whole percentages formatted with `%` (e.g. `92%`, `76%`, never raw decimals like `0.92`).

---

### 3.6. Cross-Commit Defect Resolution: Dual Pathways & GitHub Issue Integration

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.1):**
  > *"Commits are evaluated in reverse-chronological order... and the Present Issue Resolution Agent walks forward up the chain of subsequent commit summaries to stamp a `resolved_by_commit` hash or leave it blank if unresolved."*

- **Current Architecture (`src/lib/runner/graph.ts` lines 577–621, `src/routes/v1/public/post/approve/+server.ts`):**
  The system implements **two complementary resolution mechanisms**:
  1. **Algorithmic Chronological Forward Walk (`runPresentIssueResolutionAgent`):** Evaluates newer commits in the batch to detect if a code modification resolved an earlier defect, stamping `resolved_by_commit = '<newer_hash>'`.
  2. **Interactive Human Sign-Off & GitHub Issue Filing:** When a reviewer examines a defect in Stage 3/4 and clicks "Approve and File GitHub Issue" (`/v1/public/post/approve`), the system:
     - Files or mocks an issue via `@octokit/rest` (`createIssue`).
     - Stitches `resolved_by_commit = 'gh-issue-{number}'` onto the report in Neon Postgres.
     - Transitions `remediation_plans` to `RESOLVED`.
     - Records an immutable audit log entry (`GITHUB_ISSUE_FILED_COMMIT_RESOLVED`).
     - Renders a live `GitHubIssueCard.svelte` in the Stage 2/3 UI drill-down.

---

### 3.7. Stage 1 UI: Interactive Visual Git DAG vs. Flat Feed

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.1):**
  Specified a reverse-chronological card list with a 7-badge strip.

- **Current Architecture (`src/routes/+page.svelte`, `src/lib/git/lineage.ts`):**
  Stage 1 renders a **Git Directed Acyclic Graph (DAG)** timeline:
  - SVG rails and branch lanes computed from commit `parents` / `parent_shas`.
  - Smooth cubic bezier curves visualizing branch splits and merges.
  - Branch-specific track color styling (`main`, `feat/micro-jitter`, `feat/strict-nulls`).
  - Interactive **17-marker circle strip** with tooltip popovers replacing the 7-badge strip.
  - **Infinite Scroll Auto-Paging:** Automatically streams in the next 25 commits via an `IntersectionObserver` sentinel, eliminating manual pagination buttons.
  - Filter controls: status tabs (`ALL`, `FLAGGED`, `SAFE`, `RESOLVED`, `INCOMPLETE`), branch selector with commit counts, and a real-time search box.

---

### 3.7.1. Stage 2 Details Tab: Status-Scoped Streamlined Information Architecture

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.1):**
  Stage 2 expanded commits to show generic domain status and code diffs in an unsegmented feed.

- **Current Architecture (`src/routes/+page.svelte`):**
  Streamlines the Stage 2 details pane conditionally based on the commit's validation tag:
  1. **Resolved (`isResolved`)**: Prominently displays **"Issue Resolved"** with a direct preview of the resolving GitHub Issue (`GitHubIssueCard.svelte`) or resolving commit preview card with branch/author/inspection links.
  2. **Flagged (`isFlagged`)**: Prominently highlights all **pipeline issues encountered**, failed Quality Marker badges (`VBC-XX`), severity, defect critiques, and syntax-highlighted code diff hunks with immediate "Interrogate Issue" triggers.
  3. **Passed (`isPassed`)**: Prominently highlights **all passing stages in the pipeline** across the 17 Quality Markers in a clean grid with confidence scores and "Why it passed" step rationales.
  4. **Collapsed Behind Grey Toggle**: In all states, secondary metadata (historical criteria, files changed, diff scopes, agent fingerprinting records, and telemetry) is neatly collapsed behind a grey `[ Show full details ]` button at the bottom.

---

### 3.8. Executive Triage Layer: D3 Donut Chart & Hero CTA

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.1):**
  No top-level visualizations existed in the base specification.

- **Current Architecture (`src/lib/components/TriageDonutChart.svelte`, `RecentFlaggedHeroCard.svelte`):**
  Added an executive summary header above Stage 1 & 2:
  - **Interactive D3 Donut Chart:** Built with `d3.pie()` and `d3.arc()`, displaying proportional splits across `Safe` (Emerald), `Flagged` (Rose), `Resolved` (Sky), and `Incomplete` (Amber), centered with total commit count and bi-directional hover legend.
  - **Most Recent Flagged Hero CTA Card:** Surfaces the most recent unreviewed flagged commit with a pulsing `⚡ ATTENTION REQUIRED` beacon, commit SHA, branch, confidence percentage, failing marker clue, direct "Review & Interrogate Defect →" action, and localized audit trail shortcut.

---

### 3.9. Navigation & Ambient Selection State

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.1, §5.1):**
  Static top navbar with branch name and database connection telemetry; automatically selected commit 0 on page load.

- **Current Architecture (`src/lib/components/Navbar.svelte`, `src/routes/+page.svelte`):**
  - **Default Unselected State:** App initializes with `selectedCommit = null`.
  - **Ghosted Atmospheric Watermark:** Navbar chrome is replaced by a subtle ambient watermark (`NOVA ORCHESTRATOR / for Terminus`) until a commit is selected.
  - **Stage 2 Empty State:** Renders an explicit `⌥ No Commit Selected` placeholder with triage guidance.
  - **Active Selection Chrome:** Selecting a commit activates the navbar with commit SHA, branch, safety status, confidence percentage, and a `✕ Deselect` button.
  - **Telemetry Badge Removal:** The `Neon Postgres Connected` dot was removed from the header to minimize visual noise.

---

### 3.10. Unified Localized Audit Trail & Step Log Drawer

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2, §4.1):**
  Internal database table (`audit_logs`) committed atomically. No localized UI for per-report audit inspection.

- **Current Architecture (`src/routes/v1/public/get/reports/audit/+server.ts`, `src/routes/+page.svelte`):**
  - **Dedicated Aggregation API:** `GET /v1/public/get/reports/audit?hash={hash}` merges pipeline execution steps (`full.steps`) and database audit logs (`audit_logs`) into a unified chronological sequence (~41 events per report).
  - **Localized Drawer Access:** `📜 Audit Trail & Steps` button on every commit card and the Hero CTA opens a slide-over panel.
  - **Inspection Features:** Free-text search, event category filters (`ALL`, `STEPS`, `AUDIT`), sort direction toggles, and JSON payload viewer.
  - **Mandatory 1–2 Sentence Step Rationale Comments:** Recorded on every step execution event (`PipelineStep.comment`), explaining why the step passed, warned, or failed.

---

### 3.11. Remediation Specification: GitHub Issue Drafting & Verbatim Sign-Off

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.1, §4.1):**
  Stage 4 ("Lock and Plan Fix") streamed a markdown diff patch; Stage 5 ("Ten-Second Atomic Sign-Off") approved the plan, with automated PR creation permanently greyed out.

- **Current Architecture (`src/routes/v1/public/post/chat/`, `plan/`, `approve/`, `src/routes/+page.svelte`):**
  - AI assistant drafts a structured GitHub Issue containing Problem Statement, Defect Critique, and Proposed Remediation Steps.
  - Reviewer can interactively edit the issue title and body directly in the drawer before signing off.
  - Verbatim sign-off ("Approve" in chat or clicking the approval button) triggers `/v1/public/post/approve`, creating a GitHub issue via `@octokit/rest` and marking the commit resolved.
  - Displays an interactive `GitHubIssueCard.svelte` showing live issue metadata.
  - Automated PR deployment button remains permanently disabled.

---

### 3.12. Rich Markdown & Typography in Interrogation (Stage 3)

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.1):**
  Plain text streaming SSE passthrough.

- **Current Architecture (`src/routes/+page.svelte`):**
  Chat messages are rendered using `marked` configured with GitHub Flavored Markdown (GFM), line breaks, and `@tailwindcss/typography` (`prose prose-invert prose-xs max-w-none`), ensuring clean rendering of syntax-highlighted code blocks, diffs, tables, and lists.

---

### 3.13. Git Lineage & Branch Attribution Engine (Roadmap Epic 2 Pull-Forward)

- **Product Specification Baseline (`PRODUCT_SPEC.md` §5.1 Post-Release Roadmap Epic 2):**
  Git lineage reconciliation, cross-branch commit deduplication, and branch attribution normalization were scheduled for post-release v1.2.

- **Current Architecture (`src/lib/server/lineage.ts`, `src/lib/git/lineage.ts`):**
  Implemented and operating in production:
  - `getMainAncestrySet()`: Traverses the repository graph to compute the transitive ancestry set for `main`/`master`, cached in server memory for 30 seconds.
  - `normalizeCommitBranches()`: Pure graph normalization re-attributing commits belonging to `main`'s history back to `main`, preventing branch duplication.
  - Parent backfilling: Automatically fetches missing parent SHAs from GitHub if omitted in historical records.

---

### 3.14. Batch Runner CLI Capabilities & Continuous Daemon Mode

- **Product Specification Baseline (`PRODUCT_SPEC.md` §1.2):**
  Simple local runner executing commits for a single branch.

- **Current Architecture (`scripts/runner.ts`):**
  Advanced CLI argument parsing:
  - `--all-branches`: Evaluates across all repository branches.
  - `--non-main-branches` / `--non-main`: Discovers and evaluates feature branches while isolating commits from `main`.
  - `--exclude-branch=<branches>`: Excludes specified branches.
  - `--branch=<branch>`: Targets a single branch.
  - `--limit=N`: Evaluates latest N commits.
  - `--force` / `-f`: Re-evaluates already processed commits.
  - `--watch` / `-w` & `--interval=N`: Continuous polling daemon checking for new commits every N seconds.
  - `--include-main-commits`: Controls ancestry filtering.

---

### 3.15. API Route Contracts & Specification Extensions

- **Product Specification Baseline (`PRODUCT_SPEC.md` §4.2):**
  Defined 8 endpoints with standard parameters.

- **Current Architecture:**
  - `GET /v1/public/get/reports/summary`: Added `limit` query param for infinite scroll; sorts strictly by commit timestamp DESC; normalizes branch attribution; backfills parents.
  - `GET /v1/public/get/reports/audit`: New endpoint aggregating pipeline steps and audit logs.
  - `POST /v1/public/post/chat` & `POST /v1/public/post/plan`: Accept `scoped_finding: ScopedFindingContext` with `{hash, issue_id, domain_category, diff_hunk, file_path, finding_reasoning}`, scoping the system prompt to the exact defect.
  - `POST /v1/public/post/plan`: Returns `x-nova-plan-id` and `x-nova-issue-id` response headers; records audit log in `onFinish`.
  - `POST /v1/public/post/approve`: Accepts GitHub issue fields (`issue_title`, `issue_body`, `issue_labels`, `resolved_by_commit`); calls GitHub client; creates foreign key placeholder report if commit record is missing.

---

### 3.16. Upstream AI Provider & Dynamic Quota Pacing

- **Product Specification Baseline (`PRODUCT_SPEC.md` §5.1):**
  Vercel AI SDK LLM invocation.

- **Current Architecture (`src/lib/ai/gemini.ts`):**
  Concrete integration with Google Gemini using `gemini-flash-lite-latest`.
  Implements `extractRetryDelayMs()` to parse Google RPC `RetryInfo` headers (e.g. `retryDelay: "X.Xs"` or `@type: RetryInfo`) and error text, dynamically sleeping the required duration (capped at 45 seconds).

---

### 3.17. Subagent Development Protocol & Invariants

- **Product Specification Baseline (`PRODUCT_SPEC.md`):**
  Single human developer pairing model.

- **Current Architecture (`AGENTS.md`):**
  Formal subagent protocol defining specialized roles (`ui-engineer`, `preview`, `api-engineer`, `pipeline-manager`, `research`), enforcing strict invariants:
  - Quality Markers (of AI-Generated Code) terminology (no "vibe-check").
  - Percentage confidence formatting (`%`).
  - Mandatory 1–2 sentence step rationale comments.
  - Zero-error compilation gate (`npm run check`).

---

## 4. Invariant Preservation Verification

Despite these 17 architectural evolutions, all core invariants from `PRODUCT_SPEC.md` are strictly preserved:

1. **Human-in-the-Loop Review Authority:** Autonomous PR deployment remains permanently greyed-out and inaccessible; human reviewers retain complete decision authority.
2. **ACID Transactional Consistency:** All plan approvals, issue logging, and audit events commit atomically within single Neon Postgres transactions.
3. **Route Protection Rules:**
   - `v1/public/get/*`: Completely public (no auth required).
   - `v1/private/*`: Enforces internal bearer token (`INTERNAL_BEARER_SECRET`).
   - `v1/public/post/*`: Enforces passcode header (`x-passcode`).
4. **Latency Target:** Initial summary queries, branch filtering, and full report lookups remain well within the `<250ms` imperceptible threshold.
5. **Code Quality Gate:** Verified at **0 errors and 0 warnings** under `npm run check`.
