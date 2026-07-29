'use client';

import { useState } from 'react';
import { ExternalLink, Smartphone, Monitor, Loader2 } from 'lucide-react';

interface PreviewCardProps {
  title: string;
  slug: string;
  description?: string;
  appType?: string;
}

/**
 * PreviewCard — Card elegante per l'App Showcase nella dashboard.
 * Mostra un'anteprima dell'app generata e apre la demo in una nuova scheda.
 */
export default function PreviewCard({ title, slug, description, appType }: PreviewCardProps) {
  const [imageError, setImageError] = useState(false);
  const [loading] = useState(false);

  // Genera un colore univoco basato sullo slug per l'icona
  const iconColors = [
    'from-indigo-500 to-purple-600',
    'from-emerald-500 to-teal-600',
    'from-cyan-500 to-blue-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
    'from-violet-500 to-indigo-600',
  ];
  const colorIndex = slug.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % iconColors.length;
  const gradientColor = iconColors[colorIndex];

  return (
    <a
      href={`/a/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group block"
    >
      <div
        className="
          h-full rounded-2xl border border-slate-800 bg-slate-900/80
          transition-all duration-300 hover:scale-[1.02]
          hover:border-slate-600 hover:shadow-xl hover:shadow-indigo-500/10
          flex flex-col overflow-hidden
        "
      >
        {/* Mockup / Preview Area */}
        <div className="relative h-44 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center overflow-hidden">
          {/* Device mockup frame */}
          {!imageError ? (
            <div className="relative w-4/5 h-28 rounded-lg border border-slate-700/50 bg-slate-800/60 shadow-lg overflow-hidden backdrop-blur-sm group-hover:border-indigo-500/30 transition-colors duration-300">
              {/* Browser bar */}
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700/50 bg-slate-800/80">
                <div className="w-2 h-2 rounded-full bg-red-500/70" />
                <div className="w-2 h-2 rounded-full bg-amber-500/70" />
                <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
                <div className="ml-3 flex-1 h-3 rounded-full bg-slate-700/60 px-2 flex items-center">
                  <span className="text-[8px] text-slate-500 truncate">Powered by ZeusX</span>
                </div>
              </div>
              {/* Mock content */}
              <div className="p-3 space-y-2">
                <div className="h-2 w-3/5 rounded bg-slate-700/40" />
                <div className="h-2 w-4/5 rounded bg-slate-700/30" />
                <div className="h-2 w-2/5 rounded bg-slate-700/20" />
              </div>
            </div>
          ) : (
            <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${gradientColor} flex items-center justify-center shadow-lg`}>
              <Smartphone className="w-10 h-10 text-white/90" />
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent" />

          {/* App type badge */}
          {appType && (
            <span className="absolute top-3 left-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">
              {appType}
            </span>
          )}

          {/* Icon overlay bottom */}
          <div className={`absolute -bottom-6 right-3 w-12 h-12 rounded-xl bg-gradient-to-br ${gradientColor} flex items-center justify-center shadow-lg shadow-black/40 group-hover:scale-110 transition-transform duration-300`}>
            <Monitor className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Content Area */}
        <div className="p-5 flex-1 flex flex-col">
          <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors duration-200 line-clamp-1">
            {title}
          </h3>

          {description && (
            <p className="mt-1.5 text-sm text-slate-400 line-clamp-2 flex-1">
              {description}
            </p>
          )}

          {/* Call to action */}
          <div className="mt-4 flex items-center gap-2 text-indigo-400 font-semibold text-sm group-hover:text-indigo-300 transition-colors">
            <span>Guarda la App</span>
            <ExternalLink size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>

          {/* Branding footer */}
          <div className="mt-3 pt-3 border-t border-slate-800/50">
            <span className="text-[10px] font-medium text-slate-600 tracking-wider">
              Powered by <span className="text-slate-500">ZeusX</span>
            </span>
          </div>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center rounded-2xl">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        )}
      </div>
    </a>
  );
}