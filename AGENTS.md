# Nova Orchestrator — Agent Guidelines & Subagent Protocol

This document governs the multi-agent development workflow, architectural constraints, and subagent delegation protocols for Nova Orchestrator in Google Antigravity.

---

## 1. Architecture Overview

Nova Orchestrator evaluates Git commits through a strict serial LangGraph pipeline across **17 Quality Markers (of AI-Generated Code)**, persisting verdicts, steps, findings, and immutable audit logs into Neon Postgres.

- **Frontend**: SvelteKit 2 + Svelte 5 (Runes: `$state`, `$derived`, `$effect`) + Tailwind CSS.
- **Backend**: SvelteKit server routes (`src/routes/v1/...`) with ACID transactions and route protection.
- **Database**: Serverless Neon PostgreSQL (`reports`, `findings`, `remediation_plans`, `audit_logs`).
- **Pipeline**: LangGraph state graph evaluating 17 serial Quality Markers against Google Gemini LLM with dynamic rate-limiting (`429 RetryInfo`) backoff.

---

## 2. Specialized Subagents & Delegation Matrix

When tackling complex, multi-faceted tasks, delegate domain-specific work to the following specialized subagents using `invoke_subagent`:

| Subagent Name | Role Description | When to Invoke |
| :--- | :--- | :--- |
| **`ui-engineer`** | Frontend UI Specialist | Developing SvelteKit components, layouts, reactive rune logic, Tailwind CSS styling, responsive drawers, and interactive timeline feeds. |
| **`api-engineer`** | Backend & Database Engineer | Building/updating REST endpoints (`src/routes/v1/`), database schemas, Neon Postgres client logic, auth tokens, and API test suites. |
| **`pipeline-manager`** | Agent Pipeline Orchestrator | Running commit evaluation batches, modifying LangGraph evaluation graphs, updating Quality Marker agent prompts, and handling LLM backoff. |
| **`research`** | Codebase & Web Researcher | Broad survey of codebase, external API research, or reading extensive documentation without polluting main context. |

### Delegation Best Practices
1. **Parallel Execution**: Independent tasks (e.g. backend API route creation by `api-engineer` while `ui-engineer` builds the corresponding frontend component) should be invoked concurrently.
2. **Synchronous Verification**: After a subagent reports back, always verify compilation (`npm run check`) and execute relevant test suites.
3. **Live Dev Server**: Previewing and UI validation must always be tested directly against the running SvelteKit dev server (`http://localhost:5173`). No standalone static HTML preview artifacts.

---

## 3. Strict Project Conventions & Invariants

All agents and subagents must adhere strictly to these rules:

1. **Terminology**:
   - Strictly name the evaluation criteria: **Quality Markers (of AI-Generated Code)** (or **Quality Markers** in compact badges/pills).
   - Never use "vibe-check" in user-facing UI, documentation, or new code.
2. **Confidence Scores**:
   - Always display confidence scores as percentages with `%` (e.g. `92%`, `76%`, never raw floats like `0.92`).
3. **Step Rationales & Audit Trail**:
   - Every pipeline step must record an explicit 1–2 sentence comment explaining *why* it passed, warned, or failed.
   - Access to step execution logs and system audit records is localized to each report via the **"Audit Trail & Steps"** localized button.
4. **Data Safety**:
   - Never run raw destructive SQL `DROP` or `TRUNCATE` commands on production tables without explicit confirmation.
5. **Code Quality Gate**:
   - Always run `npm run check` and verify 0 errors and 0 warnings before concluding any task.
