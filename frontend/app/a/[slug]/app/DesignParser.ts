/**
 * Design Parser - Legge e interpreta i file DESIGN.md
 * Estrae struttura, componenti e layout dal file di design
 */

export interface DesignSection {
  title: string;
  content: string;
  level: number;
}

export interface DesignComponent {
  name: string;
  description: string;
  variants?: string[];
  properties?: Record<string, string>;
}

export interface DesignLayout {
  type: 'docs' | 'ecommerce' | 'saas' | 'recipe' | 'restaurant' | 'custom';
  sidebarWidth: number;
  hasAnalytics: boolean;
  hasFilters: boolean;
  hasProductGrid: boolean;
  hasStepByStep: boolean;
  hasMenuCards: boolean;
}

export interface DesignStructure {
  overview: string;
  colors: Record<string, string>;
  typography: Record<string, string>;
  spacing: Record<string, string>;
  components: DesignComponent[];
  layout: DesignLayout;
  rawContent: string;
}

/**
 * Estrae le sezioni dal contenuto markdown
 */
function parseSections(content: string): DesignSection[] {
  const lines = content.split('\n');
  const sections: DesignSection[] = [];
  let currentSection: DesignSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: headingMatch[2],
        content: '',
        level: headingMatch[1].length
      };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Estrae i colori dal contenuto markdown
 */
function parseColors(content: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const colorPattern = /\*\*(\w+)\*\*\s*\(([^)]+)\):\s*(.+?)(?:\n|$)/g;
  
  let match;
  while ((match = colorPattern.exec(content)) !== null) {
    const name = match[1].toLowerCase();
    const hex = match[2].trim();
    colors[name] = hex;
  }

  return colors;
}

/**
 * Estrae le informazioni di overview
 */
