'use client';

import { useState } from 'react';
import { ImageOff, Loader2, Trash2, Upload } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

interface ImageFieldInputProps {
  value: string;
  onChange: (url: string) => void;
}

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Upload diretto dal browser nel bucket pubblico 'vision-uploads' (già usato
// da ZeusX Vision e dal logo aziendale di Comandi, stesso pattern: vedi
// handleLogoFile in components/comandi/ComandiInstanceDashboard.tsx),
// scoped per utente. Il campo tabella (type: 'image') salva solo l'URL
// risultante come stringa, coerente con renderCellValue in cellRenderers.tsx
// e con la logica di RecordCardGrid che legge il valore del campo image come
// URL diretto.
export default function ImageFieldInput({ value, onChange }: ImageFieldInputProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Formato non supportato: carica un\'immagine (PNG, JPEG, WEBP...).');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError('Immagine troppo grande: massimo 5MB.');
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) {
        setError('Sessione scaduta: ricarica la pagina.');
        return;
      }
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/record-image-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabaseBrowser.storage
        .from('vision-uploads')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabaseBrowser.storage.from('vision-uploads').getPublicUrl(path);
      onChange(publicUrlData.publicUrl);
    } catch (err) {
      console.error('[ImageFieldInput] Errore caricamento immagine:', err);
      setError('Caricamento fallito. Riprova.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-tenant-border bg-tenant-card-alt">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageOff size={20} className="text-tenant-text-secondary" />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-tenant-border bg-tenant-card px-3 py-1.5 text-[13px] font-semibold text-tenant-text transition-colors hover:border-tenant-primary">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Caricamento...' : value ? 'Sostituisci' : 'Carica immagine'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </label>

          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex w-fit items-center gap-1 text-[12px] text-tenant-text-secondary hover:text-tenant-danger"
            >
              <Trash2 size={12} /> Rimuovi
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-[12px] text-tenant-danger">{error}</p>}
    </div>
  );
}
