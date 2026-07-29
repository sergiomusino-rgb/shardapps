// Script per creare o aggiornare l'app "pizzeria" nel database
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY non definiti nel .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createOrUpdatePizzeriaApp() {
  console.log('🔧 Creazione/aggiornamento app "pizzeria"...\n');
  
  // Prima verifica se esiste già
  const { data: existingApp, error: checkError } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id, client_active')
    .eq('totalum_app_id', 'pizzeria')
    .single();
  
  if (checkError && checkError.code !== 'PGRST116') {
    console.error('❌ Errore nel controllo app esistente:', checkError.message);
    return;
  }
  
  if (existingApp) {
    console.log('✅ App "pizzeria" esiste già, aggiorno i valori...');
    
    // Aggiorna l'app esistente
    const { data: updated, error: updateError } = await supabase
      .from('apps')
      .update({
        name: 'La Mia Pizzeria',
        slug: 'pizzeria',
        client_active: true,
        client_subscription_price: 100.00,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingApp.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('❌ Errore nell\'aggiornamento:', updateError.message);
    } else {
      console.log('✅ App aggiornata con successo:');
      console.log('   ID:', updated.id);
      console.log('   Nome:', updated.name);
      console.log('   Slug:', updated.slug);
      console.log('   totalum_app_id:', updated.totalum_app_id);
      console.log('   client_active:', updated.client_active);
    }
  } else {
    console.log('❌ App "pizzeria" non esiste, la creo...');
    
    // Prima ottieni un tenant_id valido
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .limit(1);
    
    if (tenantError || !tenants || tenants.length === 0) {
      console.error('❌ Nessun tenant trovato nel database');
      return;
    }
    
    const tenantId = tenants[0].id;
    
    // Crea l'app
    const { data: created, error: createError } = await supabase
      .from('apps')
      .insert({
        tenant_id: tenantId,
        name: 'La Mia Pizzeria',
        slug: 'pizzeria',
        totalum_app_id: 'pizzeria',
        client_active: true,
        client_subscription_price: 100.00,
        config: {
          schema: {
            tables: [
              { name: 'menu', label: 'Menu', fields: [{ name: 'item', type: 'text', label: 'Piatto' }] },
              { name: 'orders', label: 'Ordini', fields: [{ name: 'customer', type: 'text', label: 'Cliente' }] }
            ]
          },
          branding: {
            company_name: 'La Mia Pizzeria',
            primary_color: '#ef4444'
          }
        }
      })
      .select()
      .single();
    
    if (createError) {
      console.error('❌ Errore nella creazione:', createError.message);
    } else {
      console.log('✅ App creata con successo:');
      console.log('   ID:', created.id);
      console.log('   Nome:', created.name);
      console.log('   Slug:', created.slug);
      console.log('   totalum_app_id:', created.totalum_app_id);
      console.log('   client_active:', created.client_active);
    }
  }
}

createOrUpdatePizzeriaApp().catch(err => {
  console.error('Errore generale:', err);
  process.exit(1);
});