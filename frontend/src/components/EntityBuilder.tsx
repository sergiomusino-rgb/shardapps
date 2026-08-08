'use client';

import { useState } from 'react';

// Tipi supportati per i campi
export type FieldType = 'text' | 'int' | 'boolean' | 'uuid' | 'timestamp';

// Interfaccia per un campo
export interface Field {
  id: number;
  name: string;
  type: FieldType;
}

// Interfaccia per lo stato del form
export interface EntityBuilderState {
  tableName: string;
  fields: Field[];
  language: string;
}

// Interfaccia per il messaggio di feedback
export interface FeedbackMessage {
  type: 'success' | 'error' | '';
  text: string;
}

// Interfaccia per la risposta dell'API
export interface ApiResponse {
  message?: string;
  error?: string;
}

// Tipi di dato supportati
const DATA_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'int', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'uuid', label: 'UUID' },
  { value: 'timestamp', label: 'Timestamp' },
];

// Lingue supportate
const LANGUAGES: { value: string; label: string }[] = [
  { value: 'it', label: 'Italiano' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

// Componente EntityBuilder
export default function EntityBuilder() {
  // Stato per il nome della tabella
  const [tableName, setTableName] = useState<string>('');
  
  // Stato per i campi dinamici
  const [fields, setFields] = useState<Field[]>([
    { id: 1, name: '', type: 'text' }
  ]);
  
  // Stato per la lingua selezionata
  const [selectedLanguage, setSelectedLanguage] = useState<string>('it');
  
  // Stato per i messaggi di feedback
  const [message, setMessage] = useState<FeedbackMessage>({ type: '', text: '' });
  
  // Stato per il loading
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Aggiungi una nuova riga di campo
  const addField = (): void => {
    setFields([
      ...fields,
      { id: Date.now(), name: '', type: 'text' }
    ]);
  };

  // Rimuovi una riga di campo
  const removeField = (id: number): void => {
    if (fields.length > 1) {
      setFields(fields.filter(field => field.id !== id));
    }
  };

  // Aggiorna il nome del campo
  const updateFieldName = (id: number, name: string): void => {
    setFields(fields.map(field => 
      field.id === id ? { ...field, name } : field
    ));
  };

  // Aggiorna il tipo del campo
  const updateFieldType = (id: number, type: FieldType): void => {
    setFields(fields.map(field => 
      field.id === id ? { ...field, type } : field
    ));
  };

  // Gestore invio form
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsLoading(true);
    setMessage({ type: '', text: '' });

    // Validazione
    if (!tableName.trim()) {
      setMessage({ type: 'error', text: 'Il nome della tabella è obbligatorio' });
      setIsLoading(false);
      return;
    }

    const validFields = fields.filter(f => f.name.trim() !== '');
    if (validFields.length === 0) {
      setMessage({ type: 'error', text: 'Aggiungi almeno un campo alla tabella' });
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/create-entity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tableName: tableName.trim(),
          fields: validFields.map(f => ({ name: f.name.trim(), type: f.type })),
          language: selectedLanguage,
        }),
      });

      const data: ApiResponse = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Tabella creata con successo!' });
        // Reset form
        setTableName('');
        setFields([{ id: Date.now(), name: '', type: 'text' }]);
      } else {
        setMessage({ type: 'error', text: data.error || 'Errore durante la creazione della tabella' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Errore di connessione al server' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl">
      <h2 className="text-2xl font-bold text-white mb-6">Entity Builder</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Nome tabella */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Nome Tabella
          </label>
          <input
            type="text"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="es. prodotti, clienti, ordini..."
            className="w-full px-4 py-2 bg-slate-800/50 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            disabled={isLoading}
          />
        </div>

        {/* Campi dinamici */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-slate-300">
              Campi della Tabella
            </label>
            <button
              type="button"
              onClick={addField}
              disabled={isLoading}
              className="px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-lg text-sm font-medium transition-all duration-200 border border-indigo-500/30"
            >
              + Aggiungi Campo
            </button>
          </div>

          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className="flex gap-3 items-center">
                <input
                  type="text"
                  value={field.name}
                  onChange={(e) => updateFieldName(field.id, e.target.value)}
                  placeholder={`Nome campo ${index + 1}`}
                  className="flex-1 px-3 py-2 bg-slate-800/50 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  disabled={isLoading}
                />
                <select
                  value={field.type}
                  onChange={(e) => updateFieldType(field.id, e.target.value as FieldType)}
                  className="px-3 py-2 bg-slate-800/50 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  disabled={isLoading}
                >
                  {DATA_TYPES.map(type => (
                    <option key={type.value} value={type.value} className="bg-slate-800">
                      {type.label}
                    </option>
                  ))}
                </select>
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    disabled={isLoading}
                    className="px-2 py-2 text-red-400 hover:text-red-300 rounded-lg transition-all"
                    title="Rimuovi campo"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Selezione lingua */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Lingua
          </label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="w-full px-4 py-2 bg-slate-800/50 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            disabled={isLoading}
          >
            {LANGUAGES.map(lang => (
              <option key={lang.value} value={lang.value} className="bg-slate-800">
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Messaggio di feedback */}
        {message.text && (
          <div className={`p-4 rounded-xl ${
            message.type === 'success' 
              ? 'bg-green-500/20 border border-green-500/30 text-green-300' 
              : 'bg-red-500/20 border border-red-500/30 text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Pulsante submit */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 ${
            isLoading
              ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
              : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg hover:shadow-indigo-500/25'
          }`}
        >
          {isLoading ? 'Creazione in corso...' : 'Crea Tabella'}
        </button>
      </form>
    </div>
  );
}