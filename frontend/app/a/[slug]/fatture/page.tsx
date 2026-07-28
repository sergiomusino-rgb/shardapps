'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Plus, Search, FileText, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getTenantColors } from './tenantBranding';

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
  created_at: string;
  updated_at: string;
  totale?: number;
}

export default function FatturePage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [{ style: tenantStyle }] = useState(() => getTenantColors(slug));

  const [fatture, setFatture] = useState<Fattura[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getPassword = (): string | null => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(`app_session_${slug}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw).password || null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const loadFatture = async () => {
      setLoading(true);
      setError(null);

      const password = getPassword();
      if (!password) {
        setError('Password mancante. Effettua nuovamente il login.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/a/${slug}/invoices`, {
          headers: { Authorization: `Bearer ${password}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Errore ${res.status}`);
        }
        const data = await res.json();
        const fattureConTotali = await Promise.all(
          (data.fatture || []).map(async (fattura: Fattura) => {
            try {
              const righeRes = await fetch(`${BACKEND_URL}/api/invoices/${fattura.id}`, {
                headers: { Authorization: `Bearer ${password}` },
              });
              if (righeRes.ok) {
                const righeData = await righeRes.json();
                const righeList: Array<{ quantita: number; prezzo_unitario: number; aliquota_iva?: number }> = righeData.righe || [];
                const totale = righeList.reduce((sum, riga) => {
                  return sum + riga.quantita * riga.prezzo_unitario * (1 + (riga.aliquota_iva || 0) / 100);
                }, 0);
                return { ...fattura, totale };
              }
            } catch (err) {
              console.error(`Errore caricamento righe fattura ${fattura.id}:`, err);
            }
            return { ...fattura, totale: 0 };
          })
        );
        setFatture(fattureConTotali);
      } catch (err) {
        console.error('Errore caricamento fatture:', err);
        setError(err instanceof Error ? err.message : 'Errore nel caricamento delle fatture');
      } finally {
        setLoading(false);
      }
    };

    loadFatture();
  }, [slug]);

  const updateStato = async (fatturaId: string, nuovoStato: string) => {
    const password = getPassword();
    if (!password) {
      alert('Password mancante. Effettua nuovamente il login.');
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/invoices/${fatturaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` },
        body: JSON.stringify({ stato: nuovoStato }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Errore ${res.status}`);
      }
      const data = await res.json();
      setFatture((prev) => prev.map((f) => (f.id === fatturaId ? { ...f, stato: data.fattura.stato } : f)));
    } catch (err) {
      console.error('Errore aggiornamento stato:', err);
      alert(err instanceof Error ? err.message : 'Errore aggiornamento stato');
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('it-IT');
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount);

  const [filterStato, setFilterStato] = useState<string>('tutti');
  const [filterTipo, setFilterTipo] = useState<string>('tutti');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fattureFiltrate = fatture.filter((fattura) => {
    const matchStato = filterStato === 'tutti' || fattura.stato === filterStato;
    const matchTipo = filterTipo === 'tutti' || (fattura.tipo_documento || 'fattura') === filterTipo;
    const matchSearch =
      searchTerm === '' ||
      fattura.cliente_nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fattura.numero_fattura.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (fattura.cliente_piva && fattura.cliente_piva.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchStato && matchTipo && matchSearch;
  });

  const stats = {
    totale: fattureFiltrate.length,
    bozze: fattureFiltrate.filter((f) => f.stato === 'bozza').length,
    emesse: fattureFiltrate.filter((f) => f.stato === 'emessa').length,
    pagate: fattureFiltrate.filter((f) => f.stato === 'pagata').length,
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-tenant-bg" style={tenantStyle}>
        <div className="text-tenant-text-secondary">Caricamento documenti...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-tenant-bg" style={tenantStyle}>
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-tenant-danger">Errore</h2>
          <p className="text-tenant-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tenant-bg py-8" style={tenantStyle}>
      <div className="mx-auto max-w-7xl px-4">
        <button
          type="button"
          onClick={() => router.push(`/a/${slug}/dashboard`)}
          className="mb-4 flex items-center gap-1.5 text-sm text-tenant-text-secondary transition-colors hover:text-tenant-text"
        >
          <ArrowLeft size={15} /> Torna alla Dashboard
        </button>

        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="m-0 text-3xl font-bold text-tenant-text">Fatture e Ricevute</h1>
            <p className="mt-1 text-sm text-tenant-text-secondary">Gestisci i tuoi documenti e scarica i PDF</p>
          </div>
          <Button size="lg" onClick={() => router.push(`/a/${slug}/fatture/nuova`)}>
            <Plus size={18} /> Nuovo Documento
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-tenant-text">{stats.totale}</div><div className="text-sm text-tenant-text-secondary">Totale</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-tenant-text-secondary">{stats.bozze}</div><div className="text-sm text-tenant-text-secondary">Bozze</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-tenant-success">{stats.emesse}</div><div className="text-sm text-tenant-text-secondary">Emesse</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-tenant-primary">{stats.pagate}</div><div className="text-sm text-tenant-text-secondary">Pagate</div></CardContent></Card>
        </div>

        <Card className="mb-6">
          <CardContent className="flex flex-col items-start gap-4 p-4 md:flex-row md:items-center">
            <div className="w-full flex-1 md:w-auto">
              <label className="mb-1 block text-xs font-medium text-tenant-text-secondary">Cerca</label>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Cliente, numero, P.IVA..." className="pl-9" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tenant-text-secondary">Tipo</label>
              <select
                value={filterTipo}
                onChange={(e) => setFilterTipo(e.target.value)}
                className="h-10 rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3 text-sm text-tenant-text outline-none focus:border-tenant-primary"
              >
                <option value="tutti">Tutti</option>
                <option value="fattura">Fatture</option>
                <option value="ricevuta">Ricevute</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tenant-text-secondary">Stato</label>
              <select
                value={filterStato}
                onChange={(e) => setFilterStato(e.target.value)}
                className="h-10 rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3 text-sm text-tenant-text outline-none focus:border-tenant-primary"
              >
                <option value="tutti">Tutti</option>
                <option value="bozza">Bozza</option>
                <option value="emessa">Emessa</option>
                <option value="pagata">Pagata</option>
                <option value="annullata">Annullata</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-tenant-card-alt">
                  <th className="border-b border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Tipo</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Numero</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Data</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Cliente</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Stato</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Totale</th>
                  <th className="border-b border-tenant-border px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {fattureFiltrate.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-tenant-text-secondary">
                      <FileText size={28} className="mx-auto mb-2 opacity-50" />
                      Nessun documento trovato
                    </td>
                  </tr>
                ) : (
                  fattureFiltrate.map((fattura) => (
                    <tr key={fattura.id} className="border-b border-tenant-border transition-colors hover:bg-tenant-card-alt">
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={fattura.tipo_documento === 'ricevuta' ? 'primary' : 'outline'}>
                          {fattura.tipo_documento === 'ricevuta' ? 'Ricevuta' : 'Fattura'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-tenant-text">{fattura.numero_fattura}/{fattura.anno}</td>
                      <td className="px-4 py-3 text-sm text-tenant-text">{formatDate(fattura.data_emissione)}</td>
                      <td className="px-4 py-3 text-sm text-tenant-text">{fattura.cliente_nome}</td>
                      <td className="px-4 py-3 text-center">
                        <select
                          value={fattura.stato}
                          onChange={(e) => updateStato(fattura.id, e.target.value)}
                          className="rounded-lg border border-tenant-border bg-transparent px-2 py-1 text-xs font-medium text-tenant-text outline-none"
                        >
                          <option value="bozza">Bozza</option>
                          <option value="emessa">Emessa</option>
                          <option value="pagata">Pagata</option>
                          <option value="annullata">Annullata</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-tenant-text">
                        {fattura.totale ? formatCurrency(fattura.totale) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button variant="soft" size="sm" onClick={() => router.push(`/a/${slug}/fatture/${fattura.id}`)}>
                          Visualizza
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
