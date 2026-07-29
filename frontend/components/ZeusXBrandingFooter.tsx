// ─── ZeusX Branding Footer ───────────────────────────────────────────────────────
// Footer statico e branding per le app generate - "Powered by ZeusX"
// Questo componente DEVE essere incluso in ogni app generata

import Image from 'next/image';

export default function ZeusXBrandingFooter() {
  return (
    <footer className="w-full py-4 px-4 bg-slate-950/80 backdrop-blur-md border-t border-slate-800/50">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        {/* Logo ZeusX */}
        <div className="flex items-center gap-2">
          <Image
            src="/zeusxapps.jpeg"
            alt="ZeusX Logo"
            width={20}
            height={20}
            className="h-5 w-5 object-contain rounded"
            onError={(e) => {
              // Fallback se l'immagine non viene caricata
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          <span className="text-gray-500 text-xs font-medium">
            Powered by <span className="text-indigo-400">ZeusX</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
