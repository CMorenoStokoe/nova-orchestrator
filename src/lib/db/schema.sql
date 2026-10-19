-- Nova Orchestrator Core Database Schema for Neon Postgres

CREATE TABLE IF NOT EXISTS reports (
    hash VARCHAR(64) PRIMARY KEY,
    branch VARCHAR(255) NOT NULL DEFAULT 'main',
    summary JSONB NOT NULL,
    "full" JSONB NOT NULL,
    resolved_by_commit VARCHAR(64),
    validation_status VARCHAR(32) NOT NULL DEFAULT 'INCOMPLETE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_branch ON reports(branch);
CREATE INDEX IF NOT EXISTS idx_reports_validation_status ON reports(validation_status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

CREATE TABLE IF NOT EXISTS remediation_plans (
    id VARCHAR(64) PRIMARY KEY,
    commit_hash VARCHAR(64) NOT NULL REFERENCES reports(hash) ON DELETE CASCADE,
    title TEXT NOT NULL,
    plan_markdown TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_remediation_plans_commit ON remediation_plans(commit_hash);
CREATE INDEX IF NOT EXISTS idx_remediation_plans_status ON remediation_plans(status);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(128) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    target_type VARCHAR(64),
    target_id VARCHAR(128),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
