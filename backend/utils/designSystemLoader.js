const fs = require('fs');
const path = require('path');

// ─── Sector to Design File Mapping ─────────────────────────────────────────────
const SECTOR_DESIGN_MAP = {
  // Food / Ristorazione / Bar
  'food': 'bistromenu-DESIGN.md',
  'ristorante': 'bistromenu-DESIGN.md',
  'ristorazione': 'bistromenu-DESIGN.md',
  'bar': 'bistromenu-DESIGN.md',
  'caffetteria': 'bistromenu-DESIGN.md',
  'pizzeria': 'bistromenu-DESIGN.md',
  'trattoria': 'bistromenu-DESIGN.md',
  'osteria': 'bistromenu-DESIGN.md',
  'menu': 'bistromenu-DESIGN.md',
  'recipe': 'recipebook-DESIGN.md',
  'recipes': 'recipebook-DESIGN.md',
  'cooking': 'recipebook-DESIGN.md',
  'foodblog': 'recipebook-DESIGN.md',
  
  // Retail / E-commerce / Negozio
  'retail': 'marketnest-DESIGN.md',
  'ecommerce': 'marketnest-DESIGN.md',
  'e-commerce': 'marketnest-DESIGN.md',
  'negozio': 'marketnest-DESIGN.md',
  'shop': 'marketnest-DESIGN.md',
  'store': 'marketnest-DESIGN.md',
  'marketplace': 'marketnest-DESIGN.md',
  'artigianato': 'marketnest-DESIGN.md',
  'handmade': 'marketnest-DESIGN.md',
  'prodotti': 'marketnest-DESIGN.md',
  
  // Finance / Crypto / Banking
  'crypto': 'coinpulse-DESIGN.md',
  'finance': 'coinpulse-DESIGN.md',
  'banking': 'coinpulse-DESIGN.md',
  'investimento': 'coinpulse-DESIGN.md',
  'trading': 'coinpulse-DESIGN.md',
  'wallet': 'coinpulse-DESIGN.md',
  
  // Real Estate / Property / Interior Design
  'realestate': 'urbanloft-DESIGN.md',
  'property': 'urbanloft-DESIGN.md',
  'immobiliare': 'urbanloft-DESIGN.md',
  'casa': 'urbanloft-DESIGN.md',
  'affitto': 'urbanloft-DESIGN.md',
  'affittare': 'urbanloft-DESIGN.md',
  'interior': 'urbanloft-DESIGN.md',
  'design': 'urbanloft-DESIGN.md',
  
  // Non-profits / Volunteer / Charities
  'volunteer': 'volunteerhub-DESIGN.md',
  'volontariato': 'volunteerhub-DESIGN.md',
  'nonprofit': 'volunteerhub-DESIGN.md',
  'charity': 'volunteerhub-DESIGN.md',
  'fondazione': 'volunteerhub-DESIGN.md',
  'ngo': 'volunteerhub-DESIGN.md',
  'cause': 'volunteerhub-DESIGN.md',
  
  // Documentation / API Docs
  'docs': 'docuforge-DESIGN.md',
  'documentation': 'docuforge-DESIGN.md',
  'api': 'docuforge-DESIGN.md',
  
  // SaaS / Tech / Dashboard
  'saas': 'wandermap-DESIGN.md',
  'tech': 'wandermap-DESIGN.md',
  'dashboard': 'wandermap-DESIGN.md',
  'software': 'wandermap-DESIGN.md',
  'app': 'wandermap-DESIGN.md',
  'travel': 'wandermap-DESIGN.md',
  'viaggi': 'wandermap-DESIGN.md',
  'booking': 'wandermap-DESIGN.md',
  'prenotazione': 'wandermap-DESIGN.md',
};

// ─── Load Design File ──────────────────────────────────────────────────────────
function loadDesignFile(sector) {
  // Guard against undefined/null sector
  if (!sector) {
    console.log('[DesignSystem] No sector provided, using default (wandermap)');
    return loadDesignFileContent('wandermap-DESIGN.md');
  }

  try {
    const normalizedSector = sector.toLowerCase().trim();
    const designFileName = SECTOR_DESIGN_MAP[normalizedSector];
    
    if (!designFileName) {
      console.log(`[DesignSystem] No specific design for sector "${sector}", using default (wandermap)`);
      return loadDesignFileContent('wandermap-DESIGN.md');
    }
    
    return loadDesignFileContent(designFileName);
  } catch (error) {
    console.error(`[DesignSystem] Error loading design for sector "${sector}":`, error.message);
    return null;
  }
}

