'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import DynamicTable from '@/components/DynamicTable';
import { useDynamicData } from '@/hooks/useDynamicData';
import type { TableDef, ThemeColors } from '@/components/DynamicTable';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface AppDefinition {
  id: string;
  app_id: string;
  tenant_id: string;
  schema: {
    tables: TableDef[];
  };
  ui_config?: Record<string, unknown>;
  version: number;
  is_published: boolean;
}

interface AppInfo {
  id: string;
  name: string;
  tenant_id: string;
  slug: string | null;
}

// ─── Theme Helper ─────────────────────────────────────────────────────────────

function getThemeColors(primaryColor: string): ThemeColors {
  return {
    bg: '#0a0e1a',
    text: '#ffffff',
    textSecondary: '#94a3b8',
    cardBg: '#1e293b',
    cardBgAlt: '#162032',
    border: '#334155',
    sidebarBg: '#0f172a',
    sidebarText: '#e2e8f0',
    sidebarHover: '#1e293b',
    inputBg: '#0f172a',
    inputBorder: '#334155',
    primary: primaryColor,
    primaryHover: primaryColor + 'dd',
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
  };
}

// ─── DynamicPage Component ─────────────────────────────────────────────────────

export default function DynamicPage() {
  const params = useParams();
  const slug = params.slug as string;

  // State
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [appDefinition, setAppDefinition] = useState<AppDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('#6366f1');

  // ─── Load App Info ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadApp() {
      setLoading(true);
      setError(null);

      try {
        // Fetch app by slug
        const { data: appData, error: appError } = await supabase
          .from('apps')
          .select('id, name, tenant_id, slug, config')
          .eq('slug', slug)
          .eq('client_active', true)
          .single();

        if (appError || !appData) {
          setError('App non trovata o non attiva');
          setLoading(false);
          return;
        }

        setAppInfo(appData);

        // Extract primary color from config
        const config = appData.config as Record<string, unknown>;
        const branding = config?.branding as Record<string, unknown> | undefined;
        const primaryColorFromConfig =
          (branding?.primary_color as string | undefined) ||
          (config?.primary_color as string | undefined) ||
          '#6366f1';
        setPrimaryColor(primaryColorFromConfig);

        // Fetch app definition
        const { data: definitionData, error: definitionError } = await supabase
          .from('app_definitions')
          .select('*')
          .eq('app_id', appData.id)
          .single();

        if (definitionError || !definitionData) {
          // Try to sync from config if no definition exists
          console.log('[DynamicPage] No app_definitions found, attempting sync from config');
          
          // Insert definition from config
          const appConfig = appData.config as Record<string, unknown>;
          const blueprint = appConfig?.blueprint as Record<string, unknown> | undefined;
          const schema = (appConfig?.schema as { tables?: TableDef[] } | undefined)?.tables || 
                         (blueprint?.schema as { tables?: TableDef[] } | undefined)?.tables || 
                         { tables: [] };
          const uiConfig = (appConfig?.ui as Record<string, unknown> | undefined) || 
                           (appConfig?.branding as Record<string, unknown> | undefined) || 
                           {};

          const { data: newDefinition, error: insertError } = await supabase
            .from('app_definitions')
            .insert({
              app_id: appData.id,
              tenant_id: appData.tenant_id,
              // schema/ui_config sono colonne jsonb: il valore applicativo è
              // già JSON-serializzabile a runtime ma TableDef non implementa
              // una index signature, quindi non soddisfa strutturalmente Json.
              schema: schema as unknown as Database['public']['Tables']['app_definitions']['Insert']['schema'],
              ui_config: uiConfig as unknown as Database['public']['Tables']['app_definitions']['Insert']['ui_config'],
              is_published: true,
            })
            .select()
            .single();

          if (insertError || !newDefinition) {
            setError('Impossibile caricare la definizione dell\'app');
            setLoading(false);
            return;
          }

          setAppDefinition(newDefinition as unknown as AppDefinition);
        } else {
          setAppDefinition(definitionData as unknown as AppDefinition);
        }

        // Auto-select first table if available
        const appConfigForTables = appData.config as Record<string, unknown>;
        const blueprintForTables = appConfigForTables?.blueprint as Record<string, unknown> | undefined;
        const tablesFromDef = (definitionData?.schema as { tables?: TableDef[] } | undefined)?.tables || [];
        const tablesFromConfig = (appConfigForTables?.schema as { tables?: TableDef[] } | undefined)?.tables || 
                                  (blueprintForTables?.schema as { tables?: TableDef[] } | undefined)?.tables || 
                                  [];
        const availableTables = tablesFromDef.length > 0 ? tablesFromDef : tablesFromConfig;
        if (availableTables.length > 0 && !selectedTableName) {
          setSelectedTableName(availableTables[0].name);
        }

        setLoading(false);
      } catch (err) {
        console.error('[DynamicPage] Error loading app:', err);
        setError('Errore nel caricamento dell\'app');
        setLoading(false);
      }
    }

    loadApp();
  }, [slug]);

  // ─── Derived Values ─────────────────────────────────────────────────────────

  const tables = useMemo(() => {
    return appDefinition?.schema?.tables || [];
  }, [appDefinition]);

  const selectedTable = useMemo(() => {
    return tables.find((t) => t.name === selectedTableName) || null;
  }, [tables, selectedTableName]);

  const colors = useMemo(() => getThemeColors(primaryColor), [primaryColor]);

  // ─── Dynamic Data Hook ──────────────────────────────────────────────────────

  const { records, loading: dataLoading, error: dataError, refetch } = useDynamicData(
    selectedTable?.name,
    appInfo?.tenant_id,
    !!selectedTable && !!appInfo
  );

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleTableChange = (tableName: string) => {
    setSelectedTableName(tableName);
  };

  const handleRecordsChanged = () => {
    refetch();
  };

  // ─── Loading State ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0e1a',
      }}>
        <div style={{ color: '#94a3b8', fontSize: '16px' }}>Caricamento...</div>
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────────────────────

  if (error || dataError) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0e1a',
        padding: '20px',
      }}>
        <div style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '500px',
          textAlign: 'center',
        }}>
          <div style={{ color: '#ef4444', fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 700, marginBottom: '12px' }}>
            Errore
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '24px' }}>
            {error || dataError}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  // ─── No Tables State ────────────────────────────────────────────────────────

  if (tables.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0e1a',
        padding: '20px',
      }}>
        <div style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '500px',
          textAlign: 'center',
        }}>
          <div style={{ color: '#f59e0b', fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <h2 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 700, marginBottom: '12px' }}>
            Nessuna tabella configurata
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>
            Questa app non ha ancora tabelle configurate. Contatta l'amministratore.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main Layout ────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: colors.bg }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '280px',
          background: colors.sidebarBg,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Logo + App Name */}
        <div style={{
          padding: '24px 20px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: primaryColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '18px',
          }}>
            {appInfo?.name?.charAt(0).toUpperCase() || 'A'}
          </div>
          <div>
            <div style={{
              color: colors.sidebarText,
              fontSize: '16px',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {appInfo?.name || 'App'}
            </div>
            <div style={{
              color: colors.textSecondary,
              fontSize: '12px',
            }}>
              Gestione Dati
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
          <div style={{
            color: colors.textSecondary,
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
            paddingLeft: '8px',
          }}>
            Tabelle
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => handleTableChange(table.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: selectedTableName === table.name
                    ? primaryColor + '25'
                    : 'transparent',
                  color: selectedTableName === table.name
                    ? primaryColor
                    : colors.sidebarText,
                  fontSize: '14px',
                  fontWeight: selectedTableName === table.name ? 600 : 500,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                {selectedTableName === table.name && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '3px',
                    height: '20px',
                    borderRadius: '0 3px 3px 0',
                    background: primaryColor,
                  }} />
                )}
                <span style={{ flex: 1 }}>{table.labelPlural}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div style={{
          padding: '16px',
          borderTop: `1px solid ${colors.border}`,
          color: colors.textSecondary,
          fontSize: '12px',
          textAlign: 'center',
        }}>
          ZeusX Dynamic App
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Bar */}
        <header style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.cardBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h1 style={{
              color: colors.text,
              fontSize: '20px',
              fontWeight: 700,
              margin: 0,
            }}>
              {selectedTable?.labelPlural || 'Seleziona una tabella'}
            </h1>
            {selectedTable && (
              <p style={{
                color: colors.textSecondary,
                fontSize: '13px',
                margin: '4px 0 0 0',
              }}>
                {selectedTable.label} - Gestione record
              </p>
            )}
          </div>
          {selectedTable && (
            <div style={{
              padding: '6px 12px',
              borderRadius: '8px',
              background: colors.cardBgAlt,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
              fontSize: '12px',
            }}>
              {records.length} record
            </div>
          )}
        </header>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {selectedTable ? (
            <DynamicTable
              table={selectedTable}
              colors={colors}
              radius="rounded-xl"
              shadow="shadow-xl"
              appId={appInfo?.id}
              password={undefined} // Not needed when using Supabase directly
              onRecordsChanged={handleRecordsChanged}
            />
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '400px',
              color: colors.textSecondary,
            }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>📋</div>
              <p style={{ fontSize: '16px', fontWeight: 500 }}>Seleziona una tabella dal menu</p>
              <p style={{ fontSize: '14px', marginTop: '8px' }}>
                Scegli una tabella per visualizzare e gestire i record
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}