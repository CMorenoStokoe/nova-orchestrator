import dotenv from 'dotenv';
import { query } from '../src/lib/db/client';
import { getAllRepoCommits, getCommitDetails } from '../src/lib/github/client';
import { createCommitEvaluationGraph } from '../src/lib/runner/graph';

dotenv.config();

async function main() {
  console.log('🧹 [Flush] Starting database purge of stale legacy reports...');

  // 1. Delete stale remediation plans and reports
  await query('DELETE FROM remediation_plans;');
  console.log('✅ Cleared remediation_plans table');

  await query('DELETE FROM reports;');
  console.log('✅ Cleared reports table');

  // Insert audit record of the flush
  await query(
    `INSERT INTO audit_logs (action, actor, details) 
     VALUES ($1, $2, $3);`,
    [
      'DB_FLUSH_LEGACY_PURGE',
      'system',
      JSON.stringify({ reason: 'Purged stale 7-domain legacy reports to upgrade to 17-criterion Vibe-Check format' })
    ]
  );
  console.log('✅ Recorded audit log entry');

  // 2. Fetch the top commit from repository
  console.log('\n🔍 Fetching latest commit from repository...');
  const commits = await getAllRepoCommits({ maxCommits: 5 });
  if (commits.length === 0) {
    throw new Error('No commits found in repository');
  }

  const targetCommit = commits[0]; // HEAD commit
  console.log(`📌 Target Commit for single-commit pipeline: ${targetCommit.hash.slice(0, 7)} - "${targetCommit.message.split('\n')[0]}"`);

  // Fetch full details & unified diff
  const details = await getCommitDetails(targetCommit.hash);

  // 3. Initiate the 17-criterion serial LangGraph pipeline
  console.log('\n🚀 Initiating LangGraph 17-Criterion Serial Evaluation Pipeline...');
  const appGraph = createCommitEvaluationGraph();

  const startTime = Date.now();
  const result = await appGraph.invoke({
    commitHash: targetCommit.hash,
    branch: 'main',
    author: details.author,
    timestamp: details.timestamp,
    commitMsg: details.message,
    diff: details.diff,
    subsequentCommits: []
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 Pipeline Completed in ${durationSec}s!`);
  console.log(`Status: ${result.validationStatus}`);
  console.log(`Composite Score: ${result.summary?.composite_score}%`);
  console.log(`Steps Recorded: ${result.steps?.length || 0}`);
  console.log(`Criteria Evaluated: ${Object.keys(result.criteria || {}).length}/17`);

  // 4. Verify Neon Postgres contents
  const verifyRes = await query<{ count: string }>('SELECT COUNT(*) as count FROM reports;');
  console.log(`\n✅ Verified Neon Postgres: ${verifyRes.rows[0].count} live Vibe-Check report in database.`);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Pipeline run failed:', err);
  process.exit(1);
});
