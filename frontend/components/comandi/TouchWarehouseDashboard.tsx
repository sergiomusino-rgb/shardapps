'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowLeftRight,
  Camera,
  ClipboardList,
  PackagePlus,
  PackageSearch,
  RotateCcw,
  ScanLine,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import VoiceInputWidget from './VoiceInputWidget';
import type { VoiceOrderExtraction } from '@/types/comandi';

export type WarehouseMode = 'CARICO' | 'PRELIEVO' | 'INVENTARIO' | 'SPOSTA';

export interface TouchWarehouseDashboardProps {
  /** Nome della postazione mostrato in header (es. "Postazione 1", "Palmare A12"). */
  stationName?: string;
  /** Inoltrato al VoiceInputWidget interno: riceve il JSON estratto dall'ordine vocale. */
  onOrderParsed?: (data: VoiceOrderExtraction) => void;
  /**
   * Riceve il codice risolto da scansione fotocamera o inserimento manuale.
   * La decodifica reale del barcode/QR non è cablata qui (nessuna libreria
   * di decoding installata nel progetto): questo componente predispone
   * l'accesso alla fotocamera e l'anteprima video, pronti per essere
   * collegati a un decoder (es. zxing) senza modificare l'interfaccia.
   */
  onBarcodeScanned?: (code: string) => void;
  /** Notifica il cambio di modalità operativa selezionata dall'operatore. */
  onModeSelected?: (mode: WarehouseMode | null) => void;
  className?: string;
}

interface ModeConfig {
  key: WarehouseMode;
  label: string;
  icon: LucideIcon;
  activeClasses: string;
  ringClass: string;
}

const MODES: ModeConfig[] = [
  { key: 'CARICO', label: 'CARICO', icon: PackagePlus, activeClasses: 'bg-green-600 hover:bg-green-500', ringClass: 'ring-green-300' },
  { key: 'PRELIEVO', label: 'PRELIEVO', icon: PackageSearch, activeClasses: 'bg-orange-600 hover:bg-orange-500', ringClass: 'ring-orange-300' },
  { key: 'INVENTARIO', label: 'INVENTARIO', icon: ClipboardList, activeClasses: 'bg-blue-600 hover:bg-blue-500', ringClass: 'ring-blue-300' },
  { key: 'SPOSTA', label: 'SPOSTA', icon: ArrowLeftRight, activeClasses: 'bg-purple-600 hover:bg-purple-500', ringClass: 'ring-purple-300' },
];

const MODE_LABELS: Record<WarehouseMode, string> = {
  CARICO: 'Carico merce',
  PRELIEVO: 'Prelievo / Picking',
  INVENTARIO: 'Inventario',
  SPOSTA: 'Spostamento',
};

