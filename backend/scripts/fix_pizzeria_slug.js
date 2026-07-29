// Script per aggiornare lo slug dell'app "pizzeria" a "pizzeria"
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY non definiti nel .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixSlug() {
  console.log('🔧 Aggiornamento slug app "pizzeria"...\n');
  
  // Prima verifica se esiste l'app
  const { data: app, error } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id')
    .eq('totalum_app_id', 'pizzeria')
    .single();
  
  if (error || !app) {
    console.error('❌ App "pizzeria" non trovata');
    return;
  }
  
  console.log('App trovata:');
  console.log('  ID:', app.id);
  console.log('  Nome:', app.name);
  console.log('  Slug attuale:', app.slug);
  console.log('  totalum_app_id:', app.totalum_app_id);
  
  // Aggiorna lo slug
  const { data: updated, error: updateError } = await supabase
    .from('apps')
    .update({ slug: 'pizzeria' })
    .eq('id', app.id)
    .select()
    .single();
  
  if (updateError) {
    console.error('❌ Errore nell\'aggiornamento:', updateError.message);
  } else {
    console.log('\n✅ Slug aggiornato con successo a "pizzeria"');
    console.log('Ora l\'URL /a/pizzeria funzionerà correttamente!');
  }
}

fixSlug().catch(err => {
  console.error('Errore generale:', err);
  process.exit(1);
});