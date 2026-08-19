'use client';

// ─── Automation — UI (Pre-Beta Hardening, Blocco 5 + Round 2 level-up) ─────
// Scrive/legge esattamente lo stesso campo che il motore reale già esegue
// (apps.config.workflows via /api/apps/[id]/workflows, vedi quella route per
// il perché) — nessun secondo sistema. Round 2 estende lo scope originale
// (1 trigger/1 azione/1 condizione) con: fino a MAX_ACTIONS azioni per
// workflow, l'azione http_request (chiamata HTTP generica, Integrations
// Round 2), condizioni multiple con un operatore AND/OR condiviso, modifica
// in-place (prima solo elimina+ricrea) e un pannello "ultime esecuzioni" per
// workflow (riusa /api/apps/[id]/action-logs, filtrato lato client per
// workflow_id — nessun nuovo endpoint). Resta volutamente NON un workflow
// builder visuale completo: niente drag&drop, niente condizioni annidate a
// più livelli — coerente con lo scope della route (vedi ui-scope.ts).

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/src/lib/supabase';

type TriggerEvent = 'record.created' | 'record.updated' | 'state.changed';
type ActionType = 'update_field' | 'send_notification' | 'trigger_webhook' | 'http_request';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'greater_or_equal' | 'less_or_equal' | 'exists' | 'not_exists';

const MAX_ACTIONS = 5;
const MAX_HEADER_ROWS = 5;

interface EntityField {
  id: string;
  label: string;
  type: string;
  states?: string[];
}
interface EntityMeta {
  name: string;
  label: string;
  fields: EntityField[];
}

interface ConditionLeaf {
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean | null;
}
type WorkflowConditions = ConditionLeaf | { operator: 'AND' | 'OR'; conditions: ConditionLeaf[] };

type Action =
  | { type: 'update_field'; field: string; value?: string | number | boolean | null }
  | { type: 'send_notification'; recipient: 'app_owner' | 'record_field'; recipientField?: string; subject?: string; message?: string }
  | { type: 'trigger_webhook'; webhookUrl?: string }
  | { type: 'http_request'; url?: string; method?: HttpMethod; headers?: Record<string, string>; body?: string };

interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { event: TriggerEvent; entity?: string; toState?: string; fromState?: string };
  conditions?: WorkflowConditions;
  actions: Action[];
}

interface ActionLogRow {
  id: string;
  action_type: string | null;
  status: 'dispatched' | 'delivered' | 'failed' | string;
  error: string | null;
  workflow_id: string | null;
  retry_count: number | null;
  created_at: string;
}

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  'record.created': 'quando viene creato un record',
  'record.updated': 'quando un record viene modificato',
  'state.changed': 'quando lo stato di un record cambia',
};

const ACTION_LABELS: Record<ActionType, string> = {
  update_field: 'Aggiorna un campo',
  send_notification: 'Invia una notifica',
  trigger_webhook: 'Chiama un webhook',
  http_request: 'Chiamata HTTP (avanzata)',
};

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'è uguale a',
  not_equals: 'è diverso da',
  contains: 'contiene',
  not_contains: 'non contiene',
  greater_than: 'è maggiore di',
  less_than: 'è minore di',
  greater_or_equal: 'è maggiore o uguale a',
  less_or_equal: 'è minore o uguale a',
  exists: 'è valorizzato',
  not_exists: 'non è valorizzato',
};

function conditionsAsLeaves(c: WorkflowConditions | undefined): ConditionLeaf[] {
  if (!c) return [];
  return 'conditions' in c ? c.conditions : [c];
}
function conditionsGroupOperator(c: WorkflowConditions | undefined): 'AND' | 'OR' {
  return c && 'conditions' in c ? c.operator : 'AND';
}

function summarizeTrigger(w: Workflow, entities: EntityMeta[]): string {
  const entityLabel = entities.find((e) => e.name === w.trigger.entity)?.label || w.trigger.entity || 'qualunque entità';
  if (w.trigger.event === 'state.changed') {
    const to = w.trigger.toState ? ` → "${w.trigger.toState}"` : '';
    return `${TRIGGER_LABELS['state.changed']} su ${entityLabel}${to}`;
  }
  return `${TRIGGER_LABELS[w.trigger.event]} su ${entityLabel}`;
}

