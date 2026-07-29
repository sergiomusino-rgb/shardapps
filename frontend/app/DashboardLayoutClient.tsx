'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import AuthGuard from '@/components/layout/AuthGuard';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Menu, X } from 'lucide-react';



export default function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Controlla se siamo in una pagina [table] della dashboard
  const isTablePage = pathname.match(/^\/dashboard\/(patients|appointments|customers|vehicles|jobs|dishes|reservations)$/);
  const showTableNav = Boolean(isTablePage);
  const isSubPage = (pathname.startsWith('/dashboard/') && pathname !== '/dashboard') || pathname === '/pricing' || pathname === '/admin';

  // Determine if the sidebar should be shown (on dashboard, admin, and pricing pages)
  const shouldShowSidebar = pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname === '/pricing';

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Evita hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

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

  const handleBackToDashboard = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  const { t } = useLanguage();

  if (!mounted) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-white">
        <div className="text-slate-400">{t('header_loading')}</div>
      </div>
    );
  }


  return (
    <AuthGuard requireTenant redirectTo="/login">
      {/* Meta tag per disabilitare cache browser */}
      <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
      <meta httpEquiv="Pragma" content="no-cache" />
      <meta httpEquiv="Expires" content="0" />

      <div className="flex h-dvh overflow-hidden bg-slate-950 text-white">
        {/* ─── Desktop Sidebar (always visible on md+) ─────────────────── */}
        {shouldShowSidebar && (
          <div className="hidden md:block">
            <Sidebar
              showTableNavigation={showTableNav}
              onBackToDashboard={handleBackToDashboard}
            />
          </div>
        )}

        {/* ─── Mobile Sidebar Overlay ──────────────────────────────────── */}
        {shouldShowSidebar && (
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
                showTableNavigation={showTableNav}
                onBackToDashboard={handleBackToDashboard}
                onClose={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        )}

        {/* ─── Main Content Area ───────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">
           {/* Mobile Header (visible only on small screens) */}
           <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 md:hidden">
            {shouldShowSidebar ? (
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label={t('header_open_menu')}
              >
                <Menu size={22} />
              </button>
            ) : (
              <div />
            )}
            <Link
              href="/dashboard"
              className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-lg font-black tracking-wider text-transparent"
            >
              ⚡ ZEUSX
            </Link>
            <LanguageSelector />
          </header>

          {/* Desktop Header (hidden on mobile) - uniform on all dashboard pages */}
          <header className="hidden h-16 items-center justify-between border-b border-slate-800 bg-slate-900/40 px-6 backdrop-blur md:flex">
            <div className="flex items-center gap-4">
              {isSubPage ? (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
                >
                  ← {t('header_back_to_dashboard')}
                </Link>
              ) : (
                  <span className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-xl font-black tracking-wider text-transparent">
                    ⚡ {t('header_dashboard_title')}
                  </span>
              )}
            </div>

           <div className="flex items-center gap-4">
                <LanguageSelector />
              </div>
          </header>


          {/* Scrollable Content */}
          <main
            className="flex-1 overflow-y-auto bg-slate-950 p-6 lg:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}