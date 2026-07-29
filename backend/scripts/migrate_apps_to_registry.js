// Migrate existing apps to app_registry table
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function migrateApps() {
  console.log('🔄 Migrating existing apps to app_registry...');

  // Get all existing apps
  const { data: apps, error: appsError } = await supabase
    .from('apps')
    .select('id, name, slug, tenant_id')
    .not('slug', 'is', null);

  if (appsError) {
    console.error('❌ Error fetching apps:', appsError);
    return;
  }

  console.log(`📊 Found ${apps?.length || 0} apps to migrate`);

  for (const app of apps || []) {
    // Get the tenant owner (reseller)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('owner_id')
      .eq('id', app.tenant_id)
      .single();

    if (tenantError || !tenant) {
      console.log(`⚠️ Skipping app ${app.name} - no tenant found`);
      continue;
    }

    const appUrl = `https://zeusxapps.com/a/${app.slug}`;

    // Check if already in app_registry by app_url (more reliable)
    const { data: existing } = await supabase
      .from('app_registry')
      .select('id')
      .eq('app_url', appUrl)
      .single();

    if (existing) {
      console.log(`✅ App ${app.name} already in registry`);
      continue;
    }

    // Insert into app_registry
    const { error: insertError } = await supabase
      .from('app_registry')
      .insert({
        reseller_id: tenant.owner_id,
        app_name: app.name,
        app_url: appUrl,
        status: 'active',
        monthly_fee: 0.00,
        zeusx_share: 0.00,
      });

    if (insertError) {
      console.error(`❌ Error inserting app ${app.name}:`, insertError);
    } else {
      console.log(`✅ Migrated app: ${app.name}`);
    }
  }

  console.log('✅ Migration complete!');
}

migrateApps().catch(console.error);