function summarizeAction(action: Action): string {
  if (action.type === 'update_field') return `Aggiorna campo "${action.field}"`;
  if (action.type === 'send_notification') return `Notifica → ${action.recipient === 'record_field' ? `campo "${action.recipientField}"` : 'titolare app'}`;
  if (action.type === 'trigger_webhook') return `Webhook → ${action.webhookUrl || '(nessun URL)'}`;
  if (action.type === 'http_request') return `${action.method || 'POST'} → ${action.url || '(nessun URL)'}`;
  return '—';
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function emptyActionOfType(type: ActionType): Action {
  if (type === 'update_field') return { type, field: '', value: '' };
  if (type === 'send_notification') return { type, recipient: 'app_owner' };
  if (type === 'trigger_webhook') return { type, webhookUrl: '' };
  return { type, url: '', method: 'POST', headers: {}, body: '' };
}

export default function AutomationPage() {
  const params = useParams();
  const appId = params.id as string;

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formDetails, setFormDetails] = useState<string[]>([]);

  // ─── Log di esecuzione (per workflow, on-demand) ──────────────────────
  const [logs, setLogs] = useState<ActionLogRow[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [openLogsFor, setOpenLogsFor] = useState<string | null>(null);

  // ─── Form state ────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>('record.created');
  const [entity, setEntity] = useState('');
  const [toState, setToState] = useState('');
  const [actions, setActions] = useState<Action[]>([emptyActionOfType('update_field')]);
  const [conditionRows, setConditionRows] = useState<ConditionLeaf[]>([]);
  const [conditionGroupOp, setConditionGroupOp] = useState<'AND' | 'OR'>('AND');

  const selectedEntity = entities.find((e) => e.name === entity);
  const stateField = selectedEntity?.fields.find((f) => f.type === 'state');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/apps/${appId}/workflows`, { headers });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Errore caricando le automazioni');
        return;
      }
      setWorkflows(body.workflows || []);
      setEntities(body.entities || []);
      if (!entity && body.entities?.[0]) setEntity(body.entities[0].name);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => {
    queueMicrotask(() => { load(); });
  }, [load]);

  function resetForm() {
    setName('');
    setTriggerEvent('record.created');
    setToState('');
    setActions([emptyActionOfType('update_field')]);
    setConditionRows([]);
    setConditionGroupOp('AND');
    setFormError('');
    setFormDetails([]);
    setEditingId(null);
  }

  function startEdit(w: Workflow) {
    setName(w.name);
    setTriggerEvent(w.trigger.event);
    setEntity(w.trigger.entity || entity);
    setToState(w.trigger.toState || '');
    setActions(w.actions.length > 0 ? w.actions : [emptyActionOfType('update_field')]);
    setConditionRows(conditionsAsLeaves(w.conditions));
    setConditionGroupOp(conditionsGroupOperator(w.conditions));
    setEditingId(w.id);
    setFormError('');
    setFormDetails([]);
    setShowForm(true);
  }

  function updateAction(index: number, next: Action) {
    setActions((prev) => prev.map((a, i) => (i === index ? next : a)));
  }
  function addAction() {
    if (actions.length >= MAX_ACTIONS) return;
    setActions((prev) => [...prev, emptyActionOfType('update_field')]);
  }
  function removeAction(index: number) {
    setActions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function addConditionRow() {
    setConditionRows((prev) => [...prev, { field: selectedEntity?.fields[0]?.id || '', operator: 'equals', value: '' }]);
  }
  function updateConditionRow(index: number, next: Partial<ConditionLeaf>) {
    setConditionRows((prev) => prev.map((c, i) => (i === index ? { ...c, ...next } : c)));
  }
  function removeConditionRow(index: number) {
    setConditionRows((prev) => prev.filter((_, i) => i !== index));
  }

  function buildActionsPayload(): { ok: true; actions: Action[] } | { ok: false; error: string } {
    const cleaned: Action[] = [];
    for (const a of actions) {
      if (a.type === 'update_field') {
        if (!a.field) return { ok: false, error: 'Ogni azione "Aggiorna un campo" richiede un campo' };
        cleaned.push({ type: 'update_field', field: a.field, value: a.value ?? '' });
      } else if (a.type === 'send_notification') {
        if (a.recipient === 'record_field' && !a.recipientField) return { ok: false, error: 'Indica da quale campo prendere l\'email del destinatario' };
        cleaned.push({ type: 'send_notification', recipient: a.recipient, recipientField: a.recipient === 'record_field' ? a.recipientField : undefined, subject: a.subject || undefined, message: a.message || undefined });
      } else if (a.type === 'trigger_webhook') {
        if (!a.webhookUrl?.trim()) return { ok: false, error: 'Inserisci l\'URL del webhook' };
        cleaned.push({ type: 'trigger_webhook', webhookUrl: a.webhookUrl.trim() });
      } else {
        if (!a.url?.trim()) return { ok: false, error: 'Inserisci l\'URL della chiamata HTTP' };
        cleaned.push({ type: 'http_request', url: a.url.trim(), method: a.method || 'POST', headers: a.headers || {}, body: a.body || undefined });
      }
    }
    return { ok: true, actions: cleaned };
  }

  function buildBody(): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
    if (!name.trim()) return { ok: false, error: 'Dai un nome all\'automazione' };
    if (!entity) return { ok: false, error: 'Scegli su quale entità agisce' };
    if (triggerEvent === 'state.changed' && !toState) return { ok: false, error: 'Scegli lo stato di destinazione' };

    const actionsResult = buildActionsPayload();
    if (!actionsResult.ok) return actionsResult;

    const body: Record<string, unknown> = {
      name: name.trim(),
      trigger: { event: triggerEvent, entity, ...(triggerEvent === 'state.changed' ? { toState } : {}) },
      actions: actionsResult.actions,
    };
    const validRows = conditionRows.filter((c) => c.field);
    if (validRows.length === 1) {
      body.conditions = validRows[0];
    } else if (validRows.length > 1) {
      body.conditions = { operator: conditionGroupOp, conditions: validRows };
    }
    return { ok: true, body };
  }

  async function handleSubmit() {
    setFormError('');
    setFormDetails([]);
    const result = buildBody();
    if (!result.ok) { setFormError(result.error); return; }

    setSaving(true);
    try {
      const headers = await authHeader();
      const isEdit = Boolean(editingId);
      const res = await fetch(`/api/apps/${appId}/workflows${isEdit ? `/${editingId}` : ''}`, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(result.body),
      });
      const responseBody = await res.json();
      if (!res.ok) {
        setFormError(responseBody.error || `Errore ${isEdit ? 'salvataggio' : 'creazione'} automazione`);
        setFormDetails(Array.isArray(responseBody.details) ? responseBody.details : []);
        return;
      }
      if (isEdit) {
        setWorkflows((prev) => prev.map((w) => (w.id === editingId ? responseBody.workflow : w)));
      } else {
        setWorkflows((prev) => [...prev, responseBody.workflow]);
      }
      resetForm();
      setShowForm(false);
    } catch {
      setFormError('Errore di connessione — verifica la rete e riprova');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(w: Workflow) {
    const headers = await authHeader();
    const res = await fetch(`/api/apps/${appId}/workflows/${w.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    if (res.ok) {
      setWorkflows((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: !w.enabled } : x)));
    }
  }

  async function remove(w: Workflow) {
    const headers = await authHeader();
    const res = await fetch(`/api/apps/${appId}/workflows/${w.id}`, { method: 'DELETE', headers });
    if (res.ok) {
      setWorkflows((prev) => prev.filter((x) => x.id !== w.id));
      if (editingId === w.id) { resetForm(); setShowForm(false); }
    }
  }

  async function toggleLogs(workflowId: string) {
    if (openLogsFor === workflowId) {
      setOpenLogsFor(null);
      return;
    }
    setOpenLogsFor(workflowId);
    setLogsLoading(true);
    setLogsError('');
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/apps/${appId}/action-logs`, { headers });
      const body = await res.json();
      if (res.ok) {
        setLogs(body.logs || []);
      } else {
        setLogsError(body.error || 'Errore caricamento log');
      }
    } catch {
      setLogsError('Errore di connessione');
    } finally {
      setLogsLoading(false);
    }
  }

  const inputClass = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/projects/${appId}`} className="text-slate-400 hover:text-white transition">←</Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Automazioni</h1>
          <p className="text-slate-400 text-sm mt-1">
            Regole del tipo <em>quando succede X, fai Y (e Z)</em> — attivabili/disattivabili e modificabili in ogni momento.
          </p>
        </div>
      </div>

      {loading && <p className="text-slate-400">Caricamento…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {!loading && !error && (
        <>
          {entities.length === 0 && (
            <div className="border border-amber-800/60 bg-amber-950/30 text-amber-300 rounded-xl p-4 text-sm">
              Questa app non ha ancora entità/tabelle definite: crea prima almeno una tabella dal Creator per poter configurare un&apos;automazione.
            </div>
          )}

          {workflows.length === 0 && (
            <p className="text-slate-500 text-sm">Nessuna automazione configurata.</p>
          )}

          <div className="space-y-3">
            {workflows.map((w) => (
              <div key={w.id} className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold">{w.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${w.enabled ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                        {w.enabled ? 'Attiva' : 'Disattivata'}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1">{summarizeTrigger(w, entities)}</p>
                    <div className="text-slate-300 text-sm mt-0.5 space-y-0.5">
                      {w.actions.map((a, i) => <p key={i}>→ {summarizeAction(a)}</p>)}
                    </div>
                    {w.conditions && (
                      <p className="text-slate-500 text-xs mt-1">
                        solo se {conditionsAsLeaves(w.conditions).map((c, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-slate-600"> {conditionsGroupOperator(w.conditions)} </span>}
                            &quot;{c.field}&quot; {OPERATOR_LABELS[c.operator]} {String(c.value ?? '')}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => toggleLogs(w.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    >
                      {openLogsFor === w.id ? 'Nascondi log' : 'Ultime esecuzioni'}
                    </button>
                    <button
                      onClick={() => startEdit(w)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => toggleEnabled(w)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition"
                    >
                      {w.enabled ? 'Disattiva' : 'Attiva'}
                    </button>
                    <button
                      onClick={() => remove(w)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-300 transition"
                    >
                      Elimina
                    </button>
                  </div>
                </div>

                {openLogsFor === w.id && (
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    {logsLoading && <p className="text-slate-500 text-xs">Caricamento log…</p>}
                    {logsError && <p className="text-red-400 text-xs">{logsError}</p>}
                    {!logsLoading && !logsError && (() => {
                      const rows = (logs || []).filter((l) => l.workflow_id === w.id).slice(0, 10);
                      if (rows.length === 0) return <p className="text-slate-500 text-xs">Nessuna esecuzione registrata finora per questa automazione.</p>;
                      return (
                        <ul className="space-y-1.5">
                          {rows.map((l) => (
                            <li key={l.id} className="flex items-center gap-2 text-xs">
                              <span className="text-slate-500 whitespace-nowrap">
                                {new Date(l.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded font-medium ${
                                l.status === 'delivered' ? 'bg-emerald-900/50 text-emerald-300'
                                : l.status === 'failed' ? 'bg-red-900/50 text-red-300'
                                : 'bg-blue-900/50 text-blue-300'
                              }`}>
                                {l.status}
                              </span>
                              <span className="text-slate-400">{l.action_type}</span>
                              {l.error && <span className="text-slate-500 truncate" title={l.error}>— {l.error}</span>}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!showForm && entities.length > 0 && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              + Nuova automazione
            </button>
          )}

          {showForm && (
            <div className="border border-slate-800 rounded-xl p-5 bg-slate-900/60 space-y-4">
              <h3 className="text-white font-semibold">{editingId ? 'Modifica automazione' : 'Nuova automazione'}</h3>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Es. Avvisa quando arriva un nuovo ordine"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quando</label>
                  <select value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value as TriggerEvent)} className={inputClass}>
                    {(Object.keys(TRIGGER_LABELS) as TriggerEvent[]).map((ev) => (
                      <option key={ev} value={ev}>{TRIGGER_LABELS[ev]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Su quale entità</label>
                  <select value={entity} onChange={(e) => setEntity(e.target.value)} className={inputClass}>
                    {entities.map((e) => (
                      <option key={e.name} value={e.name}>{e.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {triggerEvent === 'state.changed' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nuovo stato</label>
                  {stateField?.states?.length ? (
                    <select value={toState} onChange={(e) => setToState(e.target.value)} className={inputClass}>
                      <option value="">— scegli —</option>
                      {stateField.states.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <p className="text-amber-400 text-xs">Questa entità non ha un campo di tipo stato: scegli un&apos;altra entità o un altro trigger.</p>
                  )}
                </div>
              )}

              {/* ─── Azioni (Round 2: fino a MAX_ACTIONS) ────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs text-slate-400">Azioni ({actions.length}/{MAX_ACTIONS})</label>
                  {actions.length < MAX_ACTIONS && (
                    <button type="button" onClick={addAction} className="text-xs text-indigo-400 hover:text-indigo-300">+ Aggiungi azione</button>
                  )}
                </div>
                {actions.map((action, index) => (
                  <div key={index} className="border border-slate-700 rounded-lg p-3 bg-slate-800/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={action.type}
                        onChange={(e) => updateAction(index, emptyActionOfType(e.target.value as ActionType))}
                        className={`${inputClass} flex-1`}
                      >
                        {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
                          <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                        ))}
                      </select>
                      {actions.length > 1 && (
                        <button type="button" onClick={() => removeAction(index)} className="text-red-400 hover:text-red-300 text-xs px-2">Rimuovi</button>
                      )}
                    </div>

                    {action.type === 'update_field' && (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={action.field} onChange={(e) => updateAction(index, { ...action, field: e.target.value })} className={inputClass}>
                          <option value="">— campo —</option>
                          {selectedEntity?.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                        <input
                          value={String(action.value ?? '')}
                          onChange={(e) => updateAction(index, { ...action, value: e.target.value })}
                          placeholder="Nuovo valore"
                          className={inputClass}
                        />
                      </div>
                    )}

                    {action.type === 'send_notification' && (
                      <div className="space-y-2">
                        <select
                          value={action.recipient}
                          onChange={(e) => updateAction(index, { ...action, recipient: e.target.value as 'app_owner' | 'record_field' })}
                          className={inputClass}
                        >
                          <option value="app_owner">Titolare dell&apos;app</option>
                          <option value="record_field">Email presa da un campo del record</option>
                        </select>
                        {action.recipient === 'record_field' && (
                          <select value={action.recipientField || ''} onChange={(e) => updateAction(index, { ...action, recipientField: e.target.value })} className={inputClass}>
                            <option value="">— campo con l&apos;email —</option>
                            {selectedEntity?.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                          </select>
                        )}
                        <input value={action.subject || ''} onChange={(e) => updateAction(index, { ...action, subject: e.target.value })} placeholder="Oggetto (opzionale)" className={inputClass} />
                        <textarea value={action.message || ''} onChange={(e) => updateAction(index, { ...action, message: e.target.value })} rows={2} placeholder="Messaggio (opzionale)" className={inputClass} />
                      </div>
                    )}

                    {action.type === 'trigger_webhook' && (
                      <input
                        value={action.webhookUrl || ''}
                        onChange={(e) => updateAction(index, { ...action, webhookUrl: e.target.value })}
                        placeholder="https://..."
                        className={inputClass}
                      />
                    )}

                    {action.type === 'http_request' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <select value={action.method || 'POST'} onChange={(e) => updateAction(index, { ...action, method: e.target.value as HttpMethod })} className={`${inputClass} w-28 shrink-0`}>
                            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <input value={action.url || ''} onChange={(e) => updateAction(index, { ...action, url: e.target.value })} placeholder="https://..." className={`${inputClass} flex-1`} />
                        </div>
                        <HeaderRowsEditor
                          headers={action.headers || {}}
                          onChange={(headers) => updateAction(index, { ...action, headers })}
                        />
                        {action.method !== 'GET' && action.method !== 'DELETE' && (
                          <textarea
                            value={action.body || ''}
                            onChange={(e) => updateAction(index, { ...action, body: e.target.value })}
                            rows={2}
                            placeholder="Corpo della richiesta (opzionale, testo o JSON)"
                            className={`${inputClass} font-mono`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ─── Condizioni (Round 2: multiple con AND/OR) ───────────── */}
              <div className="border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-slate-400">Condizioni (opzionale — esegui solo se vere)</label>
                  <button type="button" onClick={addConditionRow} className="text-xs text-indigo-400 hover:text-indigo-300">+ Aggiungi condizione</button>
                </div>
                {conditionRows.length > 1 && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                    <span>Combina con</span>
                    <select value={conditionGroupOp} onChange={(e) => setConditionGroupOp(e.target.value as 'AND' | 'OR')} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white">
                      <option value="AND">TUTTE (AND)</option>
                      <option value="OR">ALMENO UNA (OR)</option>
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  {conditionRows.map((c, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                      <select value={c.field} onChange={(e) => updateConditionRow(index, { field: e.target.value })} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-white text-sm">
                        <option value="">Campo…</option>
                        {selectedEntity?.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                      <select value={c.operator} onChange={(e) => updateConditionRow(index, { operator: e.target.value as ConditionOperator })} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-white text-sm">
                        {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
                          <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                        ))}
                      </select>
                      <input
                        value={String(c.value ?? '')}
                        onChange={(e) => updateConditionRow(index, { value: e.target.value })}
                        placeholder="Valore"
                        disabled={c.operator === 'exists' || c.operator === 'not_exists'}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-white text-sm disabled:opacity-40"
                      />
                      <button type="button" onClick={() => removeConditionRow(index)} className="text-red-400 hover:text-red-300 text-xs px-2">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {formError && (
                <div className="text-sm text-red-400">
                  <p>{formError}</p>
                  {formDetails.length > 0 && (
                    <ul className="list-disc list-inside text-xs text-red-300/80 mt-1">
                      {formDetails.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition"
                >
                  {saving ? 'Salvataggio…' : editingId ? 'Salva modifiche' : 'Crea automazione'}
                </button>
                <button
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="text-slate-400 hover:text-white text-sm"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Editor minimo per gli header dell'azione http_request: righe chiave/valore
// (max MAX_HEADER_ROWS, stesso tetto lato server — vedi
// action-dispatcher.js::sanitizeHttpActionHeaders — qui è solo UX, il limite
// autoritativo resta lato backend). Host/Content-Length/Content-Type non
// sono filtrati qui apposta: il backend li scarta comunque sempre (vedi
// FORBIDDEN_HTTP_ACTION_HEADERS), digitarli qui non ha alcun effetto.
function HeaderRowsEditor({ headers, onChange }: { headers: Record<string, string>; onChange: (h: Record<string, string>) => void }) {
  const rows = Object.entries(headers);

  function setRow(index: number, key: string, value: string) {
    const next = [...rows];
    next[index] = [key, value];
    onChange(Object.fromEntries(next.filter(([k]) => k)));
  }
  function removeRow(index: number) {
    onChange(Object.fromEntries(rows.filter((_, i) => i !== index)));
  }
  function addRow() {
    if (rows.length >= MAX_HEADER_ROWS) return;
    onChange(Object.fromEntries([...rows, ['', '']]));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Header personalizzati (opzionale, es. Authorization)</span>
        {rows.length < MAX_HEADER_ROWS && (
          <button type="button" onClick={addRow} className="text-xs text-indigo-400 hover:text-indigo-300">+ Header</button>
        )}
      </div>
      {rows.map(([key, value], index) => (
        <div key={index} className="flex gap-2">
          <input value={key} onChange={(e) => setRow(index, e.target.value, value)} placeholder="Nome header" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" />
          <input value={value} onChange={(e) => setRow(index, key, e.target.value)} placeholder="Valore" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" />
          <button type="button" onClick={() => removeRow(index)} className="text-red-400 hover:text-red-300 text-xs px-1">✕</button>
        </div>
      ))}
    </div>
  );
}
