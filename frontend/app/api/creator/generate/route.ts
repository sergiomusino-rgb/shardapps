// ─── Creator AI Generate API Route (Next.js App Router) ───────────────────────────────
// Genera lo schema JSON di anteprima tramite OpenRouter (Claude Sonnet 5), CON
// INIEZIONE DEL DESIGN SYSTEM. Non salva nulla: la persistenza avviene solo
// dopo conferma dell'utente su /api/creator/create (vedi DynamicAppPreview).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getDesignSystemForSector } from '@/lib/designSystemLoader';
import { sanitizeBlueprint, normalizeSector } from '@/src/lib/blueprint-schema';
import { sanitizeSiteBlueprint, ProjectTypeSchema, type ProjectType, type SiteBlueprintJSON } from '@/src/lib/site-schema';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } from '@/src/lib/ai-router';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  CREATOR_ADMIN_USER_ID,
} from '@/src/lib/creator-server';

// Duplicato intenzionalmente da src/lib/LanguageContext.tsx (SUPPORTED_LOCALES):
// quel modulo è 'use client' e importarlo da una route API server-side
// trascinerebbe inutilmente i dizionari i18n nel bundle server.
const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'de', 'es'] as const;

// Configurazione Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// ─── Helper: genera lo schema tramite l'AI Router (tier "advanced": generazione
// completa di una nuova app, es. Claude Sonnet 5 via OpenRouter) ────────────────
async function callSchemaGenerator(
  prompt: string,
  sector: string,
  lang: string,
  context: { userId: string; tenantId: string }
): Promise<any> {
  // Carica il design system per il settore
  const designSystem = await getDesignSystemForSector(sector);

  const systemPrompt = `Sei ShardApps AI, un assistente specializzato nella generazione di applicazioni SaaS.
Genera uno schema JSON per un'applicazione di ${sector} in lingua ${lang}.

${designSystem.systemPrompt}

Rispondi SOLO con un JSON valido con la seguente struttura:
{
  "appName": "Nome dell'app",
  "description": "Descrizione breve",
  "sector": "${sector}",
  "ui": {
    "primaryColor": "${designSystem.designTokens?.colors?.primary || '#6366f1'}"
  },
  "schema": {
    "tables": [
      {
        "name": "nome_tabella",
        "label": "Etichetta singolare (es. Pizza, Ordine, Prenotazione)",
        "labelPlural": "Etichetta plurale REALE (es. Pizze, Ordini, Prenotazioni) - MAI la parola generica 'Tabelle'",
        "icon": "📄",
        "fields": [
          {"name": "id", "type": "id", "label": "ID"},
          {"name": "nome_campo", "type": "string", "label": "Etichetta Campo"}
        ]
      }
    ]
  }
}

Crea tabelle e campi SPECIFICI per il settore richiesto. Non usare nomi generici come "nome_tabella" o "nome_campo".
"labelPlural" è OBBLIGATORIO per ogni tabella e deve essere il plurale reale e specifico dell'entità (es. "Ordini", "Prenotazioni", "Menu Pizze", "Clienti") — non usare mai letteralmente la parola "Tabelle" o "Tabella".
Se una tabella rappresenta ordini/prenotazioni/richieste, includi sempre un campo "stato"/"status" di tipo "select" con opzioni di stato realistiche per il settore (es. "In preparazione", "Pronto", "Consegnato" per un ordine di cibo).
Se una tabella rappresenta prodotti/piatti/servizi in vendita, includi sempre un campo prezzo di tipo "number" con nome contenente "prezzo" o "totale".
Non aggiungere testo prima o dopo il JSON.`;

  // "app-generation" -> tier "advanced" (Claude Sonnet 5 via OpenRouter di
  // default): è il caso d'uso di generazione complessa per cui esiste il tier
  // avanzato del router (nuova app completa da prompt).
  const { content } = await callAiRouter({
    task: 'app-generation',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    context: { userId: context.userId, tenantId: context.tenantId },
  });
  console.log('[creator/generate] RAW RESPONSE:', content);

  try {
    const parsed = extractJsonFromAiContent(content) as any;
    // Assicura che ui esista
    if (!parsed.ui) {
      parsed.ui = {
        primaryColor: designSystem.designTokens?.colors?.primary || '#6366f1',
      };
    }
    return parsed;
  } catch (parseError) {
    console.error('[creator/generate] JSON parse error:', parseError, content);
    throw parseError;
  }
}

