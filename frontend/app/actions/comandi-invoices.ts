'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Fatture e Ricevute per Comandi ─────────────────────────────────────────
// Riusa le stesse tabelle (fatture/righe_fattura) e la stessa numerazione
// progressiva del modulo "Fatture" del motore a schema generato (vedi
// backend/routes/invoices.js e app/a/[slug]/fatture/*), ma con
// l'autenticazione Supabase Auth/Bearer token già in uso in tutto il resto
// di Comandi invece del vecchio sistema a password in localStorage — quel
// modulo non è utilizzabile così com'è per un tenant Comandi (nessuna
// app_session_{slug} in localStorage, nessun endpoint sul backend Express
// dedicato a un tenant Comandi). Le RLS su queste tabelle assumono
// tenant_id = auth.uid() (modello legacy a singolo owner): non applicabili
// al modello multi-membro di Comandi, quindi qui si passa sempre dal
// service role con verifica esplicita di membership, come per il resto del
// modulo (stesso principio di comandi-agents.ts).

function getServiceSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveMember(accessToken: string): Promise<{ userId: string; tenantId: string; role: string } | { error: string }> {
  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  const supabaseAdmin = getServiceSupabase();

  let userId: string | undefined;
  try {
    const userResult = await supabaseAuth.auth.getUser(accessToken);
    userId = userResult.data.user?.id || undefined;
  } catch (err) {
    console.error('[comandi-invoices] Auth error:', err);
  }
  if (!userId) return { error: 'Devi effettuare il login.' };

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = (membership as { tenant_id?: string } | null)?.tenant_id;
  const role = (membership as { role?: string } | null)?.role;
  if (!tenantId || !role) return { error: 'Nessun tenant associato all\'utente.' };
  // Un agente sul campo non emette documenti fiscali: fuori da AGENT_TABS,
  // stesso perimetro RBAC del resto del modulo.
  if (role === 'agent') return { error: 'Il tuo ruolo non può gestire fatture e ricevute.' };

  return { userId, tenantId, role };
}

export type InvoiceStato = 'bozza' | 'emessa' | 'pagata' | 'annullata';
export type InvoiceTipo = 'fattura' | 'ricevuta';

export interface InvoiceRecord {
  id: string;
  numeroFattura: string;
  anno: number;
  dataEmissione: string;
  clienteNome: string;
  clientePiva: string | null;
  clienteSdi: string | null;
  clienteIndirizzo: string | null;
  stato: InvoiceStato;
  tipoDocumento: InvoiceTipo;
  metodoPagamento: string | null;
  totale: number;
}

// ─── Elenco ──────────────────────────────────────────────────────────────

const ListInvoicesInputSchema = z.object({ accessToken: z.string().min(1) });

export interface ListInvoicesResult {
  success: boolean;
  invoices?: InvoiceRecord[];
  error?: string;
}

export async function listInvoicesAction(input: z.infer<typeof ListInvoicesInputSchema>): Promise<ListInvoicesResult> {
  const validation = ListInvoicesInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };

  const resolved = await resolveMember(validation.data.accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  const { data: fattureRows, error: fattureError } = await (supabaseAdmin as any)
    .from('fatture')
    .select('id, numero_fattura, anno, data_emissione, cliente_nome, cliente_piva, cliente_sdi, cliente_indirizzo, stato, tipo_documento, metodo_pagamento')
    .eq('tenant_id', resolved.tenantId)
    .order('created_at', { ascending: false });

  if (fattureError) {
    console.error('[listInvoicesAction] Errore lettura fatture:', fattureError);
    return { success: false, error: 'Errore nel caricamento dei documenti' };
  }

  const rows = (fattureRows || []) as any[];
  const ids = rows.map((r) => r.id);

  // Totali calcolati in un'unica query sulle righe di tutte le fatture,
  // invece di una query per fattura (N+1) come nella versione del motore a
  // schema generato.
  const totalsByInvoiceId = new Map<string, number>();
  if (ids.length > 0) {
    const { data: righeRows } = await (supabaseAdmin as any)
      .from('righe_fattura')
      .select('fattura_id, quantita, prezzo_unitario, aliquota_iva')
      .in('fattura_id', ids);

    for (const riga of (righeRows || []) as any[]) {
      const subtotal = riga.quantita * riga.prezzo_unitario * (1 + (riga.aliquota_iva || 0) / 100);
      totalsByInvoiceId.set(riga.fattura_id, (totalsByInvoiceId.get(riga.fattura_id) || 0) + subtotal);
    }
  }

  const invoices: InvoiceRecord[] = rows.map((r) => ({
    id: r.id,
    numeroFattura: r.numero_fattura,
    anno: r.anno,
    dataEmissione: r.data_emissione,
    clienteNome: r.cliente_nome,
    clientePiva: r.cliente_piva,
    clienteSdi: r.cliente_sdi,
    clienteIndirizzo: r.cliente_indirizzo,
    stato: r.stato,
    tipoDocumento: r.tipo_documento || 'fattura',
    metodoPagamento: r.metodo_pagamento,
    totale: totalsByInvoiceId.get(r.id) || 0,
  }));

  return { success: true, invoices };
}

