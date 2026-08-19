// ─── Creator AI — Site/PWA Generator (motore Sito Vetrina / Web App-PWA / ─────
// E-Commerce Vetrina / Gestionale) ───────────────────────────────────────────
// Estratto da app/api/creator/generate/route.ts (CreatorAI Engine 2.0, Fase 5)
// SENZA alcuna modifica di logica/prompt: stesso identico codice, spostato qui
// perché sia riutilizzabile sia dalla route (comportamento invariato) sia
// dall'orchestrator (frontend/src/lib/creator-ai-orchestrator.ts), che deve
// poter chiamare il Generator REALE senza duplicarlo — requisito esplicito
// "NON duplicare callSiteSchemaGenerator... Riutilizzare le chiamate già
// presenti in generate/route.ts". Il generatore "legacy" a settore fisso
// (callSchemaGenerator, ramo sector-based di route.ts, oggi solo
// /dashboard/creator-v1, admin-only) resta invece dov'era: non è toccato da
// questa fase.

import { getDesignSystemForSector } from '@/lib/designSystemLoader';
import { callAiRouter, extractJsonFromAiContent } from '@/src/lib/ai-router';
import type { ProjectType, SiteBlueprintJSON } from '@/src/lib/site-schema';

// ─── Master System Prompt: motore Sito Vetrina / Web App-PWA / E-Commerce ──────────
// Distinto dal generatore di gestionali (blueprint-schema, tabelle admin,
// rimasto in route.ts): questo produce un SiteBlueprintJSON (site-schema.ts)
// con pagine PUBBLICHE oltre al pannello admin. Il modello riceve il
// contratto JSON per intero — incluso il vocabolario chiuso dei tipi di
// sezione — perché sanitizeSiteBlueprint scarta silenziosamente qualunque
// sezione con un `type` non riconosciuto: se il prompt non lo vincola
// esplicitamente, il modello inventa tipi liberi e mezza pagina sparisce in
// fase di validazione.
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

// Relazioni 1:N tra entità di adminPanel.entities (es. un ordine collegato al
// proprio cliente): documentate a parte dal resto dei tipi di campo perché,
// a differenza di text/number/select, richiedono due metadati aggiuntivi
// (targetEntity/displayField) e una regola di coerenza incrociata con le
// ALTRE entità dello stesso schema — un errore qui produce un riferimento
// rotto che sanitizeSiteBlueprint neutralizza server-side (degrada il campo
// a testo libero, vedi resolveEntityRelations in site-schema.ts), ma è
// comunque un errore che vale la pena evitare a monte con un esempio chiaro.
const RELATION_FIELD_DOC = `Relazioni 1:N tra entità (facoltative — usale solo quando il dominio ha davvero due entità collegate, es. un ordine che appartiene a un cliente, una prenotazione che appartiene a un tavolo): un campo di adminPanel.entities[].fields può avere "type":"relation" per riferirsi a un record di un'ALTRA entità dello stesso adminPanel.entities. In quel caso il campo DEVE avere anche:
- "targetEntity": il "name" (snake_case) di un'altra entità che stai definendo TU STESSO in questo stesso JSON — mai il nome di un'entità che non esiste nello schema.
- "displayField": l'"id" di un campo REALE di quell'entità target, scelto perché la rappresenta leggibilmente in un menu a tendina (es. "ragione_sociale", "nome", "titolo") — mai "id".
Esempio concreto — entità "ordini" con un campo che collega ogni ordine al proprio cliente, in uno schema che definisce anche un'entità "clienti" con un campo "ragione_sociale":
{
  "name": "ordini", "label": "Ordine", "labelPlural": "Ordini", "icon": "🧾",
  "fields": [
    {"id": "id", "type": "id", "label": "ID"},
    {"id": "numero_ordine", "type": "text", "label": "Numero Ordine"},
    {"id": "cliente_id", "type": "relation", "label": "Cliente", "targetEntity": "clienti", "displayField": "ragione_sociale"},
    {"id": "totale", "type": "number", "label": "Totale"}
  ]
}
Non inventare un'entità solo per avere qualcosa a cui collegare una relazione: se il dominio del prompt non ha davvero due (o più) entità naturalmente collegate, usa campi normali (text/select/number) invece di una relazione fittizia.`;

