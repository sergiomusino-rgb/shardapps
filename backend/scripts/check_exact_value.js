// Script per verificare il valore esatto di totalum_app_id
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkExactValue() {
  console.log('🔍 Verifica valore esatto di totalum_app_id...\n');
  
  // 1. Mostra tutti i valori totalum_app_id con i caratteri
  const { data: allApps, error } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id')
    .not('totalum_app_id', 'is', null);
  
  if (error) {
    console.error('❌ Errore:', error.message);
    return;
  }
  
  console.log('📋 App con totalum_app_id:');
  allApps.forEach(app => {
    console.log(`  - "${app.totalum_app_id}" (lunghezza: ${app.totalum_app_id.length})`);
    console.log(`    name: "${app.name}", slug: "${app.slug}"`);
  });
  
  // 2. Prova la ricerca con LIKE
  const { data: likeResult, error: likeError } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id')
    .ilike('totalum_app_id', 'pizzeria');
  
  console.log('\n🔍 Ricerca con ILIKE "pizzeria":');
  if (likeError) {
    console.log('  Errore:', likeError.message);
  } else {
    console.log('  Risultati:', likeResult?.length || 0);
    likeResult?.forEach(app => {
      console.log(`  - "${app.totalum_app_id}"`);
    });
  }
}

checkExactValue().catch(err => {
  console.error('Errore generale:', err);
});