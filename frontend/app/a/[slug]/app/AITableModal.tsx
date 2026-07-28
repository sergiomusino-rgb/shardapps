'use client';

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface AITableModalProps {
  onGenerate: (instruction: string) => Promise<void>;
  onClose: () => void;
  generating: boolean;
  error: string | null;
  colors?: unknown;
}

export default function AITableModal({
  onGenerate, onClose, generating, error,
}: AITableModalProps) {
  const [instruction, setInstruction] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || generating) return;
    await onGenerate(instruction.trim());
  };

  return (
    <Dialog open onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="m-0 flex items-center gap-2 text-xl font-bold text-tenant-text">
          <Sparkles size={20} className="text-tenant-primary" />
          Crea Tabella con AI
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
        >
          <X size={20} />
        </button>
      </div>
      <p className="mb-5 mt-0 text-[13px] text-tenant-text-secondary">
        Descrivi la tabella che vuoi aggiungere, l&apos;AI genera nome, colonne e tipi di campo.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='Es. "Aggiungi la tabella Storico Interventi con campi data, descrizione, costo"'
          rows={4}
          autoFocus
        />

        {error && (
          <div className="rounded-lg bg-tenant-danger/15 px-3.5 py-2.5 text-[13px] text-tenant-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={generating || !instruction.trim()}>
            {generating ? 'Generazione...' : 'Genera Tabella'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
