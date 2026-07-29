// ─── Design System Loader (Frontend) ───────────────────────────────────────────
// Carica i file DESIGN.md e inietta il contenuto nel System Prompt

import { promises as fs } from 'fs';
import path from 'path';

// ─── Sector to Design File Mapping ─────────────────────────────────────────────
export const SECTOR_DESIGN_MAP: Record<string, string> = {
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

// ─── Design Content Cache ──────────────────────────────────────────────────────
const designCache: Record<string, string> = {};

// ─── Load Design File Content ───────────────────────────────────────────────────
export async function loadDesignFileContent(fileName: string): Promise<string | null> {
  // Check cache first
  if (designCache[fileName]) {
    return designCache[fileName];
  }

  try {
    // In Next.js, we need to read from the public directory or use a different approach
    // For server-side usage, we read from the designmd directory
    const designPath = path.join(process.cwd(), 'designmd', fileName);
    const content = await fs.readFile(designPath, 'utf-8');
    designCache[fileName] = content;
    return content;
  } catch (error) {
    console.warn(`[DesignSystem] Design file not found: ${fileName}`);
    return null;
  }
}

// ─── Get Design System for Sector ───────────────────────────────────────────────
export async function getDesignSystemForSector(sector: string): Promise<{
  designContent: string | null;
  designTokens: any;
  systemPrompt: string;
}> {
  // Guard against undefined/null sector
  if (!sector || typeof sector !== 'string') {
    console.warn('[DesignSystem] No sector provided, using default (wandermap)');
    const designContent = await loadDesignFileContent('wandermap-DESIGN.md');
    const designTokens = extractDesignTokens(designContent);
    return {
      designContent,
      designTokens,
      systemPrompt: buildSystemPrompt(designContent, designTokens)
    };
  }

  const normalizedSector = sector.toLowerCase().trim();
  const designFileName = SECTOR_DESIGN_MAP[normalizedSector] || 'wandermap-DESIGN.md';
  
  const designContent = await loadDesignFileContent(designFileName);
  const designTokens = extractDesignTokens(designContent);
  
  return {
    designContent,
    designTokens,
    systemPrompt: buildSystemPrompt(designContent, designTokens)
  };
}

// ─── Extract Design Tokens ───────────────────────────────────────────────────────
function extractDesignTokens(designContent: string | null) {
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
    colors: {} as Record<string, string>,
    typography: {} as Record<string, string>,
    spacing: {} as Record<string, string>,
    borderRadius: {} as Record<string, string>,
    elevation: {} as Record<string, string>,
    components: {} as Record<string, string>
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
    const r = parseInt(primary.slice(1, 3), 16);
    const g = parseInt(primary.slice(3, 5), 16);
    const b = parseInt(primary.slice(5, 7), 16);
    const darker = `#${Math.max(0, Math.floor(r * 0.7)).toString(16).padStart(2, '0')}${Math.max(0, Math.floor(g * 0.7)).toString(16).padStart(2, '0')}${Math.max(0, Math.floor(b * 0.7)).toString(16).padStart(2, '0')}`;
    tokens.colors.sidebarBg = darker;
  } else {
    tokens.colors.sidebarBg = '#1e293b';
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

// ─── Build System Prompt with Design Tokens ─────────────────────────────────────
function buildSystemPrompt(designContent: string | null, designTokens: any): string {
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

  return `
## RUOLO

Sei ZeusX, un engine di generazione di applicazioni gestionali AI. Il tuo compito è generare codice React/Next.js completo e funzionante per applicazioni web basate sui dati esistenti del database.

## REGOLE FONDAMENTALI

1. **MAI creare nuove tabelle o modificare lo schema del database**. Usa ESCLUSIVAMENTE le tabelle esistenti.
2. **Tutti i dati dell'applicazione vanno nella tabella \`app_records\`** con il campo \`table_name\` che identifica la tabella logica (es. "clients", "appointments", "products").
3. **Genera componenti React completi** adatti al settore richiesto. Includi:
   - Sidebar di navigazione
   - Viste e sezioni appropriate per il dominio (es. per un ristorante: menu, ordini, prenotazioni; per un'ecommerce: prodotti, carrello, checkout; per uno studio medico: pazienti, appuntamenti, cartelle cliniche)
   - Tabelle dati con ricerca, filtri, paginazione
   - Form modale per CRUD (crea, leggi, aggiorna, elimina)
   - Funzionalità di import/export CSV
   - Dashboard o statistiche SOLO se pertinenti al settore
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

Genera SOLO codice, senza spiegazioni o markdown.`;
}