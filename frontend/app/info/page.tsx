'use client';

import Link from 'next/link';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';
import { useEffect } from 'react';

export default function InfoPage() {
  const { t } = useLanguage();

  useEffect(() => {
    // Forza lo sfondo scuro sul body per evitare il contrasto visivo
    document.body.style.backgroundColor = '#020617';
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  const plans = [
    {
      name: t('info_plan_starter'),
      setup: '€4,99',
      monthly: '25€/mese per app',
      slots: 1,
      features: [
        t('info_feature_starter_1'),
        t('info_feature_starter_2'),
        t('info_feature_starter_3'),
        t('info_feature_starter_4'),
        t('info_feature_starter_5'),
      ],
    },
    {
      name: t('info_plan_pro'),
      setup: '€50',
      monthly: '25€/mese per app',
      slots: 5,
      features: [
        t('info_feature_pro_1'),
        t('info_feature_pro_2'),
        t('info_feature_pro_3'),
        t('info_feature_pro_4'),
        t('info_feature_pro_5'),
      ],
    },
    {
      name: t('info_plan_business'),
      setup: '€250',
      monthly: '25€/mese per app',
      slots: 100,
      features: [
        t('info_feature_business_1'),
        t('info_feature_business_2'),
        t('info_feature_business_3'),
        t('info_feature_business_4'),
        t('info_feature_business_5'),
        t('info_feature_business_6'),
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* HEADER */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
        <Link href="/" className="text-sm font-medium text-slate-400 transition-colors hover:text-white">
          {t('info_back_to_home')}
        </Link>
        <Link href="/" className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-2xl font-black tracking-wider text-transparent">
          ⚡ ZEUSX
        </Link>
        <LanguageSelector />
      </header>

      <div className="max-w-4xl mx-auto px-6 pt-20 pb-20">
        {/* Header bar fissato in alto */}

         {/* Prezzi */}
         <h1 className="text-4xl md:text-5xl font-black mb-4">{t('info_title')}</h1>
         <p className="text-slate-400 mb-12 text-lg">
           {t('info_subtitle')}
         </p>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="p-6 rounded-2xl border border-slate-800 bg-slate-900/50"
            >
              <h2 className="text-2xl font-black mb-4">{plan.name}</h2>

              <div className="mb-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.setup}</span>
                  <span className="text-slate-400 text-sm">setup</span>
                </div>
                <div className="text-sm text-slate-400 mt-1">+ {plan.monthly}</div>
              </div>

               <div className="mb-4 px-3 py-2 bg-slate-800/50 rounded-lg">
                 <span className="text-sm font-semibold">{plan.slots} {t('info_slots')}</span>
               </div>

              <ul className="space-y-2">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

         {/* Come funziona il billing */}
         <div className="mb-16 p-8 bg-slate-900 rounded-2xl border border-slate-800">
           <h3 className="text-2xl font-bold mb-6">{t('info_billing_title')}</h3>
           <div className="grid md:grid-cols-3 gap-6 text-sm text-slate-400">
             <div>
               <div className="font-semibold text-white mb-2 text-base">{t('info_billing_step1_title')}</div>
               <p>{t('info_billing_step1_desc')}</p>
             </div>
             <div>
               <div className="font-semibold text-white mb-2 text-base">{t('info_billing_step2_title')}</div>
               <p>{t('info_billing_step2_desc')}</p>
             </div>
             <div>
               <div className="font-semibold text-white mb-2 text-base">{t('info_billing_step3_title')}</div>
               <p>{t('info_billing_step3_desc')}</p>
             </div>
           </div>
         </div>

         {/* Termini e condizioni */}
         <h2 className="text-3xl font-black mb-6">{t('info_terms_title')}</h2>

        <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section1_title')}</h3>
             <p>
               {t('info_terms_section1_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section2_title')}</h3>
             <p>
               {t('info_terms_section2_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section3_title')}</h3>
             <p>
               {t('info_terms_section3_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section4_title')}</h3>
             <p>
               {t('info_terms_section4_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section5_title')}</h3>
             <p>
               {t('info_terms_section5_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section6_title')}</h3>
             <p>
               {t('info_terms_section6_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section7_title')}</h3>
             <p>
               {t('info_terms_section7_desc')}
             </p>
           </section>

           <section className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
             <h3 className="text-lg font-bold text-white mb-3">{t('info_terms_section8_title')}</h3>
             <p>
               {t('info_terms_section8_desc')}
             </p>
           </section>
        </div>

      </div>
    </div>
  );
}