// Macchine a stati + azioni + ruoli: per entità "operative" (un ordine da
// preparare, un intervento da chiudere, un ticket da gestire), non solo
// anagrafiche/cataloghi. Come per le relazioni sopra, un errore qui non
// rompe nulla (resolveEntityStatesAndActions in site-schema.ts degrada/
// scarta ciò che non torna), ma un esempio chiaro evita che il modello
// inventi stati o azioni che poi il server neutralizza silenziosamente.
const WORKFLOW_DOC = `Macchine a stati e azioni (facoltative — usale solo per entità con un vero flusso di lavoro: ordini da preparare/consegnare, interventi da completare, ticket da chiudere; NON per anagrafiche/cataloghi come clienti o prodotti, che non hanno stati):
- Un campo può avere "type":"state" per rappresentare lo stato di avanzamento di un record. In quel caso DEVE avere anche:
  - "states": elenco di stringhe, il vocabolario COMPLETO degli stati possibili (es. ["bozza", "in_lavorazione", "completato", "annullato"]).
  - "allowedTransitions" (facoltativo ma consigliato): mappa {stato_di_partenza: [stati_di_arrivo_ammessi]} — SOLO stati già elencati in "states". Se omesso, tutte le transizioni tra gli stati sono ammesse (nessun vincolo).
- L'entità che ha un campo "type":"state" può avere anche un array "actions" (facoltativo) con pulsanti eseguibili su ogni record. Ogni azione:
  - "id": identificativo snake_case.
  - "label": etichetta del pulsante (nella lingua richiesta).
  - "type": "change_state" (cambia lo stato del record — l'unico tipo con effetto reale oggi), "trigger_webhook" o "send_notification" (accettati a schema, ma la loro esecuzione non è ancora implementata: usali solo se il prompt li richiede esplicitamente, altrimenti preferisci "change_state").
  - "targetState" (SOLO per "change_state"): uno degli stati elencati in "states" del campo di stato dell'entità.
  - "requiredRole" (facoltativo): "admin" oppure "operator" — ruolo minimo richiesto per eseguire l'azione. Omettilo se chiunque con accesso in scrittura (operator o admin) deve poterla eseguire.
  - "webhookUrl" (facoltativo, SOLO per "trigger_webhook"): un URL http/https valido a cui inviare una notifica quando l'azione viene eseguita. Valorizzalo SOLO se il prompt indica esplicitamente un URL reale — non inventare un URL plausibile.
Esempio concreto — entità "ordini" con stato e due azioni di cambio stato:
{
  "name": "ordini", "label": "Ordine", "labelPlural": "Ordini", "icon": "🧾",
  "fields": [
    {"id": "id", "type": "id", "label": "ID"},
    {"id": "numero_ordine", "type": "text", "label": "Numero Ordine"},
    {"id": "stato", "type": "state", "label": "Stato", "states": ["nuovo", "in_preparazione", "pronto", "consegnato", "annullato"], "allowedTransitions": {"nuovo": ["in_preparazione", "annullato"], "in_preparazione": ["pronto", "annullato"], "pronto": ["consegnato"]}}
  ],
  "actions": [
    {"id": "avvia_preparazione", "label": "Avvia preparazione", "type": "change_state", "targetState": "in_preparazione"},
    {"id": "annulla_ordine", "label": "Annulla ordine", "type": "change_state", "targetState": "annullato", "requiredRole": "admin"}
  ]
}
Autenticazione multi-utente (authConfig, facoltativo, top-level nello schema — NON dentro businessConfig): imposta "enabled":true SOLO se il prompt richiede esplicitamente più operatori/ruoli diversi (es. "i miei tecnici devono vedere solo i propri interventi", "voglio un ruolo amministratore e uno operatore"). Il default ("enabled":false, o authConfig del tutto assente) è corretto per la stragrande maggioranza dei casi (un solo titolare, nessun bisogno di ruoli) — non abilitarlo "per sicurezza" o "per completezza" se il prompt non lo chiede. Quando abilitato: "supportedRoles" è un sottoinsieme di ["admin","operator","viewer"] (sempre includere "admin"), "defaultRole" è "operator" o "viewer" (il ruolo assegnato a un nuovo utente che non sia il titolare).`;

