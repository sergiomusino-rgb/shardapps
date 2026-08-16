// ─── Refactor scoped via RFC6902 (CreatorAI Engine 2.0 — Fase 6) ───────────
// Motore di patch generico (nessuna conoscenza di SiteBlueprintJSON) + un
// livello applicativo sopra che applica una patch allo schema corrente, la
// valida e rifiuta esplicitamente qualunque perdita di dati non dichiarata.
//
// Principi guida (vedi anche il report):
// - Nessun nuovo provider/modello AI: questo modulo non chiama mai
//   callAiRouter — riceve la patch già generata dal chiamante
//   (app/api/creator/refactor/route.ts, tier "schema-edit" esistente).
// - RIUSA la validazione esistente: `runValidator` (creator-ai-orchestrator.ts,
//   Fase 5) resta l'unica fonte di verità semantica (sanitizeSiteBlueprint +
//   AppSpecificationSchema + controlli relation/state) — non reimplementata.
// - "La patch deve essere validata... prima dell'applicazione" (requisito
//   Fase 6): la struttura delle singole operazioni (op/path/value/from) è
//   validata da JsonPatchArraySchema PRIMA di tentare qualunque applicazione;
//   il DOCUMENTO risultante è validato con runValidator DOPO l'applicazione,
//   prima di essere accettato come nuovo schema autorevole.
// - Fallback obbligatorio: questo modulo non decide MAI di fare il fallback
//   da solo — si limita a restituire {ok:false, errors} per qualunque patch
//   malformata/ambigua/semanticamente invalida/con perdita di dati non
//   dichiarata. È app/api/creator/refactor/route.ts a decidere di ricadere
//   sulla riscrittura completa quando ok=false (requisito Fase 6, punto 2).

import { z } from 'zod';
import type { AdminEntity, SiteBlueprintJSON } from './site-schema.ts';
import { runValidator } from './creator-ai-orchestrator.ts';
import type { AppSpecification } from './app-specification.ts';

// ─── RFC6902: operazioni ────────────────────────────────────────────────────
// path/from devono essere JSON Pointer (RFC6901) validi: stringa vuota (radice)
// oppure una sequenza di segmenti "/segmento" (i caratteri '~' e '/' dentro un
// segmento sono già gestiti via escape ~0/~1 dal chiamante, qui verifichiamo
// solo la forma generale — la risoluzione vera avviene in applyJsonPatch).
const JsonPointerSchema = z.string().regex(/^(\/([^/~]|~0|~1)*)*$/, 'non è un JSON Pointer valido (RFC6901)');

export const JsonPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: JsonPointerSchema }),
  z.object({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('move'), path: JsonPointerSchema, from: JsonPointerSchema }),
  z.object({ op: z.literal('copy'), path: JsonPointerSchema, from: JsonPointerSchema }),
  z.object({ op: z.literal('test'), path: JsonPointerSchema, value: z.unknown() }),
]);
export type JsonPatchOp = z.infer<typeof JsonPatchOperationSchema>;

// Un tetto basso (50) è intenzionale: una patch "scoped" per definizione
// tocca poco. Una patch più lunga di così non è più un refactor mirato — è
// un segnale che il modello avrebbe dovuto fare una riscrittura completa,
// quindi la rifiutiamo qui (ok:false) e lasciamo che il chiamante ricada sul
// fallback, invece di eseguire comunque una patch enorme e rischiosa.
export const JsonPatchArraySchema = z.array(JsonPatchOperationSchema).min(1).max(50);

// ─── JSON Pointer (RFC6901) ─────────────────────────────────────────────────
// Segmenti mai attraversabili in scrittura: prevenzione prototype pollution
// nel caso (mai fidarsi anche di un output AI) una patch contenga un path
// tipo "/__proto__/isAdmin" — bloccato indipendentemente da dove compare nel
// pointer (segmento intermedio o finale).
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function splitPointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`JSON Pointer non valido: "${pointer}" deve iniziare con "/" o essere vuoto`);
  }
  const segments = pointer.split('/').slice(1).map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      throw new Error(`segmento di path non ammesso: "${seg}"`);
    }
  }
  return segments;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Naviga fino al genitore dell'ultimo segmento del pointer, restituendo
 * {container, key} pronti per una lettura/scrittura/cancellazione su quella
 * chiave. Lancia se un segmento intermedio non esiste/non è attraversabile. */
function resolveParent(root: unknown, pointer: string): { container: Record<string, unknown> | unknown[]; key: string } {
  const parts = splitPointer(pointer);
  if (parts.length === 0) {
    throw new Error('il path radice "" non è un target valido per questa operazione');
  }
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (Array.isArray(cur)) {
      const idx = key === '-' ? cur.length - 1 : Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new Error(`indice di array fuori range al segmento "${key}" del path "${pointer}"`);
      }
      cur = cur[idx];
    } else if (cur && typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) {
        throw new Error(`chiave inesistente "${key}" nel path "${pointer}"`);
      }
      cur = (cur as Record<string, unknown>)[key];
    } else {
      throw new Error(`path "${pointer}" non attraversabile (valore non oggetto/array al segmento "${key}")`);
    }
  }
  return { container: cur as Record<string, unknown> | unknown[], key: parts[parts.length - 1] };
}

