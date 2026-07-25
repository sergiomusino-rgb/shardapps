import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  BlueprintJSONSchema,
  sanitizeBlueprint,
  normalizeSector,
  type BlueprintJSON,
} from './blueprint-schema';
import { callAiRouter, extractJsonFromAiContent } from './ai-router';

interface GenerateOptions {
  sector: string;
  prompt?: string;
  lang?: string;
}

interface BlueprintRecord {
  id: string;
  sector: string;
  display_name: string;
  description: string | null;
  schema: BlueprintJSON['schema'];
  ui_config: BlueprintJSON['ui'];
}

export class BlueprintEngine {
  private supabase: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) {
      throw new Error('Supabase service role env vars missing for BlueprintEngine');
    }
    this.supabase = createClient<Database>(url, key);
  }

  async findBlueprint(sector: string): Promise<BlueprintRecord | null> {
    const normalized = normalizeSector(sector);

    const { data: exact, error: exactError } = await this.supabase
      .from('blueprints')
      .select('*')
      .eq('sector', normalized)
      .single();

    if (!exactError && exact) return exact as BlueprintRecord;

    const { data: fuzzy, error: fuzzyError } = await this.supabase
      .from('blueprints')
      .select('*')
      .or(`display_name.ilike.%${sector}%,description.ilike.%${sector}%`)
      .limit(1);

    if (!fuzzyError && fuzzy && fuzzy.length > 0) return fuzzy[0] as BlueprintRecord;

    return null;
  }

  async generateBlueprint(options: GenerateOptions): Promise<BlueprintJSON> {
    const { sector, prompt, lang = 'it' } = options;
    const normalized = normalizeSector(sector);

    const systemPrompt = this.buildSystemPrompt(normalized, prompt, lang);

    // Generazione completa di un nuovo blueprint da zero: task "app-generation"
    // -> tier "advanced" dell'AI Router (es. Claude Sonnet 5 via OpenRouter).
    let parsed: unknown;
    try {
      const { content } = await callAiRouter({
        task: 'app-generation',
        jsonMode: true,
        messages: [{ role: 'user', content: systemPrompt }],
      });
      parsed = extractJsonFromAiContent(content);
    } catch (err) {
      console.error('BlueprintEngine LLM error:', err);
      throw new Error('Errore nella generazione del blueprint');
    }

    if (typeof parsed === 'object' && parsed !== null) {
      (parsed as any).sector = normalized;
    }

    const result = sanitizeBlueprint(parsed);
    if (!result) {
      throw new Error('Blueprint non valido dopo sanitizzazione');
    }
    return result;
  }

  async findOrGenerate(options: GenerateOptions): Promise<{ blueprint: BlueprintJSON; isNew: boolean }> {
    const existing = await this.findBlueprint(options.sector);

    if (existing) {
      const blueprint = sanitizeBlueprint({
        appName: existing.display_name,
        sector: existing.sector,
        description: existing.description,
        schema: existing.schema,
        ui: existing.ui_config,
      });
      if (!blueprint) {
        throw new Error('Blueprint non valido dal database');
      }
      return {
        blueprint,
        isNew: false,
      };
    }

    const generated = await this.generateBlueprint(options);
    await this.saveNewBlueprint(generated);
    return { blueprint: generated, isNew: true };
  }

  async saveNewBlueprint(blueprint: BlueprintJSON): Promise<void> {
    const { error } = await this.supabase.from('blueprints').insert({
      sector: blueprint.sector,
      display_name: blueprint.appName,
      description: blueprint.description,
      schema: blueprint.schema,
      ui_config: blueprint.ui,
    });

    if (error) {
      console.error('saveNewBlueprint error:', error);
      throw new Error('Errore nel salvataggio del blueprint');
    }
  }

  private buildSystemPrompt(sector: string, customPrompt: string | undefined, lang: string): string {
    return `Sei l'architetto software di ZeusX. Devi produrre SOLO un oggetto JSON valido, senza testo aggiuntivo.

Il JSON rappresenta un gestionale SaaS per il settore: "${sector}".
${customPrompt ? `Richiesta aggiuntiva dell'utente: ${customPrompt}` : ''}

Lingua dei label: ${lang}.

Schema obbligatorio:
{
  "appName": "string",
  "sector": "${sector}",
  "description": "string",
  "schema": {
    "tables": [
      {
        "name": "snake_case_singolare",
        "label": "Etichetta singolare",
        "labelPlural": "Etichetta plurale",
        "icon": "emoji opzionale",
        "fields": [
          {
            "id": "snake_case",
            "type": "text|number|date|datetime|boolean|email|phone|textarea|select|multiselect|relation|currency|file|image",
            "label": "Etichetta campo",
            "required": true|false,
            "options": ["opzione1", "opzione2"],
            "target": "nome_tabella_target",
            "targetLabel": "campo_label_target"
          }
        ]
      }
    ]
  },
  "ui": {
    "primaryColor": "#RRGGBB",
    "sidebar": ["name_tabella_1", "name_tabella_2"],
    "dashboardCards": [
      { "type": "count|sum|latest|chart", "table": "name_tabella", "label": "Label", "field": "campo_numerico" }
    ]
  }
}

Regole:
- Genera almeno 2-4 tabelle con relazioni logiche per il settore.
- Usa solo snake_case per name, id, sector.
- I campi relation devono puntare a tabelle esistenti nello schema.
- Non includere campi id, created_at, updated_at: saranno aggiunti automaticamente.
- colori validi esadecimale a 6 cifre.
- Output solo JSON, niente markdown, niente spiegazioni.`;
  }

}