// ─── Master System Prompt: motore Sito Vetrina / Web App-PWA / E-Commerce ──────────
// Distinto dal generatore di gestionali sopra (callSchemaGenerator, tabelle
// admin): questo produce un SiteBlueprintJSON (site-schema.ts) con pagine
// PUBBLICHE oltre al pannello admin. Il modello riceve il contratto JSON per
// intero — incluso il vocabolario chiuso dei tipi di sezione — perché
// sanitizeSiteBlueprint scarta silenziosamente qualunque sezione con un
// `type` non riconosciuto: se il prompt non lo vincola esplicitamente, il
// modello inventa tipi liberi e mezza pagina sparisce in fase di validazione.
const SITE_SECTION_TYPES_DOC = `Ogni sezione di pagina DEVE avere uno di questi "type" (nessun altro valore è ammesso):
- "hero": { type, title, subtitle?, imageUrl?, ctaLabel?, ctaHref? } — intestazione principale della Home.
- "about": { type, title, body, imageUrl? } — storia/chi siamo.
- "gallery": { type, title?, images: string[] } — galleria immagini. Lascia images: [] se non hai URL di immagini reali: l'app mostra da sola dei placeholder puliti al posto delle foto mancanti. NON inventare un URL Unsplash "plausibile": un ID foto inventato spesso non esiste davvero e appare come immagine rotta sul sito pubblico.
- "list": { type, title?, entity, layout: "grid"|"list", emptyLabel? } — elenco dinamico di elementi di un'entità di adminPanel.entities (es. "entity":"prodotti" per il Menu/Catalogo). NON inventare i dati qui: solo il riferimento all'entità, i dati veri arrivano dal pannello admin.
- "form": { type, title?, entity?, submitLabel? } — form collegato a un'entità admin (es. "prenotazioni" per la pagina Prenota); se entity è vuoto è un form di contatto generico.
- "contact": { type, title?, showMap, showForm } — riepilogo contatti (usa i dati di businessConfig), mappa e/o form opzionali.
- "reviews": { type, title?, items: [{author, text, rating}] } — recensioni clienti (2-4 esempi plausibili per il settore).
- "cta": { type, title, subtitle?, buttonLabel, buttonHref? } — invito all'azione.
- "text": { type, title?, body } — blocco di testo libero.`;

// Nomi estesi delle lingue supportate (vedi SUPPORTED_LOCALES in
// LanguageContext.tsx): i modelli seguono un vincolo di lingua molto più
// affidabilmente quando espresso per nome che per solo codice ISO.
const LANG_NAMES: Record<string, string> = {
  it: 'italiano',
  en: 'inglese',
  fr: 'francese',
  de: 'tedesco',
  es: 'spagnolo',
};

