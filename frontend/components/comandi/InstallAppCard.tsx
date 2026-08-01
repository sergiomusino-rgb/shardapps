'use client';

import { Download, Share, SquarePlus } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useLanguage } from '@/src/lib/LanguageContext';

interface InstallAppCardProps {
  appName: string;
}

// Card fissa "Installa l'app" per la scheda Azienda: a differenza del
// banner flottante (InstallAppBanner, dismissabile e temporaneo), questa
// resta sempre visibile sotto il QR di condivisione — un punto di
// riferimento stabile per chi vuole installare l'app sul telefono in un
// secondo momento, anche se ha già chiuso il banner iniziale.
export default function InstallAppCard({ appName }: InstallAppCardProps) {
  const { t } = useLanguage();
  const { canInstall, isIos, isStandalone, promptInstall } = useInstallPrompt();

  // Già installata (aperta come standalone): la card non ha più senso qui.
  if (isStandalone) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        <Download className="w-3.5 h-3.5" />
        {t('comandi_dashboard_install_card_title').replace('{appName}', appName)}
      </p>
      {isIos ? (
        <p className="flex items-center gap-1 flex-wrap text-sm text-gray-400">
          {t('comandi_dashboard_install_card_ios_instructions')}
          <Share className="w-3.5 h-3.5 inline" />
          <SquarePlus className="w-3.5 h-3.5 inline" />
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">{t('comandi_dashboard_install_card_subtitle')}</p>
          <button
            type="button"
            onClick={promptInstall}
            disabled={!canInstall}
            className="self-start flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('comandi_dashboard_install_card_button')}
          </button>
          {!canInstall && (
            <p className="text-xs text-gray-600">{t('comandi_dashboard_install_card_fallback_hint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