// ─── Creazione ───────────────────────────────────────────────────────────

const InvoiceRigaInputSchema = z.object({
  descrizione: z.string().trim().min(1),
  quantita: z.number().positive(),
  prezzoUnitario: z.number().nonnegative(),
  aliquotaIva: z.number().min(0).max(100),
});

const CreateInvoiceInputSchema = z.object({
  tipoDocumento: z.enum(['fattura', 'ricevuta']),
  dataEmissione: z.string().min(1),
  clienteNome: z.string().trim().min(1, 'Il nome del cliente è obbligatorio'),
  clientePiva: z.string().trim().optional(),
  clienteSdi: z.string().trim().optional(),
  clienteIndirizzo: z.string().trim().optional(),
  metodoPagamento: z.string().trim().optional(),
  righe: z.array(InvoiceRigaInputSchema).min(1, 'Aggiungi almeno una riga'),
  accessToken: z.string().min(1),
});

export interface CreateInvoiceResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

export async function createInvoiceAction(input: z.infer<typeof CreateInvoiceInputSchema>): Promise<CreateInvoiceResult> {
  const validation = CreateInvoiceInputSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
  }
  const { tipoDocumento, dataEmissione, clienteNome, clientePiva, clienteSdi, clienteIndirizzo, metodoPagamento, righe, accessToken } = validation.data;

  // La ricevuta non richiede la P.IVA/CF del cliente (spesso un privato); la
  // fattura sì, per restare un documento fiscale valido — stessa regola del
  // modulo del motore a schema generato (backend/routes/invoices.js).
  if (tipoDocumento === 'fattura' && !clientePiva?.trim()) {
    return { success: false, error: 'La P.IVA/Codice Fiscale del cliente è obbligatoria per una fattura' };
  }

  const resolved = await resolveMember(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();
  const anno = new Date(dataEmissione).getFullYear() || new Date().getFullYear();

  // Numero progressivo reale: conta i documenti dello stesso tenant+tipo+anno
  // e assegna il prossimo, zero-padded — mai fidarsi di un numero passato
  // dal client.
  const { count: countEsistenti, error: countError } = await (supabaseAdmin as any)
    .from('fatture')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', resolved.tenantId)
    .eq('tipo_documento', tipoDocumento)
    .eq('anno', anno);

  if (countError) {
    console.error('[createInvoiceAction] Errore conteggio per numerazione:', countError);
    return { success: false, error: 'Errore nella generazione del numero documento' };
  }

  const numeroFattura = String((countEsistenti || 0) + 1).padStart(4, '0');

  const { data: fattura, error: fatturaError } = await (supabaseAdmin as any)
    .from('fatture')
    .insert({
      tenant_id: resolved.tenantId,
      numero_fattura: numeroFattura,
      anno,
      data_emissione: dataEmissione,
      cliente_nome: clienteNome,
      cliente_piva: clientePiva || null,
      cliente_sdi: clienteSdi || null,
      cliente_indirizzo: clienteIndirizzo || null,
      stato: 'bozza',
      metodo_pagamento: metodoPagamento || null,
      tipo_documento: tipoDocumento,
    })
    .select('id')
    .single();

  if (fatturaError || !fattura) {
    console.error('[createInvoiceAction] Errore creazione fattura:', fatturaError);
    return { success: false, error: 'Errore nella creazione del documento' };
  }

  const righeDaInserire = righe.map((r) => ({
    fattura_id: fattura.id,
    descrizione: r.descrizione,
    quantita: r.quantita,
    prezzo_unitario: r.prezzoUnitario,
    aliquota_iva: r.aliquotaIva,
  }));

  const { error: righeError } = await (supabaseAdmin as any).from('righe_fattura').insert(righeDaInserire);

  if (righeError) {
    console.error('[createInvoiceAction] Errore salvataggio righe:', righeError);
    await (supabaseAdmin as any).from('fatture').delete().eq('id', fattura.id);
    return { success: false, error: 'Errore nel salvataggio delle righe' };
  }

  return { success: true, invoiceId: fattura.id as string };
}