async function callSiteSchemaGenerator(
  prompt: string,
  projectType: ProjectType,
  lang: string,
  context: { userId: string; tenantId: string }
): Promise<any> {
  const designSystem = await getDesignSystemForSector(projectType === 'ecommerce' ? 'ecommerce' : 'food');
  const langName = LANG_NAMES[lang] || LANG_NAMES.it;

  const projectTypeGuide: Record<ProjectType, string> = {
    'landing': 'Sito Vetrina/Landing per un professionista o artigiano: pagine tipiche Home, Chi Siamo/Galleria, Contatti. adminPanel.entities può restare vuoto o contenere al massimo una entità semplice (es. "richieste" per il form contatti) — non serve un catalogo prodotti.',
    'webapp-pwa': 'Web App/PWA per un\'attività con menu e prenotazioni (ristorante, pizzeria, salone): pagine tipiche Home, Menu (sezione "list" collegata a un\'entità "menu" o "servizi"), Prenota (sezione "form" collegata a un\'entità "prenotazioni"), Contatti. adminPanel.entities DEVE includere le entità referenziate dalle sezioni "list"/"form" delle pagine, con campi realistici del settore.',
    'ecommerce': 'E-Commerce Vetrina per un negozio: pagine tipiche Home, Catalogo (sezione "list" collegata a un\'entità "prodotti" con almeno i campi nome/prezzo/immagine/descrizione), Contatti. adminPanel.entities DEVE includere l\'entità prodotti referenziata dal Catalogo. Gli ordini avvengono via WhatsApp o alla cassa: NON generare un carrello o un checkout, usa piuttosto un actionButton "whatsapp" per ordinare.',
  };

  const systemPrompt = `Sei ShardApps AI, un architetto di siti web e PWA per piccole attività. Genera uno schema JSON per un progetto di tipo "${projectType}" in lingua ${langName} (${lang}).

${projectTypeGuide[projectType]}

Rispondi SOLO con un JSON valido con ESATTAMENTE questa struttura (nessun testo prima o dopo, nessun blocco markdown):
{
  "projectType": "${projectType}",
  "appName": "Nome dell'attività/progetto",
  "sector": "settore in kebab-case",
  "description": "Descrizione breve",
  "businessConfig": {
    "name": "Nome attività",
    "logoUrl": "",
    "heroImageUrl": "URL immagine plausibile per la hero, o stringa vuota",
    "tagline": "Frase breve d'effetto",
    "description": "Descrizione dell'attività per la pagina Chi Siamo",
    "address": "Indirizzo plausibile per il settore/città menzionati nel prompt, altrimenti generico",
    "whatsapp": "+39 000 000 0000",
    "phone": "+39 000 000 0000",
    "email": "info@esempio.it",
    "openingHours": [{"day": "Lun-Ven", "hours": "09:00-19:00"}, {"day": "Sab-Dom", "hours": "10:00-13:00"}],
    "language": "${lang}"
  },
  "adminPanel": {
    "entities": [
      {
        "name": "nome_entita_snake_case",
        "label": "Etichetta singolare",
        "labelPlural": "Etichetta plurale REALE (mai la parola generica \\"Elementi\\")",
        "icon": "📄",
        "fields": [
          {"id": "id", "type": "id", "label": "ID"},
          {"id": "nome_campo", "type": "text", "label": "Etichetta Campo"}
        ]
      }
    ]
  },
  "pages": [
    {
      "slug": "home",
      "label": "Home",
      "sections": [ /* vedi vocabolario sezioni sotto */ ]
    }
  ],
  "actionButtons": [
    {"type": "call", "label": "Chiama Ora", "value": ""},
    {"type": "whatsapp", "label": "Ordina su WhatsApp", "value": ""},
    {"type": "map", "label": "Mappa", "value": ""}
  ],
  "ui": { "primaryColor": "${designSystem.designTokens?.colors?.primary || '#6366f1'}" }
}

${SITE_SECTION_TYPES_DOC}

Regole tassative:
- Ogni pagina deve avere almeno una sezione.
- I campi di actionButtons.value per "call"/"whatsapp" possono restare vuoti: verranno risolti a runtime da businessConfig.phone/whatsapp. Valorizzali solo se il prompt indica un numero specifico diverso.
- Le entità in adminPanel.entities devono coprire TUTTE le "entity" referenziate dalle sezioni "list"/"form" di ogni pagina: nessun riferimento a un'entità inesistente.
- Ogni campo di un'entità con un valore economico (prezzo, tariffa, costo) deve avere "type":"number".
- TUTTI i campi di businessConfig sono OBBLIGATORI e NON possono restare stringhe vuote (eccetto logoUrl, che può restare "" in assenza di un logo reale): name, tagline, description, address, phone, whatsapp, email, openingHours (almeno 2 righe). Estraili dal prompt dell'utente quando presenti; per ogni campo non specificato esplicitamente, inventa un valore plausibile e coerente con settore/città/nome menzionati nel prompt (es. un indirizzo credibile per quella città, orari tipici del settore, un'email nella forma info@<dominio-plausibile-da-appName>.it) — mai lasciare un placeholder letterale tipo "N/A" o il campo vuoto.
- VINCOLO DI LINGUA TASSATIVO: ogni testo generato — appName, description, TUTTI i campi di businessConfig (tagline, description, address, openingHours.day/hours inclusi), label/labelPlural/icon-caption delle entità in adminPanel.entities, label dei fields, titoli/sottotitoli/body/label di OGNI sezione di pagina (hero, about, gallery, list, form, contact, reviews, cta, text), label degli actionButtons, i dati di esempio (recensioni, gallery caption) — deve essere scritto SOLO in ${langName} (${lang}), senza mescolare altre lingue nemmeno parzialmente. Il campo "businessConfig.language" deve valere esattamente "${lang}". Fanno eccezione solo identificatori tecnici non testuali: "name"/"id" delle entità e dei campi (snake_case), "slug" delle pagine, "type" dei campi/sezioni, valori URL/telefono/email.
- Non aggiungere testo prima o dopo il JSON.`;

  const { content } = await callAiRouter({
    task: 'app-generation',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    context: { userId: context.userId, tenantId: context.tenantId },
  });
  console.log('[creator/generate] SITE RAW RESPONSE:', content);

  return extractJsonFromAiContent(content);
}

