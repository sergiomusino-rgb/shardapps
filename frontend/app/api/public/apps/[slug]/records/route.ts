// ─── Public Records API (Next.js App Router) ────────────────────────────────
// GET /api/public/apps/[slug]/records?entity=<nome_entita>&include_relations=true
// Lettura pubblica, senza autenticazione, sola lettura: alimenta le sezioni
// "list" del sito pubblico generato dal motore Sito/PWA (Creator v2,
// site-schema.ts) con i record reali di app_records, al posto dei dati mock
// mostrati finora da SitePreview.tsx (vedi commento in testa a quel file:
// "leggere i record reali di app_records da una pagina pubblica
// richiederebbe un endpoint di lettura senza autenticazione" — è questo).
//
// Superficie volutamente minima, per non diventare un endpoint di
// scraping/export mascherato del dataset di un tenant:
// - solo entità dichiarate in adminPanel.entities dello schema pubblicato
//   (nessun table_name arbitrario);
// - solo le colonne id/data di app_records (mai tenant_id o altri metadati);
// - paginato (max 50 record per richiesta) e rate-limitato per slug+IP.
//
// include_relations=true (opzionale, default false): risolve i campi
// type:'relation' dell'entità nell'etichetta leggibile (displayField) del
// record correlato, esposta per record come `relations: { [fieldId]: label }`
// accanto a `data` (che continua a contenere l'id grezzo) — vedi
// resolveRelationLabels sotto. Una query per campo di relazione, non per
// record: evita N+1 anche con una pagina piena.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { sanitizeSiteBlueprint, type AdminEntity } from '@/src/lib/site-schema';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// ─── Fase 5 audit, Gap #1 (P0) — bypass RBAC in lettura ────────────────────
// Fino a questa patch, qualunque entità dichiarata in adminPanel.entities era
// leggibile da qui senza credenziali, indipendentemente dal fatto che l'app
// avesse auth_mode='rbac'/authConfig.enabled: le due feature sono state
// costruite in fasi diverse (questo endpoint in Fase 1-2, RBAC in Fase 3) e
// non erano mai state riconciliate. Un'entità "interna" (gestita solo dal
// pannello admin dietro login) non ha nulla che la distingua, nello schema,
// da un'entità pensata per una sezione pubblica (es. il menu di un
// ristorante) — l'unico segnale affidabile è se quell'entità è REALMENTE
// referenziata da una sezione 'list'/'form' di una pagina pubblica del
// blueprint (le uniche due che portano un campo `entity`, vedi
// ListSectionSchema/FormSectionSchema in site-schema.ts). Se l'app non è
// rbac, comportamento invariato (nessuna app legacy ha mai avuto bisogno di
// questo controllo, ed è così che le sezioni pubbliche hanno sempre
// funzionato finora).
function isEntityExposedInPublicPages(blueprint: { pages: { sections: { type: string; entity?: string }[] }[] }, entityName: string): boolean {
  return blueprint.pages.some((page) =>
    page.sections.some((section) =>
      (section.type === 'list' || section.type === 'form') && section.entity === entityName
    )
  );
}