// Dashboard cards (Quality Pass v1, Fix #3): stesso schema già esistente per
// il motore v1 (blueprint-schema.ts::DashboardCardSchema, riusato qui invece
// di inventare un secondo sistema — vedi site-schema.ts::dashboardCards).
// Facoltativo: se il prompt non menziona nessuna metrica specifica, ometti
// "dashboardCards" del tutto — la Dashboard mostra comunque le card generiche
// (tabelle/record totali/ultima attività), MAI vuota.
// Esportata (Quality Pass v1.1, Fix #3): permette a creator-site-generator.test.ts
// di verificare che la regola di completezza delle KPI sia davvero presente
// nel testo inviato al modello, senza dover invocare l'AI reale.
export const DASHBOARD_CARDS_DOC = `"dashboardCards" (facoltativo, top-level nello schema — array di massimo 6 elementi): metriche specifiche del dominio da mostrare in cima alla Dashboard admin, SOLO quando il prompt le richiede esplicitamente o le implica chiaramente (es. "voglio vedere subito le opportunità aperte", "mostrami il fatturato del mese"). Ogni card:
- "type": una di "count" (conta i record), "sum" (somma un campo numerico), "avg" (media di un campo numerico), "latest" (mostra il valore più recente di un campo, in base alla data di creazione del record).
- "table": il "name" di un'entità REALE di adminPanel.entities — mai un'entità inventata.
- "label": etichetta della card (nella lingua richiesta), es. "Opportunità Aperte".
- "field" (SOLO per "sum"/"avg"/"latest"): l'"id" di un campo REALE dell'entità indicata, di type "number" o "currency" per sum/avg.
- "filter" (facoltativo): restringe la card a un sottoinsieme di record, nella forma {"id_campo": {"in": ["valore1", "valore2"]}} — SOLO su campi "select"/"state" dell'entità, coi valori esattamente uguali a "options"/"states" di quel campo.
Esempio concreto — entità "opportunita" con un campo di stato, due card (conteggio filtrato e somma):
{
  "dashboardCards": [
    {"type": "count", "table": "opportunita", "label": "Opportunità Aperte", "filter": {"stato": {"in": ["nuovo", "contattato", "qualificato", "proposta"]}}},
    {"type": "sum", "table": "opportunita", "label": "Valore Pipeline", "field": "valore_stimato"}
  ]
}
Non generare card che duplicano semplicemente "numero totale di record" per ogni entità (quello lo mostra già la Dashboard di base): usa dashboardCards solo per metriche che aggiungono informazione reale (un sottoinsieme filtrato, una somma, una media, un valore recente).
Regola tassativa su dashboardCards (Quality Pass v1.1 — verificato in produzione: una KPI esplicitamente richiesta nel prompt, come "ore lavorate" tra più metriche elencate, è comparsa mancante in una generazione reale): ogni KPI o metrica esplicitamente richiesta dall'utente deve essere rappresentata in dashboardCards, quando è calcolabile dai campi/entità che hai generato. Non omettere una KPI esplicitamente richiesta. Prima di restituire il blueprint, rileggi la richiesta dell'utente ed elenca mentalmente ogni KPI/metrica che ha nominato: per ciascuna, verifica che compaia in dashboardCards oppure che esista una ragione strutturale per cui non è calcolabile (es. nessun campo numerico adatto in nessuna entità) — in quel caso ometti solo quella specifica card, non l'intero blocco. Questa regola vale SOLO quando il prompt richiede esplicitamente delle metriche: se non ne richiede nessuna, "dashboardCards" resta assente/vuoto come da regola sopra, non va popolato "per completezza".
Derivazione semantica del nome campo -> KPI (CreatorAI v2): quando il prompt richiede una metrica in modo generico (es. "voglio sapere quante ore abbiamo lavorato e quanto abbiamo speso"), collega la richiesta al campo che la rappresenta e usa un'etichetta naturale derivata dal suo significato, non dal nome tecnico del campo. Esempi:
- un campo che rappresenta ore/durata (es. "ore_lavorate") -> card "sum" con label tipo "Ore Lavorate Totali", MAI "Ore_lavorate" o simili.
- un campo che rappresenta un costo/importo totale (es. "costo_totale") -> card "sum" con label tipo "Costo Totale".
- un campo che rappresenta un conteggio di record in uno stato operativo (es. "aperto"/"in_corso" su un campo "type":"state") -> card "count" filtrata su quegli stati, con label tipo "<Entità> Aperti/e".
Non generare una card per un campo il cui significato non è chiaramente collegabile a nessuna metrica richiesta dal prompt.`;

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