function loadDesignFileContent(fileName) {
  const designPath = path.join(__dirname, '..', 'designmd', fileName);
  
  if (!fs.existsSync(designPath)) {
    console.warn(`[DesignSystem] Design file not found: ${designPath}`);
    return null;
  }
  
  const content = fs.readFileSync(designPath, 'utf-8');
  console.log(`[DesignSystem] Loaded design: ${fileName}`);
  return content;
}

// ─── Extract Design Tokens ─────────────────────────────────────────────────────
function extractDesignTokens(designContent) {
  if (!designContent) {
    return {
      colors: {},
      typography: {},
      spacing: {},
      borderRadius: {},
      elevation: {},
      components: {}
    };
  }

  const tokens = {
    colors: {},
    typography: {},
    spacing: {},
    borderRadius: {},
    elevation: {},
    components: {}
  };

  // Extract primary/secondary/tertiary colors (multiple format variations)
  // Format 1: - **Primary** (#881337)
  // Format 2: - **Color Primary** (#2563EB)
  // Format 3: - **Primary Charcoal** (#1C1917)
  const primaryMatch = designContent.match(/- \*\*(?:Primary|Color Primary|Primary Charcoal)\*\* \(#([A-F0-9]{6})\)/);
  const secondaryMatch = designContent.match(/- \*\*(?:Secondary|Color Secondary|Secondary Concrete)\*\* \(#([A-F0-9]{6})\)/);
  const tertiaryMatch = designContent.match(/- \*\*(?:Tertiary|Color Tertiary|Tertiary Accent Blue)\*\* \(#([A-F0-9]{6})\)/);
  const backgroundMatch = designContent.match(/- \*\*(?:Background|Surface Base)\*\* \(#([A-F0-9]{6})\)/);
  const surfaceMatch = designContent.match(/- \*\*(?:Surface|Surface Default)\*\* \(#([A-F0-9]{6})\)/);

  if (primaryMatch) tokens.colors.primary = primaryMatch[1];
  if (secondaryMatch) tokens.colors.secondary = secondaryMatch[1];
  if (tertiaryMatch) tokens.colors.tertiary = tertiaryMatch[1];
  if (backgroundMatch) tokens.colors.background = backgroundMatch[1];
  if (surfaceMatch) tokens.colors.surface = surfaceMatch[1];

  // Derive sidebar background from primary color (darker shade)
  if (primaryMatch) {
    const primary = primaryMatch[1];
    // Create a darker version of primary for sidebar (reduce lightness by ~30%)
    const r = parseInt(primary.slice(1, 3), 16);
    const g = parseInt(primary.slice(3, 5), 16);
    const b = parseInt(primary.slice(5, 7), 16);
    const darker = `#${Math.max(0, Math.floor(r * 0.7)).toString(16).padStart(2, '0')}${Math.max(0, Math.floor(g * 0.7)).toString(16).padStart(2, '0')}${Math.max(0, Math.floor(b * 0.7)).toString(16).padStart(2, '0')}`;
    tokens.colors.sidebarBg = darker;
  } else {
    tokens.colors.sidebarBg = '#1e293b'; // Default dark slate
  }

  // Extract typography fonts
  const headlineFontMatch = designContent.match(/- \*\*Headline Font\*\*: ([^\n]+)/);
  const bodyFontMatch = designContent.match(/- \*\*Body Font\*\*: ([^\n]+)/);
  const monoFontMatch = designContent.match(/- \*\*Mono Font\*\*: ([^\n]+)/);

  if (headlineFontMatch) tokens.typography.headline = headlineFontMatch[1].trim();
  if (bodyFontMatch) tokens.typography.body = bodyFontMatch[1].trim();
  if (monoFontMatch) tokens.typography.mono = monoFontMatch[1].trim();

  // Extract border radius (multiple format variations)
  // Format 1: - **sm** (4px)
  // Format 2: - **Small** (4px)
  // Format 3: - **radius-sm** (6px)
  // Format 4: - **DEFAULT** (4px)
  // Format 5: - **Small:** 4px (no parentheses, marketnest format)
  // Use exec to get capture groups directly
  const radiusRegex1 = /- \*\*(None|sm|md|lg|xl|full|Small|Medium|Large|DEFAULT)\*\* \(([0-9]+)px\)/g;
  let radiusMatch1;
  while ((radiusMatch1 = radiusRegex1.exec(designContent)) !== null) {
    const name = radiusMatch1[1];
    const px = radiusMatch1[2];
    if (name && px) {
      tokens.borderRadius[name.toLowerCase()] = `${px}px`;
    }
  }

  // Also try alternative format: - **radius-sm** (6px)
  const radiusRegex2 = /- \*\*radius-(sm|md|lg|full)\*\* \(([0-9]+)px\)/g;
  let radiusMatch2;
  while ((radiusMatch2 = radiusRegex2.exec(designContent)) !== null) {
    const name = radiusMatch2[1];
    const px = radiusMatch2[2];
    if (name && px) {
      tokens.borderRadius[name] = `${px}px`;
    }
  }

  // Also try format without parentheses: - **Small:** 4px
  const radiusRegex3 = /- \*\*(Small|Medium|Large|sm|md|lg|xl|full)\*\*:\s*([0-9]+)px/g;
  let radiusMatch3;
  while ((radiusMatch3 = radiusRegex3.exec(designContent)) !== null) {
    const name = radiusMatch3[1];
    const px = radiusMatch3[2];
    if (name && px) {
      tokens.borderRadius[name.toLowerCase()] = `${px}px`;
    }
  }

  // Extract spacing base unit (multiple format variations)
  // Format 1: Base unit: **12px**
  // Format 2: - **Base unit:** 8px
  // Format 3: - **Base unit:** 8px.
  const baseUnitMatch = designContent.match(/(?:Base unit:|-\s*\*\*Base unit\*\*):\s*\*\*?([0-9]+)px\*\*?/);
  if (baseUnitMatch) {
    tokens.spacing.baseUnit = `${baseUnitMatch[1]}px`;
  }

  return tokens;
}

// ─── Build System Prompt with Design Tokens ────────────────────────────────────
function buildSystemPrompt(designContent, designTokens) {
  const dbSchemaInfo = `
## DATABASE SCHEMA (ESCLUSIVO - NON CREARE NUOVE TABELLE)

Il database ZeusX ha già le seguenti tabelle. DEVI usare SOLO queste tabelle e i loro campi:

### Tabella: app_records
- id (UUID, PRIMARY KEY)
- app_id (UUID, FOREIGN KEY a apps)
- tenant_id (UUID, FOREIGN KEY a tenants)
- table_name (TEXT) - Nome della tabella logica (es. "clients", "appointments", "products")
- data (JSONB) - Dati del record in formato JSON
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)

### Tabella: apps
- id (UUID, PRIMARY KEY)
- tenant_id (UUID)
- blueprint_id (UUID)
- name (TEXT)
- slug (TEXT, UNIQUE)
- config (JSONB)
- client_password (TEXT)
- client_email (TEXT)
- client_active (BOOLEAN)
- expires_at (TIMESTAMPTZ)
- trial_ends_at (TIMESTAMPTZ)
- is_active (BOOLEAN)
- created_at (TIMESTAMPTZ)

### Tabella: blueprints
- id (UUID, PRIMARY KEY)
- sector (TEXT, UNIQUE)
- display_name (TEXT)
- description (TEXT)
- schema (JSONB)
- ui_config (JSONB)
- created_at (TIMESTAMPTZ)

### Tabella: tenants
- id (UUID, PRIMARY KEY)
- owner_id (UUID)
- name (TEXT)
- slug (TEXT, UNIQUE)
- plan (TEXT)
- app_limit (INT)
- total_apps_created (INT)
- created_at (TIMESTAMPTZ)

### Tabella: tenant_members
- id (UUID, PRIMARY KEY)
- tenant_id (UUID)
- user_id (UUID)
- role (TEXT)
- created_at (TIMESTAMPTZ)

### Tabella: profiles
- id (UUID, PRIMARY KEY)
- user_id (UUID)
- email (TEXT)
- full_name (TEXT)
- created_at (TIMESTAMPTZ)

### Tabella: subscriptions
- id (UUID, PRIMARY KEY)
- tenant_id (UUID)
- stripe_customer_id (TEXT)
- stripe_subscription_id (TEXT)
- status (TEXT)
- current_period_start (TIMESTAMPTZ)
- current_period_end (TIMESTAMPTZ)
`;

  const designInstructions = designContent ? `
## DESIGN SYSTEM DA UTILIZZARE

${designContent}

## TOKEN DI DESIGN DA APPLICARE

Applica i seguenti token di design a tutti i componenti React/HTML generati:

### Colori Tailwind
- Primary: ${designTokens.colors.primary || '#6366f1'}
- Secondary: ${designTokens.colors.secondary || '#a855f7'}
- Tertiary: ${designTokens.colors.tertiary || '#64748b'}
- Background: ${designTokens.colors.background || '#ffffff'}
- Surface: ${designTokens.colors.surface || '#ffffff'}
- Sidebar Background: ${designTokens.colors.sidebarBg || '#1e293b'}

### Font
- Headline: ${designTokens.typography.headline || 'Inter'}
- Body: ${designTokens.typography.body || 'Inter'}
- Mono: ${designTokens.typography.mono || 'monospace'}

### Border Radius
${Object.entries(designTokens.borderRadius).map(([key, value]) => `- ${key}: ${value}`).join('\n') || '- sm: 4px, md: 8px, lg: 12px, full: 9999px'}

### Spacing
Base unit: ${designTokens.spacing.baseUnit || '8px'}

## ISTRUZIONI PER LA GENERAZIONE

1. **NON generare nuove tabelle SQL**. Usa SOLO la tabella \`app_records\` per salvare tutti i dati.
2. **Mappa la UI sui dati esistenti**: crea componenti che leggono/scrivono da \`app_records\` con \`table_name\` appropriato.
3. **Applica i token di design**: usa i colori, font, border radius e spacing indicati sopra in tutti i componenti.
4. **Sidebar**: usa il colore \`sidebarBg\` come sfondo della sidebar, con testo bianco/chiaro per contrasto.
5. **Genera codice React/Next.js** con Tailwind CSS.
6. **Includi sempre**: sidebar di navigazione, tabella dati, form di creazione/modifica, ricerca e filtri.
` : '';

  return `${dbSchemaInfo}

## RUOLO

Sei ZeusX, un engine di generazione di applicazioni gestionali AI. Il tuo compito è generare codice React/Next.js completo e funzionante per applicazioni web basate sui dati esistenti del database.

## REGOLE FONDAMENTALI

1. **MAI creare nuove tabelle o modificare lo schema del database**. Usa ESCLUSIVAMENTE le tabelle esistenti.
2. **Tutti i dati dell'applicazione vanno nella tabella \`app_records\`** con il campo \`table_name\` che identifica la tabella logica (es. "clients", "appointments", "products").
3. **Genera componenti React completi** con:
   - Sidebar di navigazione
   - Tabella dati con ricerca, filtri, paginazione
   - Form modale per CRUD (crea, leggi, aggiorna, elimina)
   - Import/Export CSV
   - Dashboard con statistiche
4. **Usa Tailwind CSS** per lo styling.
5. **Includi TypeScript** dove appropriato.
6. **Genera codice production-ready** con gestione errori, loading states, e validazione.

## FORMATO OUTPUT

Genera un progetto Next.js completo con:
- \`app/page.tsx\` - Pagina principale
- \`components/DynamicTable.tsx\` - Tabella dinamica
- \`components/RecordFormModal.tsx\` - Modale form
- \`lib/supabase.ts\` - Client Supabase
- \`types/index.ts\` - TypeScript types

${designInstructions}

## ESEMPIO DI STRUTTURA DATI

Per un'app di gestione clienti:
- \`table_name: "clients"\` nel campo \`table_name\` di app_records
- \`data: { name: "Mario Rossi", email: "mario@example.com", phone: "333-1234567" }\` nel campo \`data\` di app_records

Genera SOLO codice, senza spiegazioni o markdown.`;
}

// ─── Get Design System for Sector ──────────────────────────────────────────────
function getDesignSystemForSector(sector) {
  const designContent = loadDesignFile(sector);
  const designTokens = extractDesignTokens(designContent);
  
  return {
    designContent,
    designTokens,
    systemPrompt: buildSystemPrompt(designContent, designTokens)
  };
}

// ─── List Available Design Systems ─────────────────────────────────────────────
function listAvailableDesignSystems() {
  const designmdPath = path.join(__dirname, '..', 'designmd');
  
  if (!fs.existsSync(designmdPath)) {
    return [];
  }
  
  const files = fs.readdirSync(designmdPath)
    .filter(file => file.endsWith('-DESIGN.md'))
    .map(file => file.replace('-DESIGN.md', ''));
  
  return files;
}

module.exports = {
  loadDesignFile,
  loadDesignFileContent,
  extractDesignTokens,
  buildSystemPrompt,
  getDesignSystemForSector,
  listAvailableDesignSystems,
  SECTOR_DESIGN_MAP
};