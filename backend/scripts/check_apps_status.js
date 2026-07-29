// Check apps and tenant status
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkStatus() {
  console.log('🔍 Checking database status...\n');

  // Check tenants
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, owner_id, name, plan, app_limit, total_apps_created')
    .order('created_at', { ascending: false });

  if (tenantsError) {
    console.error('❌ Error fetching tenants:', tenantsError);
    return;
  }

  console.log('📊 TENANTS:');
  console.table(tenants || []);

  // Check apps
  const { data: apps, error: appsError } = await supabase
    .from('apps')
    .select('id, name, slug, tenant_id, created_at')
    .order('created_at', { ascending: false });

  if (appsError) {
    console.error('❌ Error fetching apps:', appsError);
    return;
  }

  console.log('\n📊 APPS:');
  console.table(apps || []);

  // Check app_registry
  const { data: registry, error: registryError } = await supabase
    .from('app_registry')
    .select('id, reseller_id, app_name, app_url, status, created_at')
    .order('created_at', { ascending: false });

  if (registryError) {
    console.error('❌ Error fetching app_registry:', registryError);
    return;
  }

  console.log('\n📊 APP_REGISTRY:');
  console.table(registry || []);

  // Check tenant_members
  const { data: members, error: membersError } = await supabase
    .from('tenant_members')
    .select('id, tenant_id, user_id, role')
    .order('created_at', { ascending: false });

  if (membersError) {
    console.error('❌ Error fetching tenant_members:', membersError);
    return;
  }

  console.log('\n📊 TENANT_MEMBERS:');
  console.table(members || []);
}

checkStatus().catch(console.error);