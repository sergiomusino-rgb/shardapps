'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import LanguageSelector from '@/components/LanguageSelector';
import HeaderClock from '@/components/HeaderClock';
import FullscreenToggle from '@/components/FullscreenToggle';
import Sidebar from '@/components/layout/Sidebar';
import { Menu, X } from 'lucide-react';

const supabase = supabaseBrowser;

export default function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [isReseller, setIsReseller] = useState(false);
  const [userPlan, setUserPlan] = useState<string>('free');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useLanguage();

  // Check if we're on the guide page (publicly accessible)
  const isGuidePage = pathname?.startsWith('/management/guide');

  useEffect(() => {
    checkResellerAccess();
  }, [pathname]);

  const checkResellerAccess = async () => {
    setLoading(true);
    
    // Allow access to guide page without authentication
    if (isGuidePage) {
      setIsReseller(true);
      setLoading(false);
      return;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) {
      router.push('/login');
      return;
    }

    // Get user profile with role and plan
    // Cast mirato: frontend/types/database.ts non copre role/subscription_plan
    // su profiles, quindi il client tipizzato risolverebbe qui a `never`
    // come altrove nel progetto (vedi audit tsc).
    const { data: profileRaw } = await supabase
      .from('profiles' as any)
      .select('role, subscription_plan')
      .eq('user_id', session.user.id)
      .single();
    const profile = profileRaw as { role?: string; subscription_plan?: string } | null;

    if (!profile) {
      router.push('/login');
      return;
    }

    // Check if user is reseller
    if (profile.role !== 'reseller') {
      router.push('/dashboard');
      return;
    }

    // Check if user has pro or business plan
    const plan = profile.subscription_plan || 'free';
    if (plan !== 'pro' && plan !== 'business') {
      router.push('/pricing');
      return;
    }

    setIsReseller(true);
    setUserPlan(plan);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-slate-400">{t('admin_loading')}</p>
        </div>
      </div>
    );
  }

  if (!isReseller) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center p-6 bg-red-900/20 rounded-lg border border-red-800">
          <p className="text-red-400 font-medium">{t('access_denied')}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            {t('back_to_dashboard')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      {/* Desktop Sidebar (always visible on md+) */}
      <div className="hidden md:block">
        <Sidebar
          showTableNavigation={false}
          onBackToDashboard={() => router.push('/dashboard')}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      <div className="md:hidden">
        {/* Backdrop */}
        <div
          className={`fixed inset-0 z-40 transition-all duration-300 ease-in-out ${
            mobileMenuOpen
              ? 'bg-black/60 backdrop-blur-sm opacity-100 pointer-events-auto'
              : 'bg-transparent opacity-0 pointer-events-none'
          }`}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />

        {/* Slide-out Sidebar Panel */}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar
            showTableNavigation={false}
            onBackToDashboard={() => router.push('/dashboard')}
            onClose={() => setMobileMenuOpen(false)}
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header (visible only on small screens) */}
        <header className="relative z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 md:hidden">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label={t('header_open_menu')}
          >
            <Menu size={22} />
          </button>
          <Link
            href="/dashboard"
            className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-lg font-black tracking-wider text-transparent"
          >
            ⚡ ZEUSX
          </Link>
          <LanguageSelector />
        </header>

        {/* Desktop Header (hidden on mobile) */}
        <header className="relative z-30 hidden h-16 items-center justify-between border-b border-slate-800 bg-slate-900/40 px-6 backdrop-blur md:flex">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
            >
              ← {t('header_back_to_dashboard')}
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <HeaderClock textColor="#e2e8f0" mutedColor="#64748b" />
            <LanguageSelector />
            <FullscreenToggle color="#e2e8f0" hoverBackground="rgba(148,163,184,0.15)" />
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto bg-slate-950 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}