# Nova Orchestrator - Product Specification

## Summary

Nova Orchestrator is a specialised commit review control plane designed to integrate with Terminus, the experimental work-in-progress research process automation platform, streamlining human-in-the-loop review of autonomous AI code developments. The aim is to reduce the time it takes to perform manual code review and enhance this process with additional automated contextual judgements. By orchestrating agent-submitted changes into structured, auditable review workflows, it bridges the gap between high-velocity autonomous software development and the stringent validation, safety, and quality standards required in quantitative trade research environments.

---

## Requirements

### Functional Requirements

- **Repository State Inspection**: The user can view the current state of the repository so they can identify the latest commit, current production target, and inspect material code changes.
- **Report Summaries**: The user can view report summaries so they can quickly understand intent and general direction, material code changes, and instantly appreciate code quality from multiple key perspectives including safety, maintainability, and code accuracy.
- **Natural Language Interrogation**: The user can interrogate each commit with natural language queries, so that they can conveniently follow up on concerns and questions without lengthy code review.
- **Historical Analysis & Issue Tracking**: The user can view previous states, so that they can understand code quality across time and previous issues which are still present in the current code. Commits are evaluated in reverse-chronological order (starting from the most recent commit per branch and working backwards), and the Present Issue Resolution Agent walks forward up the chain of subsequent commit summaries to stamp a `resolved_by_commit` hash or leave it blank if unresolved.
- **Read-Only Hotfix Planning Workflow**: The user can use a read-only hotfix specification workflow where they plan and specify recommended code changes via chat, lock the chat into a `PENDING_APPROVAL` state, and explicitly approve the remediation plan to mark the issue resolved, while the automated GitHub Pull Request deployment action is greyed-out for the PoC.
- **Autonomous Multi-Domain Review Orchestration**: An orchestrated series of backend agents autonomously review commits and publish reports so they may be consumed by the user. The steps have dedicated pre-defined criteria and test multiple domains including:
  - **Test suite integrity**: Test validity testing the feature, mocks, fallbacks, and other skips on fail.
  - **Backend server & API design critique**: Architectural and endpoint design evaluation.
  - **Frontend UI design & UX flow analysis**: Component design and user journey inspection.
  - **Financial analysis reasoning**: Valid application of financial analyses, accurate implementation of statistics.
  - **System design**: High-level system design, architectural decisions in the commit, overall strategy.
  - **Security**: GenAI era-specific vulnerabilities, general data vulnerabilities.
  - **DevOps**: Code maintainability, cognitive load, records of tests passing/failing prior to push.
  - **Agent fingerprinting**: Written records or summaries of intent and reasoning from the agent specific to the commit.

### Non-Functional Requirements

