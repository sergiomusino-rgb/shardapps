'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowLeft, Receipt, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getTenantColors } from '../tenantBranding';

interface RigaFattura {
  id: string;
  descrizione: string;
  quantita: number;
  prezzo_unitario: number;
  aliquota_iva: number;
}

type TipoDocumento = 'fattura' | 'ricevuta';

export default function NuovaFatturaPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;

  const [{ style: tenantStyle }] = useState(() => getTenantColors(slug));

  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('fattura');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clienteNome, setClienteNome] = useState('');
  const [clientePiva, setClientePiva] = useState('');
  const [clienteIndirizzo, setClienteIndirizzo] = useState('');
  const [metodoPagamento, setMetodoPagamento] = useState('');

  const [righe, setRighe] = useState<RigaFattura[]>([
    { id: '1', descrizione: '', quantita: 1, prezzo_unitario: 0, aliquota_iva: 22 },
  ]);

  const getSessionData = (): { tenantId: string; password: string } | null => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(`app_session_${slug}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return { tenantId: parsed.appInfo?.id || parsed.appInfo?.tenant_id, password: parsed.password };
    } catch {
      return null;
    }
  };

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

  const aggiungiRiga = () => {
    setRighe([...righe, { id: Date.now().toString(), descrizione: '', quantita: 1, prezzo_unitario: 0, aliquota_iva: 22 }]);
  };

  const rimuoviRiga = (id: string) => {
    if (righe.length === 1) {
      setError('Deve essere presente almeno una riga');
      return;
    }
    setRighe(righe.filter((r) => r.id !== id));
    setError(null);
  };

  const aggiornaRiga = (id: string, campo: keyof RigaFattura, valore: string | number) => {
    setRighe(righe.map((r) => (r.id !== id ? r : { ...r, [campo]: valore })));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!clienteNome.trim()) {
      setError('Il nome del cliente è obbligatorio');
      return;
    }
    if (tipoDocumento === 'fattura' && !clientePiva.trim()) {
      setError('La P.IVA/Codice Fiscale è obbligatoria per una fattura (non per una ricevuta)');
      return;
    }

    const righeValide = righe.filter((r) => r.descrizione.trim() && r.quantita > 0 && r.prezzo_unitario > 0);
    if (righeValide.length === 0) {
      setError('Inserire almeno una riga valida');
      return;
    }

    const sessionData = getSessionData();
    if (!sessionData) {
      setError('Sessione scaduta. Effettua nuovamente il login.');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenant_id: sessionData.tenantId,
        tipo_documento: tipoDocumento,
        anno: new Date().getFullYear(),
        data_emissione: new Date().toISOString().split('T')[0],
        cliente_nome: clienteNome,
        cliente_piva: clientePiva || null,
        cliente_indirizzo: clienteIndirizzo || null,
        stato: 'bozza',
        metodo_pagamento: metodoPagamento || null,
        righe: righeValide.map((r) => ({
          descrizione: r.descrizione,
          quantita: r.quantita,
          prezzo_unitario: r.prezzo_unitario,
          aliquota_iva: r.aliquota_iva,
        })),
      };

      const res = await fetch(`/a/${slug}/api/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.password}` },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Errore ${res.status}`);
      }

      const data = await res.json();
      router.push(`/a/${slug}/fatture/${data.fattura.id}`);
    } catch (err) {
      console.error('Errore creazione documento:', err);
      setError(err instanceof Error ? err.message : 'Errore nella creazione del documento');
      setSaving(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount);

  return (
    <div className="min-h-screen bg-tenant-bg py-8" style={tenantStyle}>
      <div className="mx-auto max-w-4xl px-4">
        <button
          type="button"
          onClick={() => router.push(`/a/${slug}/fatture`)}
          className="mb-4 flex items-center gap-1.5 text-sm text-tenant-text-secondary transition-colors hover:text-tenant-text"
        >
          <ArrowLeft size={15} /> Torna ai documenti
        </button>

        <div className="mb-8">
          <h1 className="m-0 text-3xl font-bold text-tenant-text">Nuovo Documento</h1>
          <p className="mt-1 text-sm text-tenant-text-secondary">Scegli il tipo, compila i dati e le righe</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-6 rounded-lg border border-tenant-danger/20 bg-tenant-danger/10 p-4 text-sm text-tenant-danger">
              {error}
            </div>
          )}

          {/* Tipo Documento */}
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTipoDocumento('fattura')}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
                    tipoDocumento === 'fattura' ? 'border-tenant-primary bg-tenant-primary/10' : 'border-tenant-border'
                  )}
                >
                  <FileText size={22} className="text-tenant-primary" />
                  <div>
                    <div className="text-sm font-semibold text-tenant-text">Fattura</div>
                    <div className="text-xs text-tenant-text-secondary">Richiede P.IVA/CF del cliente</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTipoDocumento('ricevuta')}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
                    tipoDocumento === 'ricevuta' ? 'border-tenant-primary bg-tenant-primary/10' : 'border-tenant-border'
                  )}
                >
                  <Receipt size={22} className="text-tenant-primary" />
                  <div>
                    <div className="text-sm font-semibold text-tenant-text">Ricevuta</div>
                    <div className="text-xs text-tenant-text-secondary">P.IVA/CF opzionale</div>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Dati Cliente */}
          <Card className="mb-6">
            <CardHeader><CardTitle>Dati Cliente</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 pt-0 md:grid-cols-2">
              <div>
                <Label>Nome Cliente *</Label>
                <Input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Mario Rossi" required />
              </div>
              <div>
                <Label>Partita IVA / Codice Fiscale{tipoDocumento === 'fattura' && ' *'}</Label>
                <Input value={clientePiva} onChange={(e) => setClientePiva(e.target.value)} placeholder="IT12345678901" />
              </div>
              <div className="md:col-span-2">
                <Label>Indirizzo</Label>
                <Input value={clienteIndirizzo} onChange={(e) => setClienteIndirizzo(e.target.value)} placeholder="Via Roma 123, 00100 Roma (RM)" />
              </div>
              <div>
                <Label>Metodo di Pagamento</Label>
                <select
                  value={metodoPagamento}
                  onChange={(e) => setMetodoPagamento(e.target.value)}
                  className="h-10 w-full rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3.5 text-sm text-tenant-text outline-none focus:border-tenant-primary"
                >
                  <option value="">Seleziona...</option>
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">Carta di Credito</option>
                  <option value="contanti">Contanti</option>
                  <option value="assegno">Assegno</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Righe */}
          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Righe {tipoDocumento === 'ricevuta' ? 'Ricevuta' : 'Fattura'}</CardTitle>
              <Button type="button" variant="soft" size="sm" onClick={aggiungiRiga}>
                <Plus size={14} /> Aggiungi Riga
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {righe.map((riga) => (
                <div key={riga.id} className="grid grid-cols-12 items-end gap-3 rounded-xl bg-tenant-card-alt p-4">
                  <div className="col-span-12 md:col-span-5">
                    <Label className="text-xs">Descrizione</Label>
                    <Input value={riga.descrizione} onChange={(e) => aggiornaRiga(riga.id, 'descrizione', e.target.value)} placeholder="Descrizione prodotto/servizio" />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <Label className="text-xs">Quantità</Label>
                    <Input type="number" min="0" step="0.01" value={riga.quantita} onChange={(e) => aggiornaRiga(riga.id, 'quantita', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <Label className="text-xs">Prezzo Unitario</Label>
                    <Input type="number" min="0" step="0.01" value={riga.prezzo_unitario} onChange={(e) => aggiornaRiga(riga.id, 'prezzo_unitario', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <Label className="text-xs">IVA %</Label>
                    <Input type="number" min="0" max="100" value={riga.aliquota_iva} onChange={(e) => aggiornaRiga(riga.id, 'aliquota_iva', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-6 md:col-span-1">
                    <Button type="button" variant="destructive" size="icon" className="w-full" onClick={() => rimuoviRiga(riga.id)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Totali */}
          <Card className="mb-6">
            <CardHeader><CardTitle>Riepilogo Totali</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 pt-0">
              <div className="flex justify-between text-sm text-tenant-text-secondary">
                <span>Imponibile:</span><span className="font-medium">{formatCurrency(imponibile)}</span>
              </div>
              <div className="flex justify-between text-sm text-tenant-text-secondary">
                <span>IVA:</span><span className="font-medium">{formatCurrency(totaleIva)}</span>
              </div>
              <div className="flex justify-between border-t border-tenant-border pt-2 text-lg font-bold text-tenant-text">
                <span>TOTALE:</span><span>{formatCurrency(totaleGenerale)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Annulla</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Salvataggio...' : `Salva ${tipoDocumento === 'ricevuta' ? 'Ricevuta' : 'Fattura'}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
