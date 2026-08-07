'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getTablesBySector, SECTOR_LABELS, getAllTables, UITable } from '@/lib/table-config';
import { useLanguage } from '@/src/lib/LanguageContext';
import { useUserPlan } from '@/src/lib/useUserPlan';

import {
  LayoutDashboard,
  Sparkles,
  MessageSquare,
  Eye,
  FolderKanban,
  Settings,
  Crown,
  Shield,
  ChevronRight,
  Database,
  ArrowLeft,
  X,
  FileText,
  BarChart3,
  BookOpen,
  LogOut,
  Clapperboard,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SECTOR_ICONS: Record<string, string> = {
  oculista: '👁️',
  officina: '🔧',
  ristorante: '🍽️',
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface SidebarProps {
  appId?: string;
  showTableNavigation?: boolean;
  onBackToDashboard?: () => void;
  onClose?: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  isActive: boolean;
  isPrimary?: boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  hideForAdmin?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Check if a path matches the current pathname
// ═══════════════════════════════════════════════════════════════════════════

function isPathActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === '/dashboard';
  }
  return pathname.startsWith(href);
}

// ═══════════════════════════════════════════════════════════════════════════
// Sidebar Component
// ═══════════════════════════════════════════════════════════════════════════

export default function Sidebar({
  appId,
  showTableNavigation = false,
  onBackToDashboard,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isProOrBusiness, isAdmin } = useUserPlan();

  // ─── Main Navigation Items ──────────────────────────────────────────────
  const mainNavItems: NavItem[] = useMemo(
    () => [
      {
        label: t('nav_dashboard'),
        href: '/dashboard',
        icon: <LayoutDashboard size={18} />,
        isActive: isPathActive(pathname, '/dashboard') && !showTableNavigation,
        isPrimary: true,
      },
      {
        label: t('nav_creator'),
        href: '/dashboard/creator',
        icon: <Sparkles size={18} />,
        isActive: isPathActive(pathname, '/dashboard/creator'),
        isPrimary: true,
      },
      // Le due voci sotto sono riservate all'admin di sistema: il motore
      // gestionali a tabelle (v1) e il generatore per settore sono stati
      // sostituiti su /dashboard/creator dal nuovo motore Sito/PWA, ma
      // restano accessibili per test/debug interni.
      {
        label: 'Creator AI v1',
        href: '/dashboard/creator-v1',
        icon: <Sparkles size={18} />,
        isActive: isPathActive(pathname, '/dashboard/creator-v1'),
        isAdmin: true,
      },
      {
        label: t('nav_generator'),
        href: '/dashboard/generator',
        icon: <Sparkles size={18} />,
        isActive: isPathActive(pathname, '/dashboard/generator'),
        isAdmin: true,
      },
      {
        label: t('nav_vision'),
        href: '/vision',
        icon: <Clapperboard size={18} />,
        isActive: isPathActive(pathname, '/vision'),
      },
      {
        label: t('nav_projects'),
        href: '/dashboard/projects',
        icon: <FolderKanban size={18} />,
        isActive: isPathActive(pathname, '/dashboard/projects'),
      },
      {
        label: t('nav_agenda'),
        href: '/dashboard/vision',
        icon: <Eye size={18} />,
        isActive: isPathActive(pathname, '/dashboard/vision'),
      },
      {
        label: t('nav_chat'),
        href: '/dashboard/chat',
        icon: <MessageSquare size={18} />,
        isActive: isPathActive(pathname, '/dashboard/chat'),
      },
      {
        label: t('nav_pricing'),
        href: '/pricing',
        icon: <Crown size={18} />,
        isActive: isPathActive(pathname, '/pricing'),
        hideForAdmin: true,
      },
      {
        label: t('nav_admin'),
        href: '/admin',
        icon: <Shield size={18} />,
        isActive: isPathActive(pathname, '/admin'),
        isAdmin: true,
      },
      {
        label: t('nav_management'),
        href: '/dashboard/management',
        icon: <BarChart3 size={18} />,
        isActive: isPathActive(pathname, '/dashboard/management'),
        isPremium: true,
      },
      {
        label: t('nav_management_guide'),
        href: '/management/guide',
        icon: <BookOpen size={18} />,
        isActive: isPathActive(pathname, '/management/guide'),
        isPremium: true,
      },
      {
        label: t('nav_terms'),
        href: '/dashboard/terms',
        icon: <FileText size={18} />,
        isActive: isPathActive(pathname, '/dashboard/terms'),
      },
      {
        label: t('nav_privacy'),
        href: '/dashboard/privacy',
        icon: <Shield size={18} />,
        isActive: isPathActive(pathname, '/dashboard/privacy'),
      },
      {
        label: t('nav_settings'),
        href: '/dashboard/settings',
        icon: <Settings size={18} />,
        isActive: isPathActive(pathname, '/dashboard/settings'),
      },
      {
        label: t('logout'),
        href: '/',
        icon: <LogOut size={18} />,
        isActive: false,
      },
    ],
    [pathname, showTableNavigation, t]
  );

  // ─── Table Navigation Items ─────────────────────────────────────────────
  const sectors = useMemo(() => getTablesBySector(), []);
  const allTables = useMemo(() => getAllTables(), []);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <style jsx>{`
        .scrollbar-dark::-webkit-scrollbar {
          width: 6px;
        }
        .scrollbar-dark::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-dark::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.5);
          border-radius: 3px;
        }
        .scrollbar-dark::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.7);
        }
        .scrollbar-dark {
          scrollbar-width: thin;
          scrollbar-color: rgba(71, 85, 105, 0.5) transparent;
        }
      `}</style>
      <aside className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900">
        {/* ── Mobile Close Button ────────────────────────────────────────── */}
        {onClose && (
          <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4 md:hidden">
            <span className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-lg font-black tracking-wider text-transparent">
              ⚡ SHARDAPPS
            </span>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label={t('sidebar_close_menu')}
            >
              <X size={22} />
            </button>
          </div>
        )}

        {/* ── Logo (desktop) ─────────────────────────────────────────────── */}
        <div className="hidden h-16 items-center gap-2 border-b border-slate-800/60 px-5 md:flex">
          <Link
            href="/dashboard"
            className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-xl font-black tracking-wider text-transparent"
          >
            ⚡ SHARDAPPS
          </Link>
          {appId && (
            <span className="ml-auto rounded-md bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
              {t('sidebar_app_badge')}
            </span>
          )}
        </div>

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto p-3 scrollbar-dark">
          {/* Back button when in table view */}
          {showTableNavigation && onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="mb-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-white"
            >
              <ArrowLeft size={16} />
              {t('sidebar_back_to_dashboard')}
            </button>
          )}

          {/* Main Navigation */}
          {!showTableNavigation && (
            <div className="space-y-1">
              {mainNavItems.map((item) => {
                // Nascondi le voci premium se l'utente non è PRO/Business
                if (item.isPremium && !isProOrBusiness) {
                  return null;
                }
                // Nascondi le voci admin se l'utente non è admin
                if (item.isAdmin && !isAdmin) {
                  return null;
                }
                // Nascondi la voce pricing se l'utente è admin (non deve vedere piani)
                if (item.hideForAdmin && isAdmin) {
                  return null;
                }
                
                const handleClick = onClose
                  ? () => setTimeout(() => onClose(), 150)
                  : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleClick}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      item.isActive
                        ? 'border border-indigo-500/30 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 shadow-sm shadow-indigo-500/10'
                        : 'border border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <span className="flex-shrink-0">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {item.isPrimary && item.isActive && (
                      <ChevronRight size={14} className="ml-auto text-indigo-400" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Table Navigation (divider + sectors) */}
          {showTableNavigation && (
            <div className="space-y-4">
              {/* Divider */}
              <div className="flex items-center gap-2 px-3 pt-2">
                <Database size={14} className="text-slate-500" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {t('sidebar_table_data')}
                </span>
              </div>

              {/* Sectors */}
              {Object.entries(sectors).map(([sector, tables]) => (
                <div key={sector} className="space-y-1">
                  {/* Sector Header */}
                  <div className="flex items-center gap-2 px-3 py-1">
                    <span className="text-sm">{SECTOR_ICONS[sector] || '📊'}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {SECTOR_LABELS[sector] || sector}
                    </span>
                  </div>

                  {/* Table Links */}
                  {tables.map((table) => {
                    const tablePath = `/dashboard/${table.name}`;
                    const isActive = pathname === tablePath;

                    return (
                      <Link
                        key={table.name}
                        href={tablePath}
                        onClick={onClose ? () => setTimeout(() => onClose(), 150) : undefined}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all ${
                          isActive
                            ? 'border-l-2 border-indigo-500 bg-indigo-500/10 text-indigo-400 font-medium'
                            : 'border-l-2 border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                        }`}
                      >
                        <span className="flex-shrink-0 text-base">{table.icon}</span>
                        <span className="truncate">{table.labelPlural}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}

              {/* Empty state */}
              {allTables.length === 0 && (
                <div className="px-3 py-4 text-center">
                  <p className="text-xs text-slate-500">
                    {t('sidebar_no_tables')}
                    <br />
                    {t('sidebar_create_app_hint')}
                  </p>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="border-t border-slate-800/60 bg-slate-950/40 p-4">
          <div className="flex flex-col items-center gap-2">
            <img
              src="/favicon.png"
              alt="ShardApps"
              className="h-14 w-14 rounded-full object-cover"
            />
            <p className="text-xs font-semibold text-slate-400">{t('sidebar_by')}</p>
          </div>
        </div>
      </aside>
    </>
  );
}