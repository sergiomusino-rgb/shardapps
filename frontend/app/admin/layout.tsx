'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import Sidebar from '@/components/layout/Sidebar';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Menu } from 'lucide-react';

const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const checkAdminAccess = async () => {
    setLoading(true);
    
    // Prima ottieni l'utente
    const { data: { user } } = await supabaseBrowser.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // Check hardcoded admin FIRST - skip profile query if matches
    if (user.id === ADMIN_USER_ID) {
      setIsAdmin(true);
      setLoading(false);
      return;
    }

    // Only check profile for non-admin users
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    
    if (!session?.user) {
      router.push('/login');
      return;
    }

    // Cast mirato: frontend/types/database.ts non è lo schema Database
    // generato da Supabase (manca la colonna 'role' su profiles), quindi il
    // client tipizzato risolverebbe qui a `never` come altrove nel progetto.
    const { data: profile } = await supabaseBrowser
      .from('profiles' as any)
      .select('role')
      .eq('user_id', session.user.id)
      .single();

    if ((profile as { role?: string } | null)?.role === 'admin') {
      setIsAdmin(true);
    } else {
      router.push('/dashboard');
    }
    
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-400">{t('admin_loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
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
        <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 md:hidden">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label={t('header_open_menu')}
          >
            <Menu size={22} />
          </button>
          <Link
            href="/dashboard"
            className="text-lg font-black tracking-tight text-white"
          >
            SHARD<span className="text-indigo-400">APPS</span>
          </Link>
          <LanguageSelector />
        </header>

        {/* Desktop Header (hidden on mobile) */}
        <header className="hidden h-16 items-center justify-between border-b border-slate-800 bg-slate-900/40 px-6 backdrop-blur md:flex">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
            >
              ← {t('header_back_to_dashboard')}
            </Link>
          </div>

  <div className="flex items-center gap-4">
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