// Rimuove i diacritici (es. "città" -> "citta") normalizzando in NFD e
// scartando i code point dei combining marks (U+0300-U+036F): niente regex
// con escape unicode per evitare ambiguità di codifica nel sorgente.
function stripDiacritics(input: string): string {
  return Array.from(input.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0) || 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
}

function slugifyForEmail(name: string): string {
  const slug = stripDiacritics(name.toLowerCase()).replace(/[^a-z0-9]+/g, '').slice(0, 24);
  return slug || 'attivita';
}

// Rete di sicurezza server-side: il prompt istruisce già il modello a
// valorizzare ogni campo di businessConfig, ma un modello può comunque
// restituire stringhe vuote — qui riempiamo con placeholder plausibili così
// il form "Impostazioni Attività" e le pagine pubbliche non mostrano mai
// campi vuoti (l'utente li corregge se non gli vanno bene, non deve prima
// notare che mancano).
// Placeholder di fallback per lingua: usati SOLO quando il modello lascia un
// campo vuoto nonostante l'istruzione esplicita nel prompt — devono restare
// coerenti con la lingua richiesta, altrimenti un'app in inglese/francese/
// tedesco/spagnolo si ritroverebbe testo italiano hardcoded (violerebbe lo
// stesso vincolo di lingua che stiamo imponendo al modello).
const BUSINESS_DEFAULTS_BY_LANG: Record<string, {
  tagline: (name: string) => string;
  description: (name: string, sector: string) => string;
  address: string;
  phone: string;
  whatsappFallback: string;
  emailTld: string;
  hours: { day: string; hours: string }[];
}> = {
  it: {
    tagline: (name) => `${name}: qualità e professionalità al tuo servizio.`,
    description: (name, sector) => `${name} è un punto di riferimento nel settore ${sector}, con un'attenzione costante alla qualità e alla soddisfazione del cliente.`,
    address: 'Via Roma 1, 00100 Roma (RM)',
    phone: '+39 06 1234567',
    whatsappFallback: '+39 333 1234567',
    emailTld: 'it',
    hours: [{ day: 'Lun-Ven', hours: '09:00-19:00' }, { day: 'Sab', hours: '09:00-13:00' }],
  },
  en: {
    tagline: (name) => `${name}: quality and professionalism at your service.`,
    description: (name, sector) => `${name} is a trusted name in the ${sector} industry, committed to quality and customer satisfaction.`,
    address: '123 Main Street, New York, NY 10001',
    phone: '+1 212 555 0100',
    whatsappFallback: '+1 212 555 0101',
    emailTld: 'com',
    hours: [{ day: 'Mon-Fri', hours: '9:00 AM-7:00 PM' }, { day: 'Sat', hours: '9:00 AM-1:00 PM' }],
  },
  fr: {
    tagline: (name) => `${name} : qualité et professionnalisme à votre service.`,
    description: (name, sector) => `${name} est une référence dans le secteur ${sector}, avec une attention constante à la qualité et à la satisfaction client.`,
    address: '1 Rue de la République, 75001 Paris',
    phone: '+33 1 23 45 67 89',
    whatsappFallback: '+33 6 12 34 56 78',
    emailTld: 'fr',
    hours: [{ day: 'Lun-Ven', hours: '09h00-19h00' }, { day: 'Sam', hours: '09h00-13h00' }],
  },
  de: {
    tagline: (name) => `${name}: Qualität und Professionalität zu Ihren Diensten.`,
    description: (name, sector) => `${name} ist eine feste Größe in der Branche ${sector}, mit stetigem Fokus auf Qualität und Kundenzufriedenheit.`,
    address: 'Hauptstraße 1, 10115 Berlin',
    phone: '+49 30 1234567',
    whatsappFallback: '+49 151 12345678',
    emailTld: 'de',
    hours: [{ day: 'Mo-Fr', hours: '09:00-19:00' }, { day: 'Sa', hours: '09:00-13:00' }],
  },
  es: {
    tagline: (name) => `${name}: calidad y profesionalidad a tu servicio.`,
    description: (name, sector) => `${name} es un referente en el sector ${sector}, con un compromiso constante con la calidad y la satisfacción del cliente.`,
    address: 'Calle Mayor 1, 28013 Madrid',
    phone: '+34 910 123 456',
    whatsappFallback: '+34 611 234 567',
    emailTld: 'es',
    hours: [{ day: 'Lun-Vie', hours: '09:00-19:00' }, { day: 'Sáb', hours: '09:00-13:00' }],
  },
};

