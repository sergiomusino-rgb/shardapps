'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { Trash2, Loader2, AlertCircle, ExternalLink, Clock } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';

interface App {
  id: string;
  name: string;
  slug: string | null;
  trial_ends_at: string | null;
  is_active: boolean;
  created_at: string | null;
  client_active: boolean;
  expires_at: string | null;
  production_url: string | null;
  app_type: string | null;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; appId: string; appName: string }>({
    open: false,
    appId: '',
    appName: '',
  });
  const [deleting, setDeleting] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    loadApps();
  }, []);

  async function loadApps() {
    setLoading(true);
    setError('');
    
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabaseBrowser.auth.getUser();
      
      if (userError || !user) {
        console.log('[Projects] User not logged in');
        setError(t('projects_login_required'));
        setLoading(false);
        return;
      }

      console.log('[Projects] User:', user.id);

      // Get user's tenant
      // Cast mirato: frontend/types/database.ts non copre tenant_members,
      // quindi il client tipizzato risolverebbe qui a `never` come altrove
      // nel progetto (vedi audit tsc).
      const { data: membershipsRaw, error: membershipError } = await supabaseBrowser
        .from('tenant_members' as any)
        .select('tenant_id')
        .eq('user_id', user.id);
      const memberships = membershipsRaw as { tenant_id: string }[] | null;

      if (membershipError) {
        console.error('[Projects] membership error:', membershipError);
        const errorMessage = membershipError.message || membershipError.details || JSON.stringify(membershipError);
        setError(t('projects_error_membership') + errorMessage);
        setLoading(false);
        return;
      }

      console.log('[Projects] Memberships:', memberships);

      const tenantId = memberships?.[0]?.tenant_id;
      if (!tenantId) {
        console.log('[Projects] No tenant found for user');
        setError(t('projects_no_tenant'));
        setLoading(false);
        return;
      }

      console.log('[Projects] TenantId:', tenantId);

      // Get apps for this tenant
      const { data: appsData, error: appsError } = await supabaseBrowser
        .from('apps')
        .select('id, name, slug, trial_ends_at, is_active, created_at, client_active, expires_at, production_url, app_type')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (appsError) {
        console.error('[Projects] load apps error:', appsError);
        setError(t('projects_error_loading') + appsError.message);
      } else {
        console.log('[Projects] Apps loaded:', appsData?.length);
        setApps(appsData || []);
      }
    } catch (err) {
      console.error('[Projects] Unexpected error:', err);
      setError(t('projects_error_unexpected') + (err instanceof Error ? err.message : 'Errore sconosciuto'));
    }

    setLoading(false);
  }

  const handleDeleteApp = async () => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError(t('projects_error_session'));
        return;
      }

      const res = await fetch(`/api/apps/${deleteModal.appId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('projects_error_delete'));
      }

      setApps(apps.filter(a => a.id !== deleteModal.appId));
      setDeleteModal({ open: false, appId: '', appName: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects_error_delete'));
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t('projects_unlimited');
    const date = new Date(dateStr);
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusBadge = (app: App) => {
    // Controlla sia expires_at che trial_ends_at per la scadenza
    const expiryDate = app.expires_at || app.trial_ends_at;
    if (expiryDate && new Date(expiryDate) < new Date()) {
      return <span style={{ background: '#ef444420', color: '#ef4444', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>{t('projects_status_expired')}</span>;
    }
    if (app.client_active === false) {
      return <span style={{ background: '#ef444420', color: '#ef4444', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>{t('projects_status_inactive')}</span>;
    }
    return <span style={{ background: '#22c55e20', color: '#22c55e', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>{t('projects_status_active')}</span>;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#94a3b8' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <span>{t('header_loading')}...</span>
        </div>
        <style jsx global>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h1 style={{ color: '#ffffff', fontSize: '32px', fontWeight: 700, margin: 0 }}>{t('projects_title')}</h1>
        </div>
        <p style={{ color: '#94a3b8', fontSize: '15px', margin: 0 }}>
          {t('projects_subtitle')}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '24px', padding: '16px', borderRadius: '12px', background: '#ef444415', border: '1px solid #ef444440', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertCircle size={20} style={{ color: '#ef4444' }} />
          <span style={{ color: '#ef4444' }}>{error}</span>
        </div>
      )}

      {/* Projects Grid */}
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {apps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
            <h2 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>{t('projects_no_projects')}</h2>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
            {apps.map((app) => (
              <div
                key={app.id}
                style={{
                  background: '#1e293b', borderRadius: '16px', border: '1px solid #334155',
                  padding: '24px', transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155'; }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ color: '#ffffff', fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0' }}>{app.name}</h3>
                    <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>{t('projects_app_created')}</p>
                  </div>
                  {getStatusBadge(app)}
                </div>

                {/* Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '13px' }}>
                    <Clock size={14} />
                    <span>{t('projects_created')} {formatDate(app.created_at)}</span>
                  </div>
                  {app.trial_ends_at && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '13px' }}>
                      <Clock size={14} />
                      <span>{t('projects_trial_ends')} {formatDate(app.trial_ends_at)}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <a
                    href={
                      // Per Comandi AI ignora sempre production_url: è una
                      // colonna generica condivisa con le app a schema
                      // generato (dove può legittimamente essere un dominio
                      // esterno) e per righe Comandi risalenti a
                      // provisioning precedenti può non essere allineata
                      // alla landing pubblica reale — "Apri" deve portare
                      // sempre e solo lì, mai altrove.
                      app.app_type === 'comandi_ai'
                        ? (app.slug ? `/a/${app.slug}` : '#')
                        : app.production_url || (app.slug ? `/a/${app.slug}` : '#')
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      padding: '10px 16px', borderRadius: '10px', border: 'none',
                      background: '#6366f1', color: '#fff', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer', textDecoration: 'none',
                    }}
                  >
                    <ExternalLink size={16} />
                    {t('projects_open')}
                  </a>
                  <button
                    onClick={() => setDeleteModal({ open: true, appId: app.id, appName: app.name })}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '10px 16px', borderRadius: '10px', border: '1px solid #334155',
                      background: 'transparent', color: '#ef4444', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Modal */}
      {deleteModal.open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '32px', maxWidth: '400px', width: '100%' }}>
            <h2 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 700, margin: '0 0 16px 0' }}>{t('projects_delete')}</h2>
            <p style={{ color: '#94a3b8', fontSize: '15px', margin: '0 0 24px 0' }}>
              {t('projects_delete_confirm')} <strong style={{ color: '#ffffff' }}>{deleteModal.appName}</strong>? {t('projects_delete_permanent')}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteModal({ open: false, appId: '', appName: '' })}
                style={{
                  padding: '10px 20px', borderRadius: '10px', border: '1px solid #334155',
                  background: 'transparent', color: '#94a3b8', fontSize: '14px', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('calendar_cancel')}
              </button>
              <button
                onClick={handleDeleteApp}
                disabled={deleting}
                style={{
                  padding: '10px 20px', borderRadius: '10px', border: 'none',
                  background: '#ef4444', color: '#fff', fontSize: '14px', fontWeight: 600,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? t('projects_delete_loading') : t('projects_delete_button')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}