function parseOverview(content: string): string {
  const overviewMatch = content.match(/## Overview\s*\n([\s\S]*?)(?=\n---|\n##|$)/);
  return overviewMatch ? overviewMatch[1].trim() : '';
}

/**
 * Estrae i componenti dal contenuto markdown
 */
function parseComponents(content: string): DesignComponent[] {
  const components: DesignComponent[] = [];
  
  // Cerca sezione Components
  const componentsMatch = content.match(/## Components\s*\n([\s\S]*?)(?=\n---|\n##|$)/);
  if (!componentsMatch) return components;

  const componentsContent = componentsMatch[1];
  
  // Pattern per trovare componenti (es. ### Buttons, ### Cards)
  const componentPattern = /###\s+(\w+)([\s\S]*?)(?=\n###|\n---|\n##|$)/g;
  
  let match;
  while ((match = componentPattern.exec(componentsContent)) !== null) {
    const name = match[1];
    const description = match[2].trim();
    
    // Estrai varianti se presenti
    const variants: string[] = [];
    const variantPattern = /\*\*(\w+)\*\*/g;
    let variantMatch;
    while ((variantMatch = variantPattern.exec(description)) !== null) {
      if (variantMatch[1].toLowerCase() !== name.toLowerCase()) {
        variants.push(variantMatch[1]);
      }
    }

    components.push({
      name,
      description,
      variants: variants.length > 0 ? variants : undefined
    });
  }

  return components;
}

/**
 * Determina il tipo di layout in base all'overview e ai componenti
 */
function determineLayoutType(overview: string, components: DesignComponent[]): DesignLayout {
  const overviewLower = overview.toLowerCase();
  const componentNames = components.map(c => c.name.toLowerCase()).join(' ');

  // Docs/API Documentation
  if (overviewLower.includes('api') || 
      overviewLower.includes('documentation') || 
      overviewLower.includes('docs') ||
      componentNames.includes('method badge') ||
      componentNames.includes('endpoint')) {
    return {
      type: 'docs',
      sidebarWidth: 280,
      hasAnalytics: true,
      hasFilters: false,
      hasProductGrid: false,
      hasStepByStep: false,
      hasMenuCards: false
    };
  }

  // E-commerce/Retail
  if (overviewLower.includes('e-commerce') || 
      overviewLower.includes('ecommerce') ||
      overviewLower.includes('marketplace') ||
      overviewLower.includes('retail') ||
      overviewLower.includes('store') ||
      componentNames.includes('product card') ||
      componentNames.includes('product cards')) {
    return {
      type: 'ecommerce',
      sidebarWidth: 280,
      hasAnalytics: true,
      hasFilters: true,
      hasProductGrid: true,
      hasStepByStep: false,
      hasMenuCards: false
    };
  }

  // Recipe
  if (overviewLower.includes('recipe') || 
      overviewLower.includes('cooking') ||
      overviewLower.includes('ingredient')) {
    return {
      type: 'recipe',
      sidebarWidth: 280,
      hasAnalytics: true,
      hasFilters: false,
      hasProductGrid: false,
      hasStepByStep: true,
      hasMenuCards: false
    };
  }

  // Restaurant/Menu
  if (overviewLower.includes('restaurant') || 
      overviewLower.includes('menu') ||
      overviewLower.includes('dish')) {
    return {
      type: 'restaurant',
      sidebarWidth: 280,
      hasAnalytics: true,
      hasFilters: false,
      hasProductGrid: false,
      hasStepByStep: false,
      hasMenuCards: true
    };
  }

  // Default SaaS
  return {
    type: 'saas',
    sidebarWidth: 280,
    hasAnalytics: true,
    hasFilters: false,
    hasProductGrid: false,
    hasStepByStep: false,
    hasMenuCards: false
  };
}

/**
 * Parser principale per il file DESIGN.md
 */
export function parseDesign(content: string): DesignStructure {
  const sections = parseSections(content);
  const overview = parseOverview(content);
  const colors = parseColors(content);
  const components = parseComponents(content);
  const layout = determineLayoutType(overview, components);

  return {
    overview,
    colors,
    typography: {},
    spacing: {},
    components,
    layout,
    rawContent: content
  };
}

/**
 * Mappa i nomi dei file DESIGN.md ai loro slug
 */
export const DESIGN_FILE_MAP: Record<string, string> = {
  'docuforge': 'docuforge-DESIGN.md',
  'marketnest': 'marketnest-DESIGN.md',
  'recipebook': 'recipebook-DESIGN.md',
  'bistromenu': 'bistromenu-DESIGN.md',
  'urbanloft': 'urbanloft-DESIGN.md',
  'coinpulse': 'coinpulse-DESIGN.md',
  'volunteerhub': 'volunteerhub-DESIGN.md',
  'wandermap': 'wandermap-DESIGN.md'
};

/**
 * Determina il nome del file DESIGN.md in base al design key
 */
export function getDesignFileName(designKey: string): string {
  return DESIGN_FILE_MAP[designKey] || 'wandermap-DESIGN.md';
}

/**
 * Legge il contenuto del file DESIGN.md
 */
export async function loadDesignFile(designKey: string): Promise<string> {
  const fileName = getDesignFileName(designKey);
  
  // Prova prima il percorso designmd/
  try {
    const response = await fetch(`/designmd/${fileName}`);
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Ignora errori
  }

  // Prova il percorso public/
  try {
    const response = await fetch(`/${fileName}`);
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Ignora errori
  }

  // Fallback: restituisci contenuto vuoto
  return '';
}

/**
 * Estrae le specifiche della sezione ## Components
 */
export function extractComponentSpecs(content: string): DesignComponent[] {
  return parseComponents(content);
}

/**
 * Estrae le specifiche della sezione ## Overview/Layout
 */
export function extractLayoutSpecs(content: string): { overview: string; layout: DesignLayout } {
  const overview = parseOverview(content);
  const components = parseComponents(content);
  const layout = determineLayoutType(overview, components);
  
  return { overview, layout };
}