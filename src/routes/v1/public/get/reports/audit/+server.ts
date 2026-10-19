import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/db/client';

export interface UnifiedAuditEvent {
	id: string;
	timestamp: string;
	type: 'PIPELINE_STEP' | 'AUDIT_LOG' | 'GOVERNANCE';
	action: string;
	actor: string;
	status?: string;
	score?: number | null;
	comment?: string;
	criterion_code?: string;
	execution_status?: string;
	details?: Record<string, any>;
}

export const GET: RequestHandler = async ({ url }) => {
	const hash = url.searchParams.get('hash');

	if (!hash) {
		return json({ error: 'Missing required query parameter: hash' }, { status: 400 });
	}

	try {
		// 1. Fetch the report row to obtain full pipeline steps and metadata
		const reportSql = `
			SELECT 
				r.hash,
				r.branch,
				r.summary,
				r."full",
				r.validation_status,
				r.created_at,
				r.updated_at
			FROM reports r
			WHERE r.hash ILIKE $1 || '%'
			LIMIT 1;
		`;
		const reportRes = await query<any>(reportSql, [hash]);

		let reportRow: any = null;
		let steps: any[] = [];
		let fullReport: any = null;

		if (reportRes.rows.length > 0) {
			reportRow = reportRes.rows[0];
			fullReport = typeof reportRow.full === 'string' ? JSON.parse(reportRow.full) : reportRow.full;
			steps = fullReport?.steps || [];
		}

		// 2. Fetch all matching audit_logs for this commit
		const auditSql = `
			SELECT 
				id,
				action,
				actor,
				target_type,
				target_id,
				details,
				created_at
			FROM audit_logs
			WHERE target_id ILIKE $1 || '%'
			   OR details->>'commitHash' ILIKE $1 || '%'
			   OR details->>'commit_hash' ILIKE $1 || '%'
			ORDER BY created_at ASC;
		`;
		const auditRes = await query<any>(auditSql, [hash]);

		// 3. Synthesize unified event timeline
		const events: UnifiedAuditEvent[] = [];

		// Add pipeline steps
		for (const step of steps) {
			events.push({
				id: `step-${step.step_index}-${step.node}`,
				timestamp: step.timestamp || (reportRow?.created_at ? new Date(reportRow.created_at).toISOString() : new Date().toISOString()),
				type: 'PIPELINE_STEP',
				action: step.node,
				actor: 'nova-orchestrator',
				status: step.status,
				score: step.score,
				comment: step.comment || step.summary || (step.status === 'PASS' ? 'Quality Marker validated successfully.' : 'Evaluation completed.'),
				criterion_code: step.criterion_code,
				execution_status: step.execution_status,
				details: {
					step_index: step.step_index,
					node: step.node,
					findings_count: step.findings?.length || 0
				}
			});
		}

		// Add system audit logs
		for (const log of auditRes.rows) {
			const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
			events.push({
				id: `audit-${log.id}`,
				timestamp: new Date(log.created_at).toISOString(),
				type: log.action.includes('APPROVE') || log.action.includes('OVERRIDE') ? 'GOVERNANCE' : 'AUDIT_LOG',
				action: log.action,
				actor: log.actor || 'system',
				status: details?.validationStatus || details?.status || 'INFO',
				score: details?.compositeScore ?? details?.score ?? null,
				comment: details?.reason || details?.summary || `Audit record for ${log.action} on ${log.target_type || 'report'}`,
				details: details
			});
		}

		// Sort events chronologically (earliest first, or by timestamp)
		events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		return json({
			commit_hash: reportRow?.hash || hash,
			total_events: events.length,
			steps_count: steps.length,
			audit_logs_count: auditRes.rows.length,
			events,
			audit_logs: auditRes.rows,
			steps
		});
	} catch (error: any) {
		console.error(`Failed to fetch unified audit trail for ${hash}:`, error);
		return json({ error: 'Internal server error', details: error.message }, { status: 500 });
	}
};
