'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileText, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getTenantColors } from '../tenantBranding';
import { PDF_LAYOUTS, downloadInvoicePdf, type PdfLayoutMeta, type PdfInvoiceInput } from '../pdfTemplates';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Fattura {
  id: string;
  tenant_id: string;
  numero_fattura: string;
  anno: number;
  data_emissione: string;
  cliente_nome: string;
  cliente_piva?: string;
  cliente_indirizzo?: string;
  stato: string;
  tipo_documento?: 'fattura' | 'ricevuta';
  metodo_pagamento?: string;
}

interface RigaFattura {
  id: string;
  descrizione: string;
  quantita: number;
  prezzo_unitario: number;
  aliquota_iva: number;
}

interface DatiAzienda {
  ragioneSociale: string;
  piva?: string;
  indirizzo?: string;
  telefono?: string;
  logoUrl?: string;
}

const STATO_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  bozza: 'neutral',
  emessa: 'success',
  pagata: 'primary',
  annullata: 'danger',
};

export default function FatturaViewPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const fatturaId = params.id as string;

  const [{ colors: tenantColors, style: tenantStyle }] = useState(() => getTenantColors(slug));

  const [fattura, setFattura] = useState<Fattura | null>(null);
  const [righe, setRighe] = useState<RigaFattura[]>([]);
  const [azienda, setAzienda] = useState<DatiAzienda | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<PdfLayoutMeta['key']>('classico');

  const getSessionData = (): { appId: string; password: string } | null => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(`app_session_${slug}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return { appId: parsed.appInfo?.id, password: parsed.password };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const loadFattura = async () => {
      setLoading(true);
      setError(null);

      const session = getSessionData();
      if (!session?.password) {
        setError('Password mancante. Effettua nuovamente il login.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/invoices/${fatturaId}`, {
          headers: { Authorization: `Bearer ${session.password}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Errore ${res.status}`);
        }
        const data = await res.json();
        setFattura(data.fattura);
        setRighe(data.righe || []);
      } catch (err) {
        console.error('Errore caricamento fattura:', err);
        setError(err instanceof Error ? err.message : 'Errore nel caricamento della fattura');
        setLoading(false);
        return;
      }

      // Dati aziendali reali del tenant (mai più un nome fisso hardcoded):
      // stessa tabella dinamica "Dati Azienda" usata nel resto dell'app.
      if (session.appId) {
        try {
          const res = await fetch(`/api/client/apps/${session.appId}/records?table=dati_aziendali`, {
            headers: { Authorization: `Bearer ${session.password}` },
          });
          if (res.ok) {
            const data = await res.json();
            const recs: Array<{ data?: Record<string, string> } & Record<string, string>> = Array.isArray(data)
              ? data
              : data.records || data.data || [];
            const record = recs[0]?.data || recs[0];
            if (record) {
              setAzienda({
                ragioneSociale: record.ragione_sociale || 'La tua azienda',
                piva: record.partita_iva,
                indirizzo: record.indirizzo,
                telefono: record.telefono,
                logoUrl: record.logo,
              });
            }
          }
        } catch (err) {
          console.error('Errore caricamento dati azienda:', err);
        }
      }

      setLoading(false);
    };

    if (fatturaId) loadFattura();
  }, [slug, fatturaId]);

  const calcolaTotali = () => {
    let imponibile = 0;
    let totaleIva = 0;
    righe.forEach((riga) => {
      const totaleRiga = riga.quantita * riga.prezzo_unitario;
      imponibile += totaleRiga;
      totaleIva += totaleRiga * (riga.aliquota_iva / 100);
    });
    return { imponibile, totaleIva, totaleGenerale: imponibile + totaleIva };
  };

  const { imponibile, totaleIva, totaleGenerale } = calcolaTotali();

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('it-IT');
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount);

  const handleDownload = () => {
    if (!fattura) return;
    const input: PdfInvoiceInput = {
      tipoDocumento: fattura.tipo_documento === 'ricevuta' ? 'ricevuta' : 'fattura',
      numero: fattura.numero_fattura,
      anno: fattura.anno,
      dataEmissione: fattura.data_emissione,
      stato: fattura.stato,
      cliente: { nome: fattura.cliente_nome, piva: fattura.cliente_piva, indirizzo: fattura.cliente_indirizzo },
      righe: righe.map((r) => ({ descrizione: r.descrizione, quantita: r.quantita, prezzoUnitario: r.prezzo_unitario, aliquotaIva: r.aliquota_iva })),
      azienda: azienda || { ragioneSociale: 'La tua azienda' },
      primaryColorHex: tenantColors.primary,
    };
    downloadInvoicePdf(selectedLayout, input);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-tenant-bg" style={tenantStyle}>
        <div className="text-tenant-text-secondary">Caricamento documento...</div>
      </div>
    );
  }

  if (error || !fattura) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-tenant-bg" style={tenantStyle}>
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-tenant-danger">Errore</h2>
          <p className="text-sm text-tenant-text-secondary">{error || 'Documento non trovato'}</p>
        </div>
      </div>
    );
  }

  const isRicevuta = fattura.tipo_documento === 'ricevuta';

  return (
    <div className="min-h-screen bg-tenant-bg py-8" style={tenantStyle}>
      <div className="mx-auto max-w-3xl px-4">
        <button
          type="button"
          onClick={() => router.push(`/a/${slug}/fatture`)}
          className="mb-4 flex items-center gap-1.5 text-sm text-tenant-text-secondary transition-colors hover:text-tenant-text"
        >
          <ArrowLeft size={15} /> Torna ai documenti
        </button>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isRicevuta ? <Receipt size={26} className="text-tenant-primary" /> : <FileText size={26} className="text-tenant-primary" />}
            <div>
              <h1 className="m-0 text-2xl font-bold text-tenant-text">
                {isRicevuta ? 'Ricevuta' : 'Fattura'} {fattura.numero_fattura}/{fattura.anno}
              </h1>
              <p className="mt-0.5 text-sm text-tenant-text-secondary">{formatDate(fattura.data_emissione)}</p>
            </div>
          </div>
          <Badge variant={STATO_VARIANT[fattura.stato] || 'neutral'}>{fattura.stato.toUpperCase()}</Badge>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Cliente</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm text-tenant-text-secondary">
            <p className="m-0 font-medium text-tenant-text">{fattura.cliente_nome}</p>
            {fattura.cliente_piva && <p className="m-0 mt-1">P.IVA/CF: {fattura.cliente_piva}</p>}
            {fattura.cliente_indirizzo && <p className="m-0 mt-1">{fattura.cliente_indirizzo}</p>}
          </CardContent>
        </Card>

        <Card className="mb-6 overflow-hidden">
          <CardHeader><CardTitle>Righe</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-tenant-card-alt">
                    <th className="border-b border-tenant-border px-3 py-2 text-left text-xs font-semibold uppercase text-tenant-text-secondary">Descrizione</th>
                    <th className="border-b border-tenant-border px-3 py-2 text-right text-xs font-semibold uppercase text-tenant-text-secondary">Qtà</th>
                    <th className="border-b border-tenant-border px-3 py-2 text-right text-xs font-semibold uppercase text-tenant-text-secondary">Prezzo</th>
                    <th className="border-b border-tenant-border px-3 py-2 text-right text-xs font-semibold uppercase text-tenant-text-secondary">IVA</th>
                    <th className="border-b border-tenant-border px-3 py-2 text-right text-xs font-semibold uppercase text-tenant-text-secondary">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((riga) => (
                    <tr key={riga.id} className="border-b border-tenant-border">
                      <td className="px-3 py-2 text-tenant-text">{riga.descrizione}</td>
                      <td className="px-3 py-2 text-right text-tenant-text">{riga.quantita}</td>
                      <td className="px-3 py-2 text-right text-tenant-text">{formatCurrency(riga.prezzo_unitario)}</td>
                      <td className="px-3 py-2 text-right text-tenant-text">{riga.aliquota_iva}%</td>
                      <td className="px-3 py-2 text-right font-medium text-tenant-text">{formatCurrency(riga.quantita * riga.prezzo_unitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <div className="w-64 text-sm">
                <div className="flex justify-between py-1 text-tenant-text-secondary"><span>Imponibile</span><span>{formatCurrency(imponibile)}</span></div>
                <div className="flex justify-between py-1 text-tenant-text-secondary"><span>IVA</span><span>{formatCurrency(totaleIva)}</span></div>
                <div className="flex justify-between border-t border-tenant-border pt-2 text-base font-bold text-tenant-text"><span>Totale</span><span>{formatCurrency(totaleGenerale)}</span></div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Scarica PDF</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PDF_LAYOUTS.map((layout) => (
                <button
                  key={layout.key}
                  type="button"
                  onClick={() => setSelectedLayout(layout.key)}
                  className={cn(
                    'rounded-xl border-2 p-4 text-left transition-all',
                    selectedLayout === layout.key ? 'border-tenant-primary bg-tenant-primary/10' : 'border-tenant-border'
                  )}
                >
                  <div className="text-sm font-semibold text-tenant-text">{layout.label}</div>
                  <div className="mt-1 text-xs text-tenant-text-secondary">{layout.description}</div>
                </button>
              ))}
            </div>
            <Button size="lg" onClick={handleDownload} className="w-full">
              <Download size={18} /> Scarica PDF — {PDF_LAYOUTS.find((l) => l.key === selectedLayout)?.label}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