function getValue(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  const { container, key } = resolveParent(root, pointer);
  if (Array.isArray(container)) {
    const idx = key === '-' ? container.length - 1 : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length) {
      throw new Error(`indice fuori range: "${pointer}"`);
    }
    return container[idx];
  }
  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    throw new Error(`chiave inesistente: "${pointer}"`);
  }
  return (container as Record<string, unknown>)[key];
}

function setValue(root: unknown, pointer: string, value: unknown, mode: 'add' | 'replace'): unknown {
  if (pointer === '') return value; // add/replace sulla radice: sostituisce l'intero documento.
  const { container, key } = resolveParent(root, pointer);
  if (Array.isArray(container)) {
    const idx = key === '-' ? container.length : Number(key);
    const maxIdx = mode === 'add' ? container.length : container.length - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx > maxIdx) {
      throw new Error(`indice fuori range per "${mode}": "${pointer}"`);
    }
    if (mode === 'add') container.splice(idx, 0, value);
    else container[idx] = value;
  } else if (container && typeof container === 'object') {
    if (mode === 'replace' && !Object.prototype.hasOwnProperty.call(container, key)) {
      throw new Error(`"replace" su chiave inesistente: "${pointer}"`);
    }
    (container as Record<string, unknown>)[key] = value;
  } else {
    throw new Error(`path non valido per "${mode}": "${pointer}"`);
  }
  return root;
}

function removeValue(root: unknown, pointer: string): unknown {
  const { container, key } = resolveParent(root, pointer);
  if (Array.isArray(container)) {
    const idx = key === '-' ? container.length - 1 : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length) {
      throw new Error(`indice fuori range per "remove": "${pointer}"`);
    }
    return container.splice(idx, 1)[0];
  }
  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    throw new Error(`"remove" su chiave inesistente: "${pointer}"`);
  }
  const removed = (container as Record<string, unknown>)[key];
  delete (container as Record<string, unknown>)[key];
  return removed;
}

// Confronto per l'operazione "test": limitato a valori JSON puri (stesso
// dominio di tutto questo motore, mai funzioni/date/Map/Set) — sufficiente
// per l'uso previsto (un modello non genera mai "test" con chiavi in ordine
// diverso rispetto a come le ha appena lette dallo stesso documento).
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PatchObserver {
  /** Invocato PRIMA che una "remove" rimuova effettivamente il valore, con
   * il valore rimosso e l'intero documento COM'ERA in quel momento (prima
   * della rimozione) — permette al chiamante di risalire a "di quale entità
   * faceva parte questo campo" senza che questo motore debba conoscere la
   * forma di SiteBlueprintJSON. */
  onRemove?: (path: string, removedValue: unknown, documentBeforeRemoval: unknown) => void;
}

export interface ApplyPatchResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Applica una sequenza di operazioni RFC6902 a `document`, senza mai mutare
 * l'input: lavora su una copia profonda (JSON.parse/stringify — dominio
 * sempre JSON puro). Qualunque operazione non applicabile (path inesistente,
 * indice fuori range, "test" fallito, op sconosciuta) interrompe l'intera
 * applicazione e restituisce {ok:false} — MAI un documento parzialmente
 * patchato.
 */