// ─── Risoluzione relazioni (?include_relations=true) ───────────────────────
// Disattivata di default: il chiamante che si accontenta degli id grezzi non
// deve pagare il costo di query aggiuntive. Quando richiesta, una query per
// CAMPO di relazione dell'entità (mai per singolo record): evita N+1 anche
// con una pagina piena di 50 record — resolveEntityRelations (site-schema.ts)
// ha già validato targetEntity/displayField in fase di sanitize, qui si
// ri-verifica comunque per difesa in profondità invece di fidarsi ciecamente
// di un campo che attraversa il confine di questo modulo.
async function resolveRelationLabels(
  entityDef: AdminEntity,
  entities: AdminEntity[],
  rows: { id: string; data: Record<string, unknown> }[],
  appId: string,
  tenantId: string
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  const relationFields = entityDef.fields.filter((f) => f.type === 'relation' && f.targetEntity && f.displayField);
  if (relationFields.length === 0 || rows.length === 0) return result;

  for (const field of relationFields) {
    const targetName = field.targetEntity as string;
    const displayField = field.displayField as string;
    const targetEntity = entities.find((e) => e.name === targetName);
    if (!targetEntity) continue;

    const ids = Array.from(new Set(
      rows
        .map((r) => r.data?.[field.id])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    ));
    if (ids.length === 0) continue;

    const { data: targetRows, error } = await supabase
      .from('app_records')
      .select('id, data')
      .eq('app_id', appId)
      .eq('tenant_id', tenantId)
      .eq('table_name', targetName)
      .in('id', ids);

    if (error || !targetRows) {
      if (error) console.error('[public/apps/records] relation resolve error:', error);
      continue;
    }

    const labelById = new Map(
      targetRows.map((r) => [r.id, String((r.data as Record<string, unknown> | null)?.[displayField] ?? '')])
    );

    for (const row of rows) {
      const rawValue = row.data?.[field.id];
      if (typeof rawValue !== 'string' || !rawValue) continue;
      const label = labelById.get(rawValue);
      if (label === undefined) continue;
      const existing = result.get(row.id) || {};
      existing[field.id] = label;
      result.set(row.id, existing);
    }
  }

  return result;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ success: false, error: 'slug mancante', code: 'MISSING_INPUT' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const entity = (searchParams.get('entity') || '').trim();
    if (!entity) {
      return NextResponse.json({ success: false, error: 'Parametro entity obbligatorio', code: 'MISSING_INPUT' }, { status: 400 });
    }

    // Rate limit restrittivo (slug+IP): endpoint senza autenticazione,
    // chiunque conosca lo slug pubblico può chiamarlo — senza un limite basso
    // diventerebbe un modo comodo per fare scraping/export mascherato
    // dell'intero dataset di un'entità.
    const { allowed } = await checkRateLimit(`public-app-records:${slug}:${getClientIp(request)}`, 60, 30);
    if (!allowed) {
      return NextResponse.json({ success: false, error: 'Troppe richieste, riprova tra poco.', code: 'RATE_LIMITED' }, { status: 429 });
    }

    const rawLimit = Number(searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
    const rawOffset = Number(searchParams.get('offset'));
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, tenant_id, config, client_active, auth_mode')
      .eq('slug', slug)
      .maybeSingle();

    // Stessa semantica di "app pubblicata e raggiungibile" usata dal gate di
    // accesso legacy (LegacyLoginGate, app/a/[slug]/page.tsx): client_active
    // = false vale "non trovata" anche qui, per non rivelare a un chiamante
    // anonimo l'esistenza di un'app bloccata.
    if (appError || !app || app.client_active === false) {
      return NextResponse.json({ success: false, error: 'App non trovata', code: 'APP_NOT_FOUND' }, { status: 404 });
    }

    // Solo app del motore Sito/PWA (Creator v2): se config non è un
    // SiteBlueprintJSON valido, questo endpoint non si applica (l'app usa il
    // vecchio motore tabellare, o il config è vuoto/corrotto).
    const blueprint = sanitizeSiteBlueprint(app.config);
    if (!blueprint) {
      return NextResponse.json({ success: false, error: 'App non trovata', code: 'APP_NOT_FOUND' }, { status: 404 });
    }

    // Solo entità dichiarate nello schema pubblicato: nessun riferimento a
    // table_name arbitrario, altrimenti questo endpoint diventerebbe una
    // lettura generica di qualunque tabella di qualunque tenant per chi
    // indovina il nome giusto.
    const entityDef = blueprint.adminPanel.entities.find((e) => e.name === entity);
    if (!entityDef) {
      return NextResponse.json({ success: false, error: 'Entità non trovata', code: 'ENTITY_NOT_FOUND' }, { status: 404 });
    }

    // Fase 5 audit, Gap #1 (P0): un'app rbac (auth_mode='rbac' — già
    // persistito al publish quando authConfig.enabled è true, vedi
    // creator/publish/route.ts — controllato anche su blueprint.authConfig
    // per coprire un config salvato ma non ancora riflesso su auth_mode, es.
    // durante una modifica non ancora ripubblicata) espone qui SOLO le
    // entità che il blueprint stesso rende pubbliche tramite una sezione
    // 'list'/'form': un'entità di sola gestione interna (RBAC-protetta nel
    // pannello admin) non deve mai essere leggibile senza credenziali.
    // Stessa risposta (404 "Entità non trovata") del ramo sopra, per non far
    // trapelare la differenza tra "entità inesistente" ed "entità esistente
    // ma non pubblica" a chi sta enumerando nomi di entità.
    const isRbacProtected = app.auth_mode === 'rbac' || blueprint.authConfig?.enabled === true;
    if (isRbacProtected && !isEntityExposedInPublicPages(blueprint, entity)) {
      return NextResponse.json({ success: false, error: 'Entità non trovata', code: 'ENTITY_NOT_FOUND' }, { status: 404 });
    }

    const { data: records, error: recordsError, count } = await supabase
      .from('app_records')
      .select('id, data', { count: 'exact' })
      .eq('app_id', app.id)
      .eq('tenant_id', app.tenant_id)
      .eq('table_name', entity)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (recordsError) {
      console.error('[public/apps/records] query error:', recordsError);
      return NextResponse.json({ success: false, error: 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    const rows = (records || []) as { id: string; data: Record<string, unknown> }[];
    const total = typeof count === 'number' ? count : offset + rows.length;

    // Risoluzione facoltativa dei campi di relazione (id -> etichetta del
    // record correlato): solo se richiesta esplicitamente, per non pagare il
    // costo di query aggiuntive quando il chiamante si accontenta degli id
    // grezzi (es. una sezione "list" senza campi di relazione da mostrare).
    const includeRelations = searchParams.get('include_relations') === 'true';
    const relationsById = includeRelations
      ? await resolveRelationLabels(entityDef, blueprint.adminPanel.entities, rows, app.id, app.tenant_id)
      : null;

    return NextResponse.json({
      success: true,
      data: {
        records: rows.map((r) => {
          const relations = relationsById?.get(r.id);
          return relations && Object.keys(relations).length > 0
            ? { id: r.id, data: r.data, relations }
            : { id: r.id, data: r.data };
        }),
        count: total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
    });
  } catch (err) {
    console.error('[public/apps/records] error:', err);
    return NextResponse.json({ success: false, error: 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