- **Local Batch Execution**: Batch commit evaluation is triggered and executed exclusively from a local Node.js batch runner rather than from the hosted web application.
- **Deterministic Multi-Agent Graph Topology**: Multi-agent workflows triage issues in "expert" domains (test suite integrity, API design, frontend UX flow analysis, financial analysis reasoning, DevOps, security, codebase evaluation and maintainability) via a deterministic parallel fan-out and fan-in graph topology defined in TypeScript code rather than using an LLM supervisor for routing, followed by the sequential Present Issue Resolution Agent pass.
- **Strict Query Latency Targets**: Target query latency for page load, fetching an additional page of historical reports, and loading full report details is `<250ms` to remain imperceptible.
- **Streaming & Incremental Loading**: Data is loaded incrementally with suspense components and parallel calls to minimise time-to-interactive.
- **Partial Queries**: High-level details are requested first, with deeper details loaded on subsequent calls only when requested by the user (e.g., expanding a ticket, scrolling down / pagination of historical reports).
- **LangGraph Flow Orchestration**:
  - **Durable Write-Ahead Checkpointing**: Persisted to Neon Postgres using `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) before every node transition.
  - **Per-Stage Live Pipeline Validation**: Strict runtime schema enforcement at every node.
  - **Bounded Retries & Circuit Breakers**: Capped at a hard maximum of 2 retries per agent stage to prevent infinite loops.
  - **Default Incomplete Validation Gate**: Initializes with a status of `INCOMPLETE` and only resolves to `SAFE` or `FLAGGED` after all seven domain agents pass their stage validators.
- **Atomic Immutable Audit Logging**: A full audit log records every single backend and frontend action in an immutable audit log table residing inside the same single Neon Postgres database as the reports table, committing state changes and audit entries atomically inside a single ACID transaction.
- **Context Chunking & Auto-Summarisation**: Chunking of context is performed when assessing code diffs, alongside auto-summarisation of history when the context window reaches capacity.

---

## Two-Minute Exception-Driven Frontend Workflow

Nova Orchestrator's frontend architecture is organized around an exception-driven review model designed to allow human engineers to review autonomous agent contributions in two minutes or less.

### The Five-Stage Interaction Flow

1. **Stage 1 — Five-Second Branch Triage (Summary Feed)**:
   - Evaluates commits in reverse-chronological order exclusively from the lightweight `{summary}` payload keeping initial load and pagination `< 250ms`.
   - Each commit row immediately displays:
     - Overall validation status badge (`INCOMPLETE`, `FLAGGED`, or `SAFE`).
     - Compact 7-badge strip showing live per-domain status: `TST`, `API`, `UI`, `FIN`, `SYS`, `SEC`, `OPS`.
     - Cross-commit resolution tags showing which historical issues were resolved by newer commit hashes (`resolved_by_commit`).

2. **Stage 2 — Twenty-Second Exception Drill-Down (Focused Artefact Review)**:
   - Expanding a commit loads the full report asynchronously inside a suspense boundary.
   - Suppresses full-file diff dumps and walls of text, displaying only the specific code diff hunks and reasoning tied to flagged findings.

3. **Stage 3 — Forty-Five-Second Scoped Interrogation (Contextual Chat)**:
   - Users trigger streaming chat sessions (`v1/public/post/chat`) directly from an individual flagged finding card.
   - Pre-loads that finding's domain critique, file path, and code diff hunk into the system prompt so interrogation is immediately scoped to the defect.

4. **Stage 4 — Thirty-Second Remediation Specification (Lock and Plan)**:
   - User clicks **"Lock and Plan Fix"** in the chat drawer (`v1/public/post/plan`).
   - Locks conversation edits, routes the transcript to the planning agent, streams a read-only recommended code patch in markdown diff syntax, and marks the finding status as `PENDING_APPROVAL`.

5. **Stage 5 — Ten-Second Atomic Sign-Off (Approval Gate)**:
   - Renders an **"Approve Plan"** action alongside a permanently greyed-out **"Open Automated PR"** button (reserved for future CI expansion).
   - Clicking approve executes an atomic Neon Postgres transaction transitioning the remediation plan to `RESOLVED` and appending an immutable entry to `audit_logs`.

### Three Mandatory UX Optimizations

- **Collapse Passing Domain Agents by Default**: Passing domain agents are rendered as collapsed, single-line status pills. Auto-expands only domain agents that returned warnings, errors, or failed validation.
- **Anchor Chat Triggers to Individual Findings**: Instead of a generic commit-level chat button, an **"Interrogate Issue"** trigger is attached to each finding card, passing `{hash, issue_id, domain_category, diff_hunk}` in the payload.
- **Lock Skeleton Heights for Live Stage Streaming**: Fixed-height skeleton slots are reserved for all seven domain agents and the Present Issue Resolution pass during `INCOMPLETE` state, eliminating Cumulative Layout Shift (CLS) as stages complete.

---

## API Specification

### Route Protection Rules

- All `v1/public/get/*` routes are public and require no authentication.
- All `v1/private/*` routes require an internal bearer secret header.
- All `v1/public/post/*` routes require a passcode header.

### Endpoints

#### `v1/private/get/commit-list?page={page}&branch={branch}`
- **Purpose**: Intended for backend agents to retrieve a paginated list of commit hashes from the GitHub repository so the orchestrator knows which commits to queue for the multi-agent reporting pipeline.
- **Parameters**:
  - `{page}`: Page number of results requested (e.g., 1 out of 10).
  - `{branch}`: Optional Git branch name to filter commits by (defaults to default branch).
- **Response**: List of commit IDs (SHAs).

#### `v1/private/get/commit?hash={hash}`
- **Purpose**: Intended for backend agents to retrieve a single commit with all necessary details from the GitHub repository to report on and summarise in the multi-agent reporting pipeline.
- **Parameters**:
  - `{hash}`: The SHA identifying a specific commit.
- **Response**: Full payload containing material code diff, timestamp, author, and commit message.

#### `v1/private/put/report`
- **Purpose**: Stores agent report outputs in the centralised cloud database. Supports incremental per-stage updates as each validator node passes.
- **Payload**:
  - `hash`: The SHA identifying a specific commit.
  - `branch`: The Git branch name associated with the commit.
  - `full`: JSON-formatted report containing all summarised details and judgements.
  - `summary`: High-level subset of values (scores across main assessed categories, danger/safe flags).
  - `resolved_by_commit`: Commit hash marking resolution (or null/blank).
  - *Validation lifecycle*: Initializes with validation status `INCOMPLETE`, transitioning to `SAFE` or `FLAGGED` when all seven domain agents pass validation.
- **Response**: Status code indicating success/failure (consumed by bounded retry policies in the agent runner).

#### `v1/public/get/reports/summary?page={page}&branch={branch}`
- **Purpose**: Returns a list of report summaries for the main dashboard view.
- **Parameters**:
  - `{page}`: Requested results page.
  - `{branch}`: Optional Git branch name to filter report summaries.
- **Response**: Array of pre-formatted report summary JSON objects ready for frontend display.

#### `v1/public/get/reports/full?hash={hash}`
- **Purpose**: Returns a single report in full detail when expanded by the user on the main page.
- **Parameters**:
  - `{hash}`: The SHA ID of the commit.
- **Response**: Full structured JSON report.

#### `v1/public/post/chat`
- **Purpose**: Context-aware AI chat allowing the user to reason about and plan issue resolutions.
- **Parameters**:
  - `chat_params`: Standard chat parameters for the Vercel AI SDK.
  - `current_commit`: Injects contextual summary (full summary without extensive commit history).
- **Response**: Forwarded Server-Sent Events (SSE) for live chat streaming on the frontend.

#### `v1/public/post/plan`
- **Purpose**: Instructs a backend agent to save and lock the current chat, routing context to the backend agent to generate a read-only remediation plan and transitioning the issue to `PENDING_APPROVAL`.
- **Parameters**:
  - `chat_params`: Chat parameters for Vercel AI SDK.
  - `current_commit`: Injects contextual summary.
- **Response**: Forwarded Server-Sent Events (SSE) for live chat streaming on the frontend.

#### `v1/public/post/approve`
- **Purpose**: Takes an issue or plan ID and executes an atomic database transaction transitioning the remediation plan from `PENDING_APPROVAL` to `RESOLVED` while writing the corresponding immutable audit log entry.

---

## System Design

- **Hybrid Split Runtime**: Vercel Edge hosts the SvelteKit SSR frontend, database read endpoints, and live SSE chat/planning passthrough endpoints (`v1/public/post/chat`, `v1/public/post/plan`); a local Node.js runner executes the heavy LangGraph multi-agent commit evaluation pipeline locally.
- **Lightweight Header Protection**: Internal bearer token on `v1/private/*` and passcode header on `v1/public/post/*` enforced via SvelteKit server hooks.
- **Database Consolidation & Strict Consistency**: A single primary ACID-compliant Neon Postgres instance stores reports, LangGraph checkpoints, and the audit log, supporting incremental updates as pipeline stages validate and as issues are resolved.

---

## Extension & Roadmap

### Post-Release Roadmap (Epics 1 to 4)

#### Epic 1: AI-Era "Vibe-Check" Watchdog Agent (v1.1)
Integrates an eighth parallel specialist agent node directly into the existing LangGraph fan-out chain and report schema, grading every commit against the empirical failure modes of AI-generated ("vibe-coded") software as a dedicated report line item.
- **Test Contingency and Bypass Detection**: Audits modified test files to catch coding agents that force test suites to pass by weakening assertions, mocking out core logic, or adding hardcoded fallback contingencies rather than fixing the root defect (Princeton University, 2023).
- **AI Code Churn and Block Duplication Auditing**: Scores diffs for copy-pasted code blocks and rapid file churn to counter AI maintainability decay, where autonomous coding increases block duplication by up to 81% instead of refactoring shared abstractions (Microsoft/MIT, 2023; GitClear, 2024).
- **Silent Error Swallowing and Telemetry Attribution**: Flags empty or generic catch blocks that hide failures without root-cause handling and verifies that newly committed logic emits structured logs and performance metrics (Princeton University, 2024).
- **Agentic Doom-Loop and FinOps Governance**: Inspects any newly committed agent graphs, prompts, or tool loops inside Terminus to verify programmatic Time-To-Live (TTL) hop limits, sliding-window tool-repetition detectors, and metered model routing that prevent runaway API spend.
- **Constitutional Harness and Global Rule Integrity**: Monitors changes to repository agent governance files (CLAUDE.md, .cursorrules, tasks.md, and deterministic pre-push hooks) to ensure intent formalization, blast-radius scoping, and formal constraints are never silently weakened (Anthropic, 2022; IEEE Software, 2024).
- **AI SecOps and Excessive Agency Scanning**: Evaluates committed MCP servers, tool definitions, and credentials against OWASP AI security risks, flagging over-privileged agent roles, unscoped shell or network access, prompt injection surfaces, and missing human regret-gate authorization (OWASP, 2025).

#### Epic 2: Git Lineage and API Hygiene (v1.2)
Addresses Git history edge cases—merges, rebases, forward-slash branch names, and pagination drift—that break report accuracy during normal repository activity.
- **Branch Parameter URL Encoding**: Enforce strict URL encoding on branch query parameters so standard Git branch names containing forward slashes parse cleanly across all endpoints.
- **Cursor-Based Pagination**: Replace page-offset pagination with commit-hash cursor pagination so simultaneous pushes to a branch head never shift page boundaries or cause agents to re-read commits.
- **Cross-Branch Commit Deduplication**: Key reports by commit hash with a one-to-many branch list so feature branch merges into the main branch tag existing reports onto the target branch instead of re-running the agent pipeline.
- **Content-Addressable Diff Hashing**: Compute a SHA-256 hash of the normalized code diff during ingestion so agents skip re-evaluating identical code changes that were rebased or cherry-picked under a new commit hash.
- **Force-Push and Rebase Lineage Reconciliation**: Reconcile stored branch reports against active Git commit lineage on every sync to mark reports tied to overwritten or force-pushed commits as superseded.

#### Epic 3: Pipeline Intelligence and Token Optimization (v1.3)
Reduces wasted model token spend on broken builds and eliminates hallucinated line citations before scaling commit volume.
- **Static Syntax Tree and Type Gatekeeping**: Add a pre-flight compiler and linter gate at the start of the workflow to reject commits with broken syntax or type errors before invoking the seven domain review agents.
- **Syntax-Aware Diff Chunking**: Upgrade diff splitting from basic file headers to an abstract syntax tree parser so large commits are chunked cleanly along complete function and class boundaries.
- **Adversarial Code Audit Gates**: Add a final critic node before publishing reports to cross-check every cited file name and line number against the raw diff and strip out hallucinated agent findings.

#### Epic 4: Security, Audit Governance, and Telemetry (v1.4)
Hardens data privacy, enforces database-level audit immutability, and adds cost profiling.
- **Automated Secret and Credential Redaction**: Pass raw code diffs through a pattern and entropy scrubber prior to model ingestion to strip accidentally committed secrets before they reach external language models or the database.
- **Database-Enforced Audit Immutability**: Revoke SQL update and delete permissions on the audit log table for the application database role so append-only audit integrity is enforced directly by Postgres.
- **End-to-End Agent Execution Tracing**: Persist per-agent token consumption, prompt versions, and execution latencies inside the full report record to enable granular cost auditing and latency profiling directly from the database.

---

### Future Considerations (Long-Term Horizon)

#### High-Throughput Concurrency and Fault Tolerance
Architectural upgrades required if Nova transitions from an on-demand, single-operator local batch runner to a high-concurrency, multi-worker cloud service:
- **Idempotent Action Execution**: Enforce atomic upserts keyed by commit hash and request idempotency headers across all write and planning routes so network retries never trigger duplicate workflows or records.
- **Optimistic Concurrency Control and State Versioning**: Add an integer state version counter to report records so concurrent updates from parallel workers or multiple operators automatically reject stale writes.
- **Compensating Transactions and Rollback Invariants**: Implement dedicated rollback nodes in the orchestration graph that undo partial state transitions and unlock chat sessions if a multi-step planning workflow fails midway.
- **Worker Concurrency Throttling and Backpressure**: Introduce a bounded task queue to throttle parallel commit evaluations and prevent model rate-limit exhaustion when scaling from on-demand syncs to continuous webhook streams.
- **Dead-Letter Queues for Poisoned Runs**: Isolate malformed or oversized commits that exhaust their retry budget into a dead-letter state so they are automatically skipped during subsequent repository syncs until manually cleared.

#### Autonomous Remediation and Continuous Integration Execution
Major functional expansions required if Nova transitions from a read-only review control plane into an active code-execution engine that runs test suites and opens pull requests automatically:
- **Asynchronous Continuous Integration Test Suite Integration**: Connect the commit evaluation pipeline to GitHub Actions webhooks so deterministic test suite results and failure logs attach asynchronously to reports once test runs finish, without delaying live agent evaluation.
- **Automated Ephemeral Branch and Pull Request Execution**: Activate the greyed-out hotfix action button in the interface by hooking approved remediation plans into GitHub Actions, automatically committing proposed code changes to an isolated ephemeral branch and opening a pull request.
- **Base Commit Hash Pinning**: Bind every proposed hotfix to the exact target branch commit hash it was planned against, automatically halting deployment and forcing a rebase if new commits land on the target branch during human review.
- **Isolated Test Runtime and Port Binding**: Provision dedicated ephemeral container sandboxes for each concurrent hotfix verification run so parallel test suites never collide on shared network ports or test databases.
- **Automated Branch Teardown and Garbage Collection**: Trigger a post-review cleanup hook that deletes temporary hotfix branches via the GitHub API immediately after a proposed fix is merged or rejected.

---

## Modifications (Architectural Divergences)

### 1. Serial Single-Criterion Orchestration (Supersedes Parallel Fan-Out)
- **Original Specification:** Multi-agent domain evaluations were designed to execute concurrently via a parallel fan-out and fan-in LangGraph topology.
- **Modified Architecture:** The evaluation pipeline now executes strictly in **series**, running one dedicated Quality Marker agent at a time in a linear chain (`Criterion_N -> Validator_N -> DB_Stream_N -> Criterion_N+1`), followed by the Present Issue Resolution Agent.
- **Engineering Rationale:**
  1. **Rate-Limit Compliance:** Parallel fan-out bursts immediately breach upstream LLM request-per-minute quotas (such as the 15 RPM Gemini tier limit), triggering `429 Too Many Requests` failures across concurrent nodes. Serial execution naturally paces token and request consumption without complex token-bucket throttling.
  2. **Granular Live Streaming & Checkpointing:** Executing and validating one marker at a time allows the local Node runner to checkpoint state to Neon Postgres and stream incremental progress to the frontend after every individual check, eliminating all-or-nothing batch stalls.
  3. **Domain Overhaul:** Replaces the 7 generic software domains with the 17 empirically grounded Quality Markers (of AI-Generated Code) framework.