export async function callSiteSchemaGenerator(
  prompt: string,
  projectType: ProjectType,
  lang: string,
  context: { userId: string; tenantId: string }
): Promise<any> {
  // 'gestionale' (Fase 1): nessun settore fisso a priori (il prompt libero
  // decide il dominio), quindi niente 'food'/'ecommerce' — 'saas' è il bucket
  // generico già esistente in SECTOR_DESIGN_MAP (frontend/lib/designSystemLoader.ts,
  // design "wandermap", pensato per SaaS/tech/dashboard), qui usato solo per
  // il colore primario di default (unico campo di designSystem che
  // callSiteSchemaGenerator legge, vedi sotto): la generazione delle entità
  // resta comunque libera, questo non vincola in alcun modo lo schema.
  const designSystem = await getDesignSystemForSector(
    projectType === 'ecommerce' ? 'ecommerce' : projectType === 'gestionale' ? 'saas' : 'food'
  );
  const langName = LANG_NAMES[lang] || LANG_NAMES.it;

  const projectTypeGuide: Record<ProjectType, string> = {
    'landing': 'Sito Vetrina/Landing per un professionista o artigiano: pagine tipiche Home, Chi Siamo/Galleria, Contatti. adminPanel.entities può restare vuoto o contenere al massimo una entità semplice (es. "richieste" per il form contatti) — non serve un catalogo prodotti.',
    'webapp-pwa': 'Web App/PWA per un\'attività con menu e prenotazioni (ristorante, pizzeria, salone): pagine tipiche Home, Menu (sezione "list" collegata a un\'entità "menu" o "servizi"), Prenota (sezione "form" collegata a un\'entità "prenotazioni"), Contatti. adminPanel.entities DEVE includere le entità referenziate dalle sezioni "list"/"form" delle pagine, con campi realistici del settore.',
    'ecommerce': 'E-Commerce Vetrina per un negozio: pagine tipiche Home, Catalogo (sezione "list" collegata a un\'entità "prodotti" con almeno i campi nome/prezzo/immagine/descrizione), Contatti. adminPanel.entities DEVE includere l\'entità prodotti referenziata dal Catalogo. Gli ordini avvengono via WhatsApp o alla cassa: NON generare un carrello o un checkout, usa piuttosto un actionButton "whatsapp" per ordinare.',
    // CreatorAI Engine 2.0, Fase 1: gestionale generico, sector-agnostic —
    // recupera qui la capacità del vecchio motore v1 (blueprint-engine.ts,
    // "Sei l'architetto software di ShardApps... gestionale SaaS per il
    // settore X", nessun vincolo di dominio) dentro lo stesso contratto
    // SiteBlueprintJSON del motore v2, invece di un secondo motore separato.
    // NESSUN settore è hardcoded qui: il prompt dell'utente decide da solo
    // CRM/helpdesk/project management/gestione immobili/inventario/
    // prenotazioni/qualunque altro dominio, esattamente come nel vecchio v1.
    // Quality Pass v1, Fix #1: prima la guida imponeva "sections": [] (array
    // vuoto) su "home" per QUALSIASI gestionale — coerente a schema (una
    // pagina con 0 sezioni è valida), ma risultava in una landing pubblica
    // sempre vuota ("Questa pagina non ha ancora sezioni.") anche per un
    // gestionale con un dominio benissimo descrivibile in 2-3 righe (CRM,
    // gestione interventi, immobiliare...). Il pannello admin resta il
    // valore primario del progetto — non trasformarlo in un sito vetrina
    // elaborato — ma una home minima e coerente col dominio (chi è
    // l'attività, cosa gestisce, un invito a contattarla/accedere) è sempre
    // preferibile a una pagina visibilmente vuota.
    'gestionale': 'Gestionale generico per QUALUNQUE dominio descritto dall\'utente (es. CRM, helpdesk, project management, gestione immobili, gestione clienti, inventario, prenotazioni, o altro non elencato qui) — NESSUN vincolo di settore: progetta adminPanel.entities libero in base ESCLUSIVAMENTE a quanto richiesto nel prompt, senza forzare un dominio food/ecommerce/servizi locali se non è quello richiesto. adminPanel.entities è OBBLIGATORIO e deve rappresentare TUTTE le entità necessarie al dominio richiesto (es. per un CRM: clienti, aziende, opportunità, attività; per un helpdesk: ticket, clienti, operatori; per un gestionale immobiliare: immobili, proprietari, contratti), usando liberamente relazioni ("type":"relation") e macchine a stati ("type":"state") dove il dominio le richiede naturalmente. Il valore primario di questo tipo di progetto resta il pannello admin, non il sito pubblico: genera comunque UNA sola pagina in "pages" (slug "home") ma con 2-4 sezioni reali e coerenti col dominio — tipicamente "hero" (presentazione dell\'attività/prodotto) + "about" (cosa gestisce/offre, in base alle entità di adminPanel.entities) + "cta" (invito a contattare o accedere); NON aggiungere "list"/"form"/"gallery"/"reviews" collegate a dati che restano solo nel pannello admin (quei dati non vanno esposti pubblicamente in un gestionale). "actionButtons" può restare vuoto oppure contenere "call"/"map" se il prompt menziona un contatto diretto; evita "whatsapp" a meno che il prompt non lo richieda esplicitamente (non è tipico di un gestionale interno). Valuta anche "dashboardCards" (vedi paragrafo dedicato sotto) se il prompt menziona metriche specifiche da monitorare.',
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
  /* "authConfig" (facoltativo, solo se il prompt richiede più ruoli/operatori — vedi paragrafo dedicato sotto): { "enabled": true, "supportedRoles": ["admin","operator"], "defaultRole": "operator" } */
  /* "dashboardCards" (facoltativo, vedi paragrafo dedicato sotto): [{ "type": "count", "table": "nome_entita_snake_case", "label": "Etichetta" }] */
}

${SITE_SECTION_TYPES_DOC}

${RELATION_FIELD_DOC}

${WORKFLOW_DOC}

${DASHBOARD_CARDS_DOC}

Regole tassative:
- Ogni pagina deve avere almeno una sezione.
- I campi di actionButtons.value per "call"/"whatsapp" possono restare vuoti: verranno risolti a runtime da businessConfig.phone/whatsapp. Valorizzali solo se il prompt indica un numero specifico diverso.
- Le entità in adminPanel.entities devono coprire TUTTE le "entity" referenziate dalle sezioni "list"/"form" di ogni pagina: nessun riferimento a un'entità inesistente.
- Ogni campo di un'entità con un valore economico (prezzo, tariffa, costo) deve avere "type":"number".
- Se usi un campo "type":"relation", "targetEntity" deve corrispondere ESATTAMENTE al "name" di un'altra entità presente in questo stesso adminPanel.entities, e "displayField" a un "id" di campo REALE di quell'entità (mai "id"). Vedi il paragrafo sulle relazioni sopra per il formato completo.
- Se usi un campo "type":"state" con "actions" di tipo "change_state", "targetState" deve corrispondere ESATTAMENTE a uno degli "states" dello stesso campo. Vedi il paragrafo su macchine a stati/azioni sopra per il formato completo.
- Se il prompt richiede esplicitamente delle metriche/KPI per la dashboard, ognuna di esse deve comparire in "dashboardCards" quando calcolabile: vedi il paragrafo dedicato sopra, non ometterne nessuna.
- TUTTI i campi di businessConfig sono OBBLIGATORI e NON possono restare stringhe vuote (eccetto logoUrl, che può restare "" in assenza di un logo reale): name, tagline, description, address, phone, whatsapp, email, openingHours (almeno 2 righe). Estraili dal prompt dell'utente quando presenti; per ogni campo non specificato esplicitamente, inventa un valore plausibile e coerente con settore/città/nome menzionati nel prompt (es. un indirizzo credibile per quella città, orari tipici del settore, un'email nella forma info@<dominio-plausibile-da-appName>.it) — mai lasciare un placeholder letterale tipo "N/A" o il campo vuoto.
- VINCOLO DI LINGUA TASSATIVO: ogni testo generato — appName, description, TUTTI i campi di businessConfig (tagline, description, address, openingHours.day/hours inclusi), label/labelPlural/icon-caption delle entità in adminPanel.entities, label dei fields, titoli/sottotitoli/body/label di OGNI sezione di pagina (hero, about, gallery, list, form, contact, reviews, cta, text), label degli actionButtons, i dati di esempio (recensioni, gallery caption) — deve essere scritto SOLO in ${langName} (${lang}), senza mescolare altre lingue nemmeno parzialmente. Il campo "businessConfig.language" deve valere esattamente "${lang}". Fanno eccezione solo identificatori tecnici non testuali: "name"/"id" delle entità e dei campi (snake_case), "slug" delle pagine, "type" dei campi/sezioni, valori URL/telefono/email.
- Non aggiungere testo prima o dopo il JSON.