function fillBusinessConfigDefaults(blueprint: SiteBlueprintJSON, lang: string): SiteBlueprintJSON {
  const defaults = BUSINESS_DEFAULTS_BY_LANG[lang] || BUSINESS_DEFAULTS_BY_LANG.it;
  const bc = { ...blueprint.businessConfig };
  const name = bc.name?.trim() || blueprint.appName;
  bc.name = name;
  if (!bc.tagline?.trim()) bc.tagline = defaults.tagline(name);
  if (!bc.description?.trim()) bc.description = defaults.description(name, blueprint.sector.replace(/-/g, ' '));
  if (!bc.address?.trim()) bc.address = defaults.address;
  if (!bc.phone?.trim()) bc.phone = defaults.phone;
  if (!bc.whatsapp?.trim()) bc.whatsapp = bc.phone?.trim() || defaults.whatsappFallback;
  if (!bc.email?.trim()) bc.email = `info@${slugifyForEmail(name)}.${defaults.emailTld}`;
  if (!bc.openingHours || bc.openingHours.length === 0) bc.openingHours = defaults.hours;
  // Vincolo deterministico: il locale attivo nel Creator AI al momento della
  // generazione decide sempre la lingua salvata, indipendentemente da cosa
  // riporta il modello in questo campo.
  bc.language = lang;
  return { ...blueprint, businessConfig: bc };
}