export function applyJsonPatch(document: unknown, patch: JsonPatchOp[], observer?: PatchObserver): ApplyPatchResult {
  if (!Array.isArray(patch) || patch.length === 0) {
    return { ok: false, error: 'la patch deve essere un array non vuoto di operazioni RFC6902' };
  }

  let root: unknown;
  try {
    root = clone(document);
  } catch {
    return { ok: false, error: 'documento non serializzabile' };
  }

  try {
    for (let i = 0; i < patch.length; i++) {
      const op = patch[i];
      switch (op.op) {
        case 'add':
          root = setValue(root, op.path, clone(op.value), 'add');
          break;
        case 'replace':
          root = setValue(root, op.path, clone(op.value), 'replace');
          break;
        case 'remove': {
          if (observer?.onRemove) {
            const beforeSnapshot = clone(root);
            const removedValue = getValue(root, op.path);
            observer.onRemove(op.path, removedValue, beforeSnapshot);
          }
          removeValue(root, op.path);
          break;
        }
        case 'move': {
          const val = getValue(root, op.from);
          removeValue(root, op.from);
          root = setValue(root, op.path, clone(val), 'add');
          break;
        }
        case 'copy': {
          const val = getValue(root, op.from);
          root = setValue(root, op.path, clone(val), 'add');
          break;
        }
        case 'test': {
          const val = getValue(root, op.path);
          if (!jsonEqual(val, op.value)) {
            throw new Error(`operazione #${i} "test" fallita su "${op.path}"`);
          }
          break;
        }
        default:
          throw new Error(`operazione #${i}: "op" non riconosciuta`);
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, result: root };
}

// ─── Livello applicativo: patch scoped su SiteBlueprintJSON ────────────────

const ENTITY_PATH_RE = /^\/adminPanel\/entities\/(\d+)$/;
const FIELD_PATH_RE = /^\/adminPanel\/entities\/(\d+)\/fields\/(\d+)$/;

export interface PatchValidationResult {
  ok: boolean;
  errors: string[];
  schema?: SiteBlueprintJSON;
  specification?: AppSpecification;
}

/**
 * Applica una patch RFC6902 (già validata strutturalmente da
 * JsonPatchArraySchema a monte, in app/api/creator/refactor/route.ts) allo
 * schema corrente e la accetta SOLO se:
 * 1. l'applicazione riesce (nessun path/indice non valido, nessun "test" fallito);
 * 2. il documento risultante resta un oggetto (mai un array/scalare);
 * 3. nessuna entità/campo presente PRIMA è scomparso senza una "remove"
 *    esplicita sul suo path esatto (requisito Fase 6: "nessuna perdita di
 *    entità/campi esistenti") — una "replace" più ampia che fa sparire
 *    elementi come effetto collaterale NON conta come esplicita: è
 *    considerata perdita accidentale e fa fallire la validazione;
 * 4. il documento risultante passa runValidator (Fase 5, RIUSATO qui, mai
 *    duplicato) — schema valido, relation/state coerenti, nessun
 *    riferimento rotto.
 * In ogni altro caso ritorna {ok:false, errors}: il chiamante decide il
 * fallback, questo modulo non lo esegue mai da solo.
 */
export function applyAndValidatePatch(currentSchema: SiteBlueprintJSON, rawPatch: unknown): PatchValidationResult {
  const parsedPatch = JsonPatchArraySchema.safeParse(rawPatch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      errors: [`Patch malformata: ${parsedPatch.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`],
    };
  }
  const patch = parsedPatch.data;

  const removedEntityNames = new Set<string>();
  const removedFieldKeys = new Set<string>(); // "entityName.fieldId"

  const applied = applyJsonPatch(currentSchema, patch, {
    onRemove: (path, removedValue, documentBeforeRemoval) => {
      if (ENTITY_PATH_RE.test(path)) {
        const name = (removedValue as { name?: unknown } | null)?.name;
        if (typeof name === 'string') removedEntityNames.add(name);
        return;
      }
      const fieldMatch = path.match(FIELD_PATH_RE);
      if (fieldMatch) {
        const entityIdx = Number(fieldMatch[1]);
        const doc = documentBeforeRemoval as { adminPanel?: { entities?: Array<{ name?: unknown }> } };
        const entityName = doc.adminPanel?.entities?.[entityIdx]?.name;
        const fieldId = (removedValue as { id?: unknown } | null)?.id;
        if (typeof entityName === 'string' && typeof fieldId === 'string') {
          removedFieldKeys.add(`${entityName}.${fieldId}`);
        }
      }
    },
  });

  if (!applied.ok) {
    return { ok: false, errors: [`Applicazione patch fallita: ${applied.error}`] };
  }
  if (!applied.result || typeof applied.result !== 'object' || Array.isArray(applied.result)) {
    return { ok: false, errors: ['La patch applicata non produce più un oggetto schema valido'] };
  }

  const errors: string[] = [];
  const afterRaw = applied.result as { adminPanel?: { entities?: Array<{ name?: unknown; fields?: Array<{ id?: unknown }> }> } };
  const afterEntities = afterRaw.adminPanel?.entities ?? [];
  const afterEntityByName = new Map(
    afterEntities.filter((e): e is { name: string; fields?: Array<{ id?: unknown }> } => typeof e?.name === 'string').map((e) => [e.name, e])
  );

  for (const entity of currentSchema.adminPanel.entities as AdminEntity[]) {
    const afterEntity = afterEntityByName.get(entity.name);
    if (!afterEntity) {
      if (!removedEntityNames.has(entity.name)) {
        errors.push(`L'entità "${entity.name}" è scomparsa senza un'operazione "remove" esplicita su di essa: possibile perdita di dati accidentale.`);
      }
      continue; // rimossa esplicitamente (o già segnalata sopra): nessun controllo sui suoi campi.
    }
    const afterFieldIds = new Set((afterEntity.fields ?? []).map((f) => f?.id).filter((id): id is string => typeof id === 'string'));
    for (const field of entity.fields) {
      if (!afterFieldIds.has(field.id) && !removedFieldKeys.has(`${entity.name}.${field.id}`)) {
        errors.push(`Il campo "${field.id}" dell'entità "${entity.name}" è scomparso senza un'operazione "remove" esplicita su di esso: possibile perdita di dati accidentale.`);
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Validazione semantica finale — RIUSATA da creator-ai-orchestrator.ts
  // (Fase 5), mai reimplementata qui: schema Zod, relation/state coerenti,
  // nessun riferimento rotto tra pagine/entità.
  const validation = runValidator(applied.result);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  return { ok: true, errors: [], schema: validation.sanitized, specification: validation.specification };
}