// ─── Aggiornamento stato ───────────────────────────────────────────────────

const UpdateInvoiceStatusInputSchema = z.object({
  invoiceId: z.uuid(),
  stato: z.enum(['bozza', 'emessa', 'pagata', 'annullata']),
  accessToken: z.string().min(1),
});

export interface UpdateInvoiceStatusResult {
  success: boolean;
  error?: string;
}

export async function updateInvoiceStatusAction(input: z.infer<typeof UpdateInvoiceStatusInputSchema>): Promise<UpdateInvoiceStatusResult> {
  const validation = UpdateInvoiceStatusInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };
  const { invoiceId, stato, accessToken } = validation.data;

  const resolved = await resolveMember(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  const { data: updated, error: updateError } = await (supabaseAdmin as any)
    .from('fatture')
    .update({ stato })
    .eq('id', invoiceId)
    .eq('tenant_id', resolved.tenantId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[updateInvoiceStatusAction] Errore aggiornamento:', updateError);
    return { success: false, error: 'Errore nell\'aggiornamento dello stato' };
  }
  if (!updated) {
    return { success: false, error: 'Documento non trovato o non appartenente al tuo account.' };
  }

  return { success: true };
}

// ─── Dettaglio con righe + dati azienda (per generare il PDF) ──────────────

const GetInvoiceInputSchema = z.object({
  invoiceId: z.uuid(),
  accessToken: z.string().min(1),
});

export interface InvoiceRigaDetail {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
  aliquotaIva: number;
}

export interface InvoiceDetail extends InvoiceRecord {
  righe: InvoiceRigaDetail[];
  azienda: {
    ragioneSociale: string;
    piva: string | null;
    indirizzo: string | null;
    telefono: string | null;
  };
}

export interface GetInvoiceResult {
  success: boolean;
  invoice?: InvoiceDetail;
  error?: string;
}

export async function getInvoiceAction(input: z.infer<typeof GetInvoiceInputSchema>): Promise<GetInvoiceResult> {
  const validation = GetInvoiceInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };
  const { invoiceId, accessToken } = validation.data;

  const resolved = await resolveMember(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  const { data: fattura, error: fatturaError } = await (supabaseAdmin as any)
    .from('fatture')
    .select('id, numero_fattura, anno, data_emissione, cliente_nome, cliente_piva, cliente_sdi, cliente_indirizzo, stato, tipo_documento, metodo_pagamento')
    .eq('id', invoiceId)
    .eq('tenant_id', resolved.tenantId)
    .maybeSingle();

  if (fatturaError || !fattura) {
    return { success: false, error: 'Documento non trovato o non appartenente al tuo account.' };
  }

  const { data: righeRows } = await (supabaseAdmin as any)
    .from('righe_fattura')
    .select('descrizione, quantita, prezzo_unitario, aliquota_iva')
    .eq('fattura_id', invoiceId);

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, vat_number, address, phone')
    .eq('id', resolved.tenantId)
    .single();

  const righe = ((righeRows || []) as any[]).map((r) => ({
    descrizione: r.descrizione,
    quantita: r.quantita,
    prezzoUnitario: r.prezzo_unitario,
    aliquotaIva: r.aliquota_iva,
  }));

  const totale = righe.reduce((sum, r) => sum + r.quantita * r.prezzoUnitario * (1 + r.aliquotaIva / 100), 0);
  const tenantRow = tenant as { name?: string; vat_number?: string; address?: string; phone?: string } | null;

  return {
    success: true,
    invoice: {
      id: fattura.id,
      numeroFattura: fattura.numero_fattura,
      anno: fattura.anno,
      dataEmissione: fattura.data_emissione,
      clienteNome: fattura.cliente_nome,
      clientePiva: fattura.cliente_piva,
      clienteSdi: fattura.cliente_sdi,
      clienteIndirizzo: fattura.cliente_indirizzo,
      stato: fattura.stato,
      tipoDocumento: fattura.tipo_documento || 'fattura',
      metodoPagamento: fattura.metodo_pagamento,
      totale,
      righe,
      azienda: {
        ragioneSociale: tenantRow?.name || 'Azienda',
        piva: tenantRow?.vat_number || null,
        indirizzo: tenantRow?.address || null,
        telefono: tenantRow?.phone || null,
      },
    },
  };
}
