import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString =
	process.env.DATABASE_URL ||
	process.env.POSTGRES_URL ||
	'postgresql://neondb_owner:npg_vxRNqY4PJIo0@ep-still-butterfly-za6yhvwo-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
	console.log('Connecting to Neon Postgres database...');
	const pool = new Pool({
		connectionString,
		ssl: { rejectUnauthorized: false }
	});

	try {
		const schemaPath = path.resolve('src/lib/db/schema.sql');
		const schemaSql = fs.readFileSync(schemaPath, 'utf8');

		console.log('Applying database schema...');
		await pool.query(schemaSql);
		console.log('✅ Core tables (reports, remediation_plans, audit_logs) created or already exist.');

		// Record initial migration in audit log
		await pool.query(
			`INSERT INTO audit_logs (action, actor, details, created_at)
			 VALUES ('DB_MIGRATION', 'system_setup', '{"status": "applied", "version": "1.0.0"}', NOW())`
		);
		console.log('✅ Audit log entry recorded.');
	} catch (error) {
		console.error('❌ Migration failed:', error);
		process.exit(1);
	} finally {
		await pool.end();
	}
}

migrate();