PROMEMORIA FINALE (il più importante, non ignorarlo): PRIMA di scrivere il JSON, rileggi ogni singola stringa visibile che stai per generare — ogni "label" di ogni field, ogni label/labelPlural di ogni entità, ogni titolo/sottotitolo — e verifica che sia in ${langName}. Un'app generata per un utente che parla ${langName} con anche una sola etichetta in un'altra lingua è un difetto grave, non un dettaglio: è la prima cosa che l'utente finale nota aprendo l'app.`;

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

export function fillBusinessConfigDefaults(blueprint: SiteBlueprintJSON, lang: string): SiteBlueprintJSON {
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

/**
 * Fix "gestionale senza pages" (Fase 1, ora riutilizzato dall'orchestrator
 * Fase 5): il prompt istruisce il modello a restituire una pagina "home" con
 * 2-4 sezioni reali per 'gestionale' (Quality Pass v1, Fix #1), ma un
 * modello può comunque omettere "pages" del tutto — senza pages[]
 * sanitizeSiteBlueprint scarta l'INTERO schema (pages richiede almeno 1
 * elemento anche per questo motore, invariato per gli altri 3 projectType),
 * buttando via anche adminPanel.entities generate correttamente. Applicato
 * sul JSON grezzo, prima della validazione: inietta solo una pagina
 * strutturalmente presente ma con "sections": [] — il contenuto reale
 * (hero/about/cta, derivato da businessConfig/adminPanel.entities già
 * normalizzati) viene aggiunto subito dopo da
 * site-schema.ts::ensurePagesHaveSections dentro sanitizeSiteBlueprint,
 * l'unico punto che ha già i dati tipizzati per costruirlo — evita di
 * duplicare qui la stessa logica di fallback su dati ancora grezzi/non
 * normalizzati.
 */
export function ensureGestionaleHasPages(rawSchema: unknown, projectType: ProjectType): unknown {
  if (
    projectType === 'gestionale' &&
    rawSchema && typeof rawSchema === 'object' &&
    (!Array.isArray((rawSchema as { pages?: unknown }).pages) || (rawSchema as { pages: unknown[] }).pages.length === 0)
  ) {
    (rawSchema as { pages?: unknown[] }).pages = [{ slug: 'home', label: 'Home', sections: [] }];
  }
  return rawSchema;
}
