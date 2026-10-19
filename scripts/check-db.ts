import dotenv from 'dotenv';
import { query } from '../src/lib/db/client';

dotenv.config();

async function check() {
	const reportsRes = await query<any>('SELECT hash, branch, validation_status, summary, created_at FROM reports ORDER BY created_at DESC;');
	console.log(`📊 Total Reports in Neon Postgres: ${reportsRes.rows.length}`);
	for (const r of reportsRes.rows) {
		const s = typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary;
		console.log(`- [${r.validation_status}] ${r.hash.substring(0, 7)}: score=${s.composite_score}, message="${s.message?.split('\n')[0]}"`);
	}

	const auditRes = await query<any>('SELECT id, action, actor, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5;');
	console.log(`\n📜 Recent Audit Logs (${auditRes.rows.length}):`);
	for (const a of auditRes.rows) {
		console.log(`- [${a.id}] ${a.action} by ${a.actor} at ${a.created_at}`);
	}

	process.exit(0);
}

check().catch(console.error);