export default function TouchWarehouseDashboard({
  stationName = 'Postazione Magazzino',
  onOrderParsed,
  onBarcodeScanned,
  onModeSelected,
  className = '',
}: TouchWarehouseDashboardProps) {
  const [selectedMode, setSelectedMode] = useState<WarehouseMode | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isCameraSupported, setIsCameraSupported] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine);
    setIsCameraSupported(!!navigator.mediaDevices?.getUserMedia);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const stopScanning = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }, []);

  useEffect(() => stopScanning, [stopScanning]);

  const startScanning = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsScanning(true);
    } catch (err) {
      console.error('[TouchWarehouseDashboard] getUserMedia (video) error:', err);
      setCameraError('Permesso fotocamera negato o non disponibile su questo dispositivo.');
    }
  }, []);

  const handleSelectMode = (mode: WarehouseMode) => {
    const next = selectedMode === mode ? null : mode;
    setSelectedMode(next);
    onModeSelected?.(next);
  };

  const handleResetMode = () => {
    setSelectedMode(null);
    onModeSelected?.(null);
    setCameraError(null);
    setManualCode('');
    stopScanning();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    onBarcodeScanned?.(code);
    setManualCode('');
    stopScanning();
  };

  return (
    <div className={`w-full flex flex-col gap-4 bg-gray-900 rounded-2xl p-4 ${className}`}>
      {/* Header: stato postazione + scanner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Terminale Comandi</p>
          <h2 className="text-xl font-bold text-white">{stationName}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              isOnline
                ? 'bg-green-500/15 text-green-400 border-green-700/50'
                : 'bg-red-500/15 text-red-400 border-red-700/50'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isOnline ? 'Postazione online' : 'Postazione offline'}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              isCameraSupported
                ? 'bg-blue-500/15 text-blue-400 border-blue-700/50'
                : 'bg-gray-700/40 text-gray-400 border-gray-700'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            {isCameraSupported ? 'Scanner pronto' : 'Scanner non disponibile'}
          </span>
        </div>
      </div>

      {/* Card touch operazioni */}
      <div className="grid grid-cols-2 gap-4">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = selectedMode === mode.key;
          return (
            <button
              key={mode.key}
              type="button"
              onClick={() => handleSelectMode(mode.key)}
              aria-pressed={isActive}
              className={`flex flex-col items-center justify-center gap-2 min-h-[128px] rounded-2xl p-6 text-white font-extrabold text-lg tracking-wide transition-transform active:scale-95 ${mode.activeClasses} ${
                isActive ? `ring-4 ring-offset-2 ring-offset-gray-900 ${mode.ringClass}` : ''
              }`}
            >
              <Icon className="w-10 h-10" strokeWidth={2.25} />
              {mode.label}
            </button>
          );
        })}
      </div>

      {/* Motore vocale in evidenza, sempre raggiungibile senza uscire dalla vista */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">
          {selectedMode ? `Comando vocale — ${MODE_LABELS[selectedMode]}` : 'Comando vocale'}
        </p>
        <VoiceInputWidget onOrderParsed={(data) => onOrderParsed?.(data)} />
      </div>

      {/* Anteprima fotocamera per scan barcode/QR */}
      {isScanning && (
        <div className="rounded-xl border border-gray-700 bg-black overflow-hidden relative">
          <video ref={videoRef} className="w-full max-h-64 object-cover" muted playsInline />
          <div className="absolute inset-0 pointer-events-none border-4 border-blue-500/40 m-8 rounded-xl" />
          <button
            type="button"
            onClick={stopScanning}
            className="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
            aria-label="Chiudi fotocamera"
          >
            <X className="w-4 h-4" />
          </button>
          <form onSubmit={handleManualSubmit} className="absolute bottom-0 inset-x-0 bg-black/70 p-2 flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Inserisci codice manualmente…"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            >
              Conferma
            </button>
          </form>
        </div>
      )}

      {cameraError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{cameraError}</span>
          <button
            type="button"
            onClick={() => setCameraError(null)}
            className="shrink-0 text-red-300/70 hover:text-red-200"
            aria-label="Chiudi errore"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Footer: scan rapido + reset modalità */}
      <div className="flex flex-wrap gap-3 border-t border-gray-800 pt-3">
        <button
          type="button"
          onClick={isScanning ? stopScanning : startScanning}
          disabled={!isCameraSupported}
          className={`flex-1 min-h-[64px] flex items-center justify-center gap-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isScanning ? 'bg-gray-700 hover:bg-gray-600' : 'bg-sky-600 hover:bg-sky-500'
          }`}
        >
          <Camera className="w-5 h-5" />
          {isScanning ? 'Chiudi scanner' : 'Scansiona Codice'}
        </button>
        <button
          type="button"
          onClick={handleResetMode}
          className="flex-1 min-h-[64px] flex items-center justify-center gap-2 rounded-xl font-semibold text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
        >
          <RotateCcw className="w-5 h-5" />
          Reset modalità
        </button>
      </div>
    </div>
  );
}
