// Script to create fatture tables in Supabase
// Run with: node migrate_tables.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAndCreateTables() {
  // Check if fatture table exists
  const { error } = await supabase.from('fatture').select('id', { count: 'exact', head: true });
  
  if (!error) {
    console.log('✅ Table fatture already exists');
    return;
  }
  
  console.log('Table fatture not found. Creating via REST API...');
  
  // The Supabase REST API doesn't support CREATE TABLE directly.
  // We need to use the service_role key as a PG connection or use the management API.
  
  // Approach: Use the Supabase Auth admin API? No, that doesn't support SQL.
  // 
  // Best approach for Supabase SaaS: Use the SQL editor via the Dashboard,
  // or use the supabase CLI, or use a direct PG connection.
  //
  // Since we don't have direct PG access and the pooler connection is failing,
  // let's try using the supabase-js client's .rpc() with a custom function
  // that we can create via the Supabase Dashboard SQL editor.
  
  // For now, log instructions:
  console.error('❌ Table fatture does not exist in Supabase.');
  console.error('');
  console.error('To create it, please run this SQL in the Supabase Dashboard SQL Editor:');
  console.error('  https://supabase.com/dashboard/project/ujdyqnzofclzztmppxea/sql/new');
  console.error('');
  console.error('SQL to execute:');
  
  const fs = require('fs');
  const sql = fs.readFileSync('c:/Users/sermu/zeusx/supabase_migrations/20260704_create_fatture_tables.sql', 'utf8');
  console.error(sql);
}

checkAndCreateTables().catch(console.error);