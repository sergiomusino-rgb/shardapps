/**
 * ZeusX - Motore "Comandi"
 * Tipi TypeScript per le tabelle Supabase e schema Zod per l'estrazione
 * strutturata degli ordini vocali via LLM.
 */

import { z } from 'zod';

// ─── Tipi database ──────────────────────────────────────────────────────────

// Ruolo su tenant_members. 'agent': accesso ridotto (Catalogo in sola
// lettura + Raccolta Ordini), vedi useComandiRole e ComandiInstanceDashboard.
export type TenantMemberRole = 'owner' | 'admin' | 'member' | 'agent';

export type OrderStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

// Tabella catalog_items
export interface CatalogItem {
  id: string; // UUID
  tenant_id: string; // UUID
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  image_url: string | null;
  unit_price: number;
  stock_qty: number;
  unit_of_measure: string;
  is_active: boolean;
  // Colonne del file importato (app/api/catalog/import) senza un campo
  // nativo corrispondente (es. Brand, Formato/Confezione, Aliquota IVA di un
  // listino ingrosso reale): coppie nome colonna -> valore testuale.
  extra_fields: Record<string, string> | null;
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

// Tabella product_synonyms
export interface ProductSynonym {
  id: string; // UUID
  tenant_id: string; // UUID
  product_id: string; // UUID -> catalog_items.id
  spoken_alias: string;
  created_at: string; // TIMESTAMPTZ
}

// Tabella customers
export interface Customer {
  id: string; // UUID
  tenant_id: string; // UUID
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  vat_number: string | null; // Partita IVA o Codice Fiscale
  email: string | null;
  notes: string | null;
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

// Tabella orders
export interface Order {
  id: string; // UUID
  tenant_id: string; // UUID
  customer_id: string | null; // UUID -> customers.id (opzionale: cliente scelto dal selettore rapido)
  customer_name: string | null;
  customer_phone: string | null;
  agent_id: string | null; // UUID -> auth.users.id
  status: OrderStatus;
  total_amount: number;
  audio_transcript: string | null;
  confidence_score: number | null; // 0..1
  delivery_date: string | null; // DATE (YYYY-MM-DD)
  extracted_items: unknown; // JSONB: snapshot grezzo dell'estrazione AI, vedi ParsedOrderItem[]/DiscardedItem[]
  audio_url: string | null; // path nel bucket privato comandi-agent-audio, non un URL pubblico
  notes: string | null;
  delivery_note_number: string | null; // N. Bolla di Accompagnamento
  invoice_number: string | null; // N. Fattura
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

// Tabella order_items
export interface OrderItem {
  id: string; // UUID
  tenant_id: string; // UUID
  order_id: string; // UUID -> orders.id
  product_id: string | null; // UUID -> catalog_items.id (nullable: snapshot storico)
  product_name: string;
  unit_price: number;
  quantity: number;
  unit: string;
  subtotal: number;
  created_at: string; // TIMESTAMPTZ
}

// ─── Schema Zod: output strutturato dell'estrazione vocale via LLM ─────────

export const ParsedOrderItemSchema = z.object({
  product_id: z.uuid().nullable(),
  sku: z.string().nullable(),
  matched_name: z.string(),
  original_spoken_text: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  unit_price: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

export const DiscardedItemSchema = z.object({
  original_spoken_text: z.string(),
  reason: z.string(),
});

export const VoiceOrderExtractionSchema = z.object({
  tenant_id: z.uuid(),
  confidence_score: z.number().min(0).max(1),
  requires_manual_confirmation: z.boolean(),
  summary_text: z.string(),
  parsed_items: z.array(ParsedOrderItemSchema),
  discarded_items: z.array(DiscardedItemSchema),
});

export type ParsedOrderItem = z.infer<typeof ParsedOrderItemSchema>;
export type DiscardedItem = z.infer<typeof DiscardedItemSchema>;
export type VoiceOrderExtraction = z.infer<typeof VoiceOrderExtractionSchema>;
