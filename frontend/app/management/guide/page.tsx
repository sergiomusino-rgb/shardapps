'use client';

import { useState } from 'react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Rocket, BookOpen, Lightbulb, HelpCircle, FileText } from 'lucide-react';

// ============================================================================
// Guide Page Component
// ============================================================================

export default function ManagementGuidePage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('howto');

  const tabs = [
    { id: 'howto', label: t('management_guide_howto'), icon: <Rocket size={18} /> },
    { id: 'quick', label: t('management_guide_quick'), icon: <BookOpen size={18} /> },
    { id: 'commercial', label: t('management_guide_commercial'), icon: <Lightbulb size={18} /> },
    { id: 'faq', label: t('management_guide_faq'), icon: <HelpCircle size={18} /> },
    { id: 'legal', label: t('management_guide_legal'), icon: <FileText size={18} /> },
  ];

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-white">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('management_guide_title')}</h1>
        <p className="text-slate-400 mt-1">{t('management_guide_subtitle')}</p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* How It Works Tab */}
        {activeTab === 'howto' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('management_guide_howto_title')}</h2>
            <p className="text-slate-300 mb-6">{t('management_guide_howto_desc')}</p>

            <h3 className="text-md font-medium text-indigo-400 mt-4 mb-2">{t('management_guide_howto_what_title')}</h3>
            <p className="text-slate-300 mb-4">{t('management_guide_howto_what_desc')}</p>

            <h3 className="text-md font-medium text-indigo-400 mt-4 mb-2">{t('management_guide_howto_ai_title')}</h3>
            <p className="text-slate-300 mb-4">{t('management_guide_howto_ai_desc')}</p>

            <h3 className="text-md font-medium text-emerald-400 mt-4 mb-2">{t('management_guide_howto_steps_title')}</h3>
            <ol className="list-decimal list-inside text-slate-300 space-y-2 ml-4 mb-4">
              <li>{t('management_guide_howto_step1')}</li>
              <li>{t('management_guide_howto_step2')}</li>
              <li>{t('management_guide_howto_step3')}</li>
              <li>{t('management_guide_howto_step4')}</li>
              <li>{t('management_guide_howto_step5')}</li>
            </ol>

            <h3 className="text-md font-medium text-amber-400 mt-4 mb-2">{t('management_guide_howto_monitor_title')}</h3>
            <p className="text-slate-300">{t('management_guide_howto_monitor_desc')}</p>
          </div>
        )}

        {/* Quick Guide Tab */}
        {activeTab === 'quick' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('management_guide_quick_title')}</h2>
            <p className="text-slate-300 mb-4">{t('management_guide_quick_desc')}</p>
            
            <h3 className="text-md font-medium text-indigo-400 mt-4 mb-2">{t('management_guide_app_management')}</h3>
            <ul className="list-disc list-inside text-slate-300 space-y-2 ml-4">
              <li>{t('management_guide_app_mgmt_1')}</li>
              <li>{t('management_guide_app_mgmt_2')}</li>
              <li>{t('management_guide_app_mgmt_3')}</li>
            </ul>
          </div>
        )}

        {/* Commercial Tips Tab */}
        {activeTab === 'commercial' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('management_guide_commercial_title')}</h2>
            <p className="text-slate-300 mb-4">{t('management_guide_commercial_desc')}</p>
            
            <h3 className="text-md font-medium text-emerald-400 mt-4 mb-2">{t('management_guide_sales_process')}</h3>
            <ul className="list-disc list-inside text-slate-300 space-y-2 ml-4">
              <li>{t('management_guide_sales_1')}</li>
              <li>{t('management_guide_sales_2')}</li>
              <li>{t('management_guide_sales_3')}</li>
            </ul>
          </div>
        )}

        {/* FAQ Tab */}
        {activeTab === 'faq' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('management_guide_faq_title')}</h2>
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q1')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a1')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q2')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a2')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q3')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a3')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q4')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a4')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q5')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a5')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q6')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a6')}</p>
              </div>
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-md font-medium text-white">{t('management_faq_q7')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a7')}</p>
              </div>
              <div>
                <h3 className="text-md font-medium text-white">{t('management_faq_q8')}</h3>
                <p className="text-slate-300 mt-2">{t('management_faq_a8')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Legal Disclaimer Tab */}
        {activeTab === 'legal' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{t('management_guide_legal_title')}</h2>
            
            <h3 className="text-md font-medium text-amber-400 mt-4 mb-2">{t('management_legal_partnership')}</h3>
            <p className="text-slate-300 mb-3">{t('management_legal_partnership_desc')}</p>
            
            <h3 className="text-md font-medium text-amber-400 mt-4 mb-2">{t('management_legal_liability')}</h3>
            <p className="text-slate-300 mb-3">{t('management_legal_liability_desc')}</p>
            
            <h3 className="text-md font-medium text-amber-400 mt-4 mb-2">{t('management_legal_takeover')}</h3>
            <p className="text-slate-300 mb-3">{t('management_legal_takeover_desc')}</p>
            
            <h3 className="text-md font-medium text-amber-400 mt-4 mb-2">{t('management_legal_acceptance')}</h3>
            <p className="text-slate-300">{t('management_legal_acceptance_desc')}</p>
          </div>
        )}
      </div>
    </div>
  );
}