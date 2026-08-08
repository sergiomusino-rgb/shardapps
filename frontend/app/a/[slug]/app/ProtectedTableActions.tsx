'use client';

import React from 'react';
import { usePermissions } from '@/src/lib/AuthContext';
import { Plus, Pencil, Trash2 } from 'lucide-react';

// ============================================================================
// Props
// ============================================================================

interface ProtectedTableActionsProps {
  tableName: string;
  onAdd?: () => void;
  onEdit?: (record: any) => void;
  onDelete?: (recordId: string) => void;
  recordId?: string;
  record?: any;
  colors: {
    primary: string;
    danger: string;
    text: string;
    textSecondary: string;
  };
}

// ============================================================================
// Component
// ============================================================================

export function ProtectedTableActions({
  tableName,
  onAdd,
  onEdit,
  onDelete,
  recordId,
  record,
  colors,
}: ProtectedTableActionsProps) {
  const { canPerformAction } = usePermissions();

  // Verifica i permessi
  const canWrite = canPerformAction(tableName, 'write');
  const canDelete = canPerformAction(tableName, 'delete');

  // Se non ci sono azioni disponibili, non renderizzare nulla
  if (!onAdd && !onEdit && !onDelete) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Pulsante Nuovo */}
      {onAdd && canWrite && (
        <button
          onClick={onAdd}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            background: colors.primary,
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <Plus size={16} /> Nuovo
        </button>
      )}

      {/* Pulsante Modifica */}
      {onEdit && record && canWrite && (
        <button
          onClick={() => onEdit(record)}
          title="Modifica"
          style={{
            background: colors.primary + '20',
            border: 'none',
            borderRadius: '8px',
            padding: '6px',
            cursor: 'pointer',
            color: colors.primary,
            display: 'flex',
            alignItems: 'center',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.primary + '40'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.primary + '20'; }}
        >
          <Pencil size={15} />
        </button>
      )}

      {/* Pulsante Elimina */}
      {onDelete && recordId && canDelete && (
        <button
          onClick={() => onDelete(recordId)}
          title="Elimina"
          style={{
            background: colors.danger + '20',
            border: 'none',
            borderRadius: '8px',
            padding: '6px',
            cursor: 'pointer',
            color: colors.danger,
            display: 'flex',
            alignItems: 'center',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.danger + '40'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.danger + '20'; }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Hook per verificare se l'utente può vedere la dashboard
// ============================================================================

export function useDashboardAccess() {
  const { role } = usePermissions();
  
  // Gli agenti non possono vedere la dashboard con i grafici
  const canViewDashboard = role !== 'agent' && role !== 'viewer';
  
  return { canViewDashboard, role };
}