import dotenv from 'dotenv';
import { query } from '../src/lib/db/client';

dotenv.config();

async function main() {
  const reportsCount = await query<{ count: string }>('SELECT COUNT(*) as count FROM reports;');
  const remediationCount = await query<{ count: string }>('SELECT COUNT(*) as count FROM remediation_plans;');
  const auditCount = await query<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs;');

  console.log('=== Database Row Counts ===');
  console.log('reports:', reportsCount.rows[0].count);
  console.log('remediation_plans:', remediationCount.rows[0].count);
  console.log('audit_logs:', auditCount.rows[0].count);

  const sampleReports = await query<{ hash: string; validation_status: string; created_at: string; updated_at: string; summary: any }>(
    'SELECT hash, validation_status, created_at, updated_at, summary FROM reports ORDER BY created_at DESC LIMIT 15;'
  );

  console.log('\n=== Inspection of Existing Reports ===');
  for (const row of sampleReports.rows) {
    const sum = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;
    const isVibeFormat = !!sum?.criteria_badges || !!sum?.criteria;
    const isLegacyDomainFormat = !!sum?.domain_badges?.['SEC'] || !!sum?.category_scores;
    console.log({
      hash: row.hash.slice(0, 7),
      status: row.validation_status,
      created_at: row.created_at,
      format: isVibeFormat ? 'VIBE_CHECK (17 criteria)' : (isLegacyDomainFormat ? 'LEGACY (7 domains: SEC, API, TST...)' : 'UNKNOWN'),
      criteria_keys_count: sum?.criteria ? Object.keys(sum.criteria).length : 0,
      has_steps: Array.isArray(sum?.steps) ? sum.steps.length : 0,
      composite_score: sum?.composite_score
    });
  }

  const fullRow = await query<{ full: any; summary: any }>('SELECT "full", summary FROM reports LIMIT 1;');
  if (fullRow.rows.length > 0) {
    const f = typeof fullRow.rows[0].full === 'string' ? JSON.parse(fullRow.rows[0].full) : fullRow.rows[0].full;
    const s = typeof fullRow.rows[0].summary === 'string' ? JSON.parse(fullRow.rows[0].summary) : fullRow.rows[0].summary;
    console.log('\n=== Full Object Keys ===', Object.keys(f));
    console.log('Criteria in full:', f.criteria ? Object.keys(f.criteria) : 'NONE');
    console.log('Domains in full:', f.domains ? Object.keys(f.domains) : 'NONE');
    console.log('Summary criteria_badges:', s.criteria_badges);
    console.log('Summary domain_badges:', s.domain_badges);
    if (f.steps) {
      console.log('\n=== Sample Step Comments in State Graph ===');
      f.steps.slice(0, 8).forEach((s: any) => {
        console.log(`[Step ${s.step_index}] ${s.node} (${s.status} / ${s.execution_status}):`);
        console.log(`  Comment: "${s.comment}"`);
      });
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
