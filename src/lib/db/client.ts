import { Pool, type PoolClient } from '@neondatabase/serverless';

const connectionString =
	process.env.DATABASE_URL ||
	process.env.POSTGRES_URL ||
	'postgresql://neondb_owner:npg_vxRNqY4PJIo0@ep-still-butterfly-za6yhvwo-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require';

// Connection pool configured for Neon Postgres
export const pool = new Pool({
	connectionString,
	ssl: {
		rejectUnauthorized: false
	},
	max: 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000
});

export async function query<T = unknown>(text: string, params?: unknown[]) {
	const start = Date.now();
	const res = await pool.query(text, params);
	const duration = Date.now() - start;
	return { rows: res.rows as T[], rowCount: res.rowCount, duration };
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await callback(client);
		await client.query('COMMIT');
		return result;
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
}

export async function recordAuditLog(
	action: string,
	actor: string,
	details: Record<string, unknown> = {},
	target?: { type?: string; id?: string },
	client?: PoolClient
) {
	const sql = `
		INSERT INTO audit_logs (action, actor, target_type, target_id, details, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
	`;
	const params = [
		action,
		actor,
		target?.type || null,
		target?.id || null,
		JSON.stringify(details)
	];

	if (client) {
		return client.query(sql, params);
	}
	return pool.query(sql, params);
}
