require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');

const sql = fs.readFileSync('c:/Users/sermu/zeusx/supabase_migrations/20260704_create_fatture_tables.sql', 'utf8');

async function run() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY deve essere impostata in backend/.env');
  }

  const pool = new Pool({
    connectionString: `postgresql://postgres.ujdyqnzofclzztmppxea:${encodeURIComponent(process.env.SUPABASE_SERVICE_ROLE_KEY)}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected to Supabase PostgreSQL');
    
    await client.query(sql);
    console.log('✅ Migration executed successfully!');
    
    // Verify
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('fatture','righe_fattura')"
    );
    console.log('Tables created:', rows.map(r => r.table_name).join(', '));
    
    client.release();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
  
  await pool.end();
}

run();