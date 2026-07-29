'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import PreviewCard from '@/components/PreviewCard';
import { DEMO_APPS } from '@/lib/demoApps';

export default function ShowcasePage() {
  const { t } = useLanguage();

  return (
    <div className="p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          {t('back_to_dashboard')}
        </Link>

        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="text-2xl">🚀</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{t('dashboard_showcase_title')}</h1>
            <p className="text-slate-400 mt-1">{t('dashboard_showcase_subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Showcase Grid */}
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {DEMO_APPS.map((app) => (
            <PreviewCard
              key={app.slug}
              title={app.name}
              slug={app.slug}
              appType={app.appType}
              description={app.description}
            />
          ))}
        </div>

        {/* Branding Footer */}
        <div className="mt-12 text-center">
          <p className="text-xs text-slate-600">
            Powered by <span className="text-slate-500 font-semibold">ZeusX</span> — 
            AI-powered management software generation
          </p>
        </div>
      </div>
    </div>
  );
}