// ─── POST /api/creator/generate ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userPrompt, sector, lang: rawLang } = body;
    const safeSector = sector || 'saas';
    // Whitelist esplicita: non fidarsi di una stringa libera dal body per un
    // valore che finisce sia nel prompt del modello sia in businessConfig.language.
    const lang = (SUPPORTED_LOCALES as readonly string[]).includes(rawLang) ? rawLang : 'it';

    // Motore Sito/PWA (site-schema.ts): attivo solo quando il chiamante
    // passa esplicitamente `projectType` (vedi ProjectWizard.tsx). Ramo
    // separato e non distruttivo: il flusso storico sector-based sotto
    // (dashboard/creator, Template Verticali) resta invariato per chi non lo
    // passa, quindi questa route continua a servire entrambi i motori senza
    // che l'uno rompa l'altro.
    const projectTypeParse = ProjectTypeSchema.safeParse(body.projectType);
    if (projectTypeParse.success) {
      const projectType = projectTypeParse.data;

      if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
        return NextResponse.json({
          success: false,
          error: 'userPrompt è richiesto',
          code: 'MISSING_INPUT',
        }, { status: 400 });
      }

      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
      }
      const token = authHeader.slice(7);
      const user = await getUserFromToken(supabase, token);
      if (!user) {
        return NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401 });
      }

      const tenantId = await getOrCreateTenant(supabase, user, token);
      const { allowed, reason } = await canCreateApp(supabase, tenantId, user.id);
      if (!allowed) {
        if (reason === 'SlotsExhausted') {
          return NextResponse.json({
            success: false,
            error: 'SlotsExhausted',
            message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
            redirectTo: '/pricing',
            code: 'SLOTS_EXHAUSTED',
          }, { status: 403 });
        }
        return NextResponse.json({ success: false, error: reason || 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
      }

      try {
        const rawSchema = await callSiteSchemaGenerator(userPrompt, projectType, lang, { userId: user.id, tenantId });
        const sanitized = sanitizeSiteBlueprint(rawSchema);
        if (!sanitized) {
          return NextResponse.json({
            success: false,
            error: 'Lo schema generato non è valido, riprova con un prompt più specifico',
            code: 'INVALID_SCHEMA',
          }, { status: 500 });
        }
        const blueprint = fillBusinessConfigDefaults(sanitized, lang);
        return NextResponse.json({ success: true, data: { schema: blueprint } });
      } catch (err) {
        console.error('[creator/generate] site engine error:', err);
        if (err instanceof AiRouterConfigError) {
          return NextResponse.json({ success: false, error: 'Servizio AI non configurato correttamente. Contatta il supporto.', code: 'AI_CONFIG_ERROR' }, { status: 500 });
        }
        if (err instanceof AiRouterError) {
          return NextResponse.json({ success: false, error: err.message, code: 'AI_PROVIDER_ERROR' }, { status: 502 });
        }
        return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
      }
    }

    // Validazione input
    if (!userPrompt && !sector) {
      return NextResponse.json({
        success: false,
        error: 'userPrompt o sector è richiesto',
        code: 'MISSING_INPUT'
      }, { status: 400 });
    }

    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);

    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'Utente non autenticato',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    // Verifica slot PRIMA di chiamare l'AI, per non sprecare budget se il
    // tenant ha già esaurito le app disponibili sul suo piano — anche in
    // anteprima non ha senso far generare uno schema che non si potrà salvare.
    const tenantId = await getOrCreateTenant(supabase, user, token);
    const { allowed, reason } = await canCreateApp(supabase, tenantId, user.id);

    if (!allowed) {
      if (reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      return NextResponse.json({
        success: false,
        error: reason || 'Errore controllo limite app',
        code: 'SLOTS_CHECK_ERROR',
      }, { status: 500 });
    }

    // Genera schema tramite l'AI Router (tier "advanced", con design system iniettato)
    const rawSchema = await callSchemaGenerator(
      userPrompt || `Genera un'app per ${safeSector}`,
      safeSector,
      lang,
      { userId: user.id, tenantId }
    );

    // Il settore scelto dall'utente è la fonte di verità (non quello, spesso
    // impreciso o assente, restituito dal modello) — determina layout e colori a runtime.
    rawSchema.sector = normalizeSector(safeSector);

    // FieldSchema (blueprint-schema.ts) valida solo `field.id`, ma il modello a
    // volte genera campi con `name` (formato storico atteso dal viewer). Senza
    // questo step, ogni campo privo di `id` collasserebbe sul default 'campo' di
    // Zod, producendo id duplicati tra i campi di una stessa tabella.
    if (Array.isArray(rawSchema?.schema?.tables)) {
      for (const t of rawSchema.schema.tables) {
        if (!t || typeof t !== 'object') continue;

        // Se il modello non fornisce labelPlural, TableSchema (blueprint-schema.ts)
        // lo forza sul default letterale 'Tabelle' — la stessa entità reale
        // (es. "Pizza") finirebbe con l'etichetta plurale generica invece di
        // qualcosa come "Pizze". Deriviamo un fallback dal label reale.
        if (!t.labelPlural && t.label) {
          const label = String(t.label).trim();
          // Pluralizzazione italiana approssimata (fallback: il modello dovrebbe
          // già fornire labelPlural esplicito, vedi prompt sopra).
          if (/a$/i.test(label)) t.labelPlural = `${label.slice(0, -1)}e`;
          else if (/[oe]$/i.test(label)) t.labelPlural = `${label.slice(0, -1)}i`;
          else t.labelPlural = label;
        }

        if (!Array.isArray(t?.fields)) continue;
        t.fields.forEach((f: any, index: number) => {
          if (!f || typeof f !== 'object' || f.id) return;
          const slug = String(f.label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          f.id = f.name || f.key || (slug ? slug : `campo_${index + 1}`);
        });
      }
    }

    // Valida/normalizza l'output del modello prima di restituirlo in anteprima:
    // rifiuta schemi malformati invece di mostrarli così come sono.
    const blueprint = sanitizeBlueprint(rawSchema);
    if (!blueprint) {
      return NextResponse.json({
        success: false,
        error: 'Lo schema generato non è valido, riprova con un prompt più specifico',
        code: 'INVALID_SCHEMA'
      }, { status: 500 });
    }

    // Nessun accesso al DB qui: l'anteprima è "gratuita" da rigenerare finché
    // l'utente non conferma esplicitamente su /api/creator/create.
    return NextResponse.json({
      success: true,
      data: {
        schema: blueprint,
      }
    });

  } catch (err) {
    console.error('[creator/generate] error:', err);
    if (err instanceof AiRouterConfigError) {
      return NextResponse.json({
        success: false,
        error: 'Servizio AI non configurato correttamente. Contatta il supporto.',
        code: 'AI_CONFIG_ERROR'
      }, { status: 500 });
    }
    if (err instanceof AiRouterError) {
      return NextResponse.json({
        success: false,
        error: err.message,
        code: 'AI_PROVIDER_ERROR'
      }, { status: 502 });
    }
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}
