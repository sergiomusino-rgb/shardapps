'use client';

// ─── Form di candidatura Private Beta ──────────────────────────────────────
// Fase 1B: la submit chiama POST /api/beta/apply (route server-side, mai un
// insert diretto dal browser — vedi quel file per RLS/service role) invece
// di limitarsi a mostrare lo stato di successo come nella Fase 1. Tutte le
// validazioni client-side esistenti restano invariate: sono la prima difesa
// (feedback immediato), la route le rifà comunque lato server perché non
// bisogna mai fidarsi solo del client.
import { useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { trackBetaEvent } from '@/lib/beta-tracking';

type BusinessType = 'agency' | 'freelancer' | 'reseller' | 'other';
type ClientsRange = '1-10' | '11-50' | '51-100' | '100+';
type AppsExpected = '1-3' | '4-10' | '10+';

interface FormState {
  fullName: string;
  company: string;
  email: string;
  website: string;
  country: string;
  businessType: BusinessType | '';
  clientsRange: ClientsRange | '';
  appsType: string;
  appsExpected: AppsExpected | '';
  notes: string;
}

const INITIAL_STATE: FormState = {
  fullName: '',
  company: '',
  email: '',
  website: '',
  country: '',
  businessType: '',
  clientsRange: '',
  appsType: '',
  appsExpected: '',
  notes: '',
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';
const selectClass = `${inputClass} appearance-none pr-10`;
const errorClass = 'mt-1.5 text-xs font-medium text-red-400';
const labelClass = 'mb-1.5 block text-sm font-semibold text-slate-200';

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

type SubmitOutcome = 'created' | 'already_applied';

export default function BetaApplicationForm() {
  const { t } = useLanguage();
  const [values, setValues] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const startedRef = useRef(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function markStarted() {
    if (startedRef.current) return;
    startedRef.current = true;
    trackBetaEvent('beta_apply_start');
  }

  function validate(v: FormState): FieldErrors {
    const next: FieldErrors = {};
    if (!v.fullName.trim()) next.fullName = t('beta_form_error_required');
    if (!v.company.trim()) next.company = t('beta_form_error_required');
    if (!v.email.trim()) next.email = t('beta_form_error_required');
    else if (!EMAIL_RE.test(v.email.trim())) next.email = t('beta_form_error_email');
    if (!v.website.trim()) next.website = t('beta_form_error_required');
    if (!v.country.trim()) next.country = t('beta_form_error_required');
    if (!v.businessType) next.businessType = t('beta_form_error_required');
    if (!v.clientsRange) next.clientsRange = t('beta_form_error_required');
    if (!v.appsType.trim()) next.appsType = t('beta_form_error_required');
    if (!v.appsExpected) next.appsExpected = t('beta_form_error_required');
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/beta/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: values.fullName.trim(),
          company_name: values.company.trim(),
          email: values.email.trim(),
          website: values.website.trim(),
          country: values.country.trim(),
          business_type: values.businessType,
          client_count: values.clientsRange,
          app_types: values.appsType.trim(),
          expected_apps: values.appsExpected,
          message: values.notes.trim(),
        }),
      });

      // Nessuna response.json() opzionale: sia il ramo ok che quello di
      // errore hanno sempre un body JSON (vedi route.ts), un parse fallito
      // qui è già di per sé un errore server da mostrare.
      const body = await res.json().catch(() => null);

      if (res.ok && body?.code === 'CREATED') {
        trackBetaEvent('beta_apply_submit');
        setOutcome('created');
        return;
      }
      if (res.ok && body?.code === 'ALREADY_APPLIED') {
        // Non un errore: la candidatura per questa email esiste già,
        // vedi route.ts — mostriamo comunque un esito positivo ma con un
        // messaggio diverso dal "candidatura ricevuta ora".
        trackBetaEvent('beta_apply_submit');
        setOutcome('already_applied');
        return;
      }

      // Qualunque altro caso (400/429/500/rete): NON mostrare successo, come
      // richiesto — il messaggio resta generico, mai il dettaglio grezzo
      // dell'errore server.
      setServerError(t('beta_form_error_server'));
    } catch {
      setServerError(t('beta_form_error_server'));
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    const title = outcome === 'already_applied' ? t('beta_form_already_applied_title') : t('beta_form_success_title');
    const text = outcome === 'already_applied' ? t('beta_form_already_applied_text') : t('beta_form_success_text');
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center sm:p-10">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-emerald-400" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="mb-2 text-xl font-black text-white">{title}</h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">{text}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} onFocus={markStarted} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="beta-fullName" label={t('beta_form_field_name')} error={errors.fullName}>
          <input
            id="beta-fullName"
            type="text"
            autoComplete="name"
            className={inputClass}
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
          />
        </Field>

        <Field id="beta-company" label={t('beta_form_field_company')} error={errors.company}>
          <input
            id="beta-company"
            type="text"
            autoComplete="organization"
            className={inputClass}
            value={values.company}
            onChange={(e) => set('company', e.target.value)}
          />
        </Field>

        <Field id="beta-email" label={t('beta_form_field_email')} error={errors.email}>
          <input
            id="beta-email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>

        <Field id="beta-website" label={t('beta_form_field_website')} error={errors.website}>
          <input
            id="beta-website"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            className={inputClass}
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </Field>

        <Field id="beta-country" label={t('beta_form_field_country')} error={errors.country}>
          <input
            id="beta-country"
            type="text"
            autoComplete="country-name"
            className={inputClass}
            value={values.country}
            onChange={(e) => set('country', e.target.value)}
          />
        </Field>

        <Field id="beta-businessType" label={t('beta_form_field_role')} error={errors.businessType}>
          <SelectWrapper>
            <select
              id="beta-businessType"
              className={selectClass}
              value={values.businessType}
              onChange={(e) => set('businessType', e.target.value as BusinessType)}
            >
              <option value="">{t('beta_form_select_placeholder')}</option>
              <option value="agency">{t('beta_form_role_agency')}</option>
              <option value="freelancer">{t('beta_form_role_freelancer')}</option>
              <option value="reseller">{t('beta_form_role_reseller')}</option>
              <option value="other">{t('beta_form_role_other')}</option>
            </select>
          </SelectWrapper>
        </Field>

        <Field id="beta-clientsRange" label={t('beta_form_field_clients')} error={errors.clientsRange}>
          <SelectWrapper>
            <select
              id="beta-clientsRange"
              className={selectClass}
              value={values.clientsRange}
              onChange={(e) => set('clientsRange', e.target.value as ClientsRange)}
            >
              <option value="">{t('beta_form_select_placeholder')}</option>
              <option value="1-10">{t('beta_form_clients_1_10')}</option>
              <option value="11-50">{t('beta_form_clients_11_50')}</option>
              <option value="51-100">{t('beta_form_clients_51_100')}</option>
              <option value="100+">{t('beta_form_clients_100_plus')}</option>
            </select>
          </SelectWrapper>
        </Field>

        <Field id="beta-appsExpected" label={t('beta_form_field_apps_expected')} error={errors.appsExpected}>
          <SelectWrapper>
            <select
              id="beta-appsExpected"
              className={selectClass}
              value={values.appsExpected}
              onChange={(e) => set('appsExpected', e.target.value as AppsExpected)}
            >
              <option value="">{t('beta_form_select_placeholder')}</option>
              <option value="1-3">{t('beta_form_apps_1_3')}</option>
              <option value="4-10">{t('beta_form_apps_4_10')}</option>
              <option value="10+">{t('beta_form_apps_10_plus')}</option>
            </select>
          </SelectWrapper>
        </Field>
      </div>

      <Field id="beta-appsType" label={t('beta_form_field_apps_type')} error={errors.appsType}>
        <textarea
          id="beta-appsType"
          rows={3}
          className={`${inputClass} resize-y`}
          value={values.appsType}
          onChange={(e) => set('appsType', e.target.value)}
        />
      </Field>

      <Field id="beta-notes" label={t('beta_form_field_notes')}>
        <textarea
          id="beta-notes"
          rows={3}
          className={`${inputClass} resize-y`}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      {serverError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-400">
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-7 py-3.5 font-bold text-white shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? t('beta_form_submitting') : t('beta_form_submit')}
      </button>
    </form>
  );
}
