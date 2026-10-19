import dotenv from 'dotenv';
import { query } from '../src/lib/db/client';

dotenv.config();

async function main() {
  const t0 = Date.now();
  const reports = await query<{ hash: string; validation_status: string }>('SELECT hash, validation_status FROM reports LIMIT 10;');
  console.log(`Query took ${Date.now() - t0}ms`);
  console.log('Sample hashes:', reports.rows);
  
  if (reports.rows.length > 0) {
    const fullHash = reports.rows[0].hash;
    const shortHash = fullHash.substring(0, 7);
    
    const t1 = Date.now();
    const byFull = await query('SELECT hash, validation_status FROM reports WHERE hash = $1;', [fullHash]);
    console.log(`Lookup by full hash (${fullHash}) took ${Date.now() - t1}ms. Found: ${byFull.rows.length}`);
    
    const t2 = Date.now();
    const byShort = await query('SELECT hash, validation_status FROM reports WHERE hash = $1 OR hash LIKE $2;', [shortHash, shortHash + '%']);
    console.log(`Lookup by short hash (${shortHash}) took ${Date.now() - t2}ms. Found: ${byShort.rows.length}`);
  }
}

main().catch(console.error);
