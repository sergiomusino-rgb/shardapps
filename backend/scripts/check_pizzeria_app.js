// Script per verificare se l'app "pizzeria" esiste nel database
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY non definiti nel .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkApp() {
  console.log('🔍 Verifica app con totalum_app_id = "pizzeria"...\n');
  
  // 1. Cerca per totalum_app_id
  const { data: appByTotalum, error: error1 } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id, client_active, created_at')
    .eq('totalum_app_id', 'pizzeria')
    .single();
  
  if (error1) {
    console.log('❌ App non trovata per totalum_app_id = "pizzeria"');
    console.log('   Errore:', error1.message);
  } else {
    console.log('✅ App trovata per totalum_app_id:');
    console.log('   ID:', appByTotalum.id);
    console.log('   Nome:', appByTotalum.name);
    console.log('   Slug:', appByTotalum.slug);
    console.log('   totalum_app_id:', appByTotalum.totalum_app_id);
    console.log('   client_active:', appByTotalum.client_active);
  }
  
  // 2. Cerca per slug
  const { data: appBySlug, error: error2 } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id, client_active, created_at')
    .eq('slug', 'pizzeria')
    .single();
  
  if (error2) {
    console.log('\n❌ App non trovata per slug = "pizzeria"');
  } else {
    console.log('\n✅ App trovata per slug:');
    console.log('   ID:', appBySlug.id);
    console.log('   Nome:', appBySlug.name);
    console.log('   Slug:', appBySlug.slug);
    console.log('   totalum_app_id:', appBySlug.totalum_app_id);
  }
  
  // 3. Mostra tutte le app esistenti
  const { data: allApps, error: error3 } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id, client_active, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error3) {
    console.log('\n❌ Errore nel recupero app:', error3.message);
  } else {
    console.log('\n📋 Ultime 10 app nel database:');
    allApps.forEach((app, i) => {
      console.log(`   ${i + 1}. name="${app.name}", slug="${app.slug}", totalum_app_id="${app.totalum_app_id}", client_active=${app.client_active}`);
    });
  }
  
  // 4. Verifica se ci sono app con totalum_app_id
  const { data: appsWithTotalum, error: error4 } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id')
    .not('totalum_app_id', 'is', null)
    .order('created_at', { ascending: false });
  
  if (error4) {
    console.log('\n❌ Errore nella ricerca app con totalum_app_id:', error4.message);
  } else {
    console.log('\n📋 App con totalum_app_id valorizzato:');
    appsWithTotalum.forEach((app, i) => {
      console.log(`   ${i + 1}. name="${app.name}", slug="${app.slug}", totalum_app_id="${app.totalum_app_id}"`);
    });
  }
}

checkApp().catch(err => {
  console.error('Errore generale:', err);
  process.exit(1);
});