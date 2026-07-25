export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _system_entities: {
        Row: {
          created_at: string | null
          id: number
          table_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          table_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          table_name?: string | null
        }
        Relationships: []
      }
      access_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          is_used: boolean
          profile_id: string
          tenant_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          is_used?: boolean
          profile_id: string
          tenant_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          profile_id?: string
          tenant_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_collaborators: {
        Row: {
          app_id: string
          created_at: string
          email: string
          id: string
          password: string
          permissions: Json
          role: string
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          app_id: string
          created_at?: string
          email: string
          id?: string
          password: string
          permissions?: Json
          role?: string
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          email?: string
          id?: string
          password?: string
          permissions?: Json
          role?: string
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_collaborators_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_definitions: {
        Row: {
          app_id: string
          created_at: string | null
          id: string
          is_published: boolean
          schema: Json
          tenant_id: string
          ui_config: Json
          updated_at: string | null
          version: number
        }
        Insert: {
          app_id: string
          created_at?: string | null
          id?: string
          is_published?: boolean
          schema?: Json
          tenant_id: string
          ui_config?: Json
          updated_at?: string | null
          version?: number
        }
        Update: {
          app_id?: string
          created_at?: string | null
          id?: string
          is_published?: boolean
          schema?: Json
          tenant_id?: string
          ui_config?: Json
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_definitions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_records: {
        Row: {
          app_id: string
          created_at: string | null
          data: Json
          id: string
          table_name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          app_id: string
          created_at?: string | null
          data?: Json
          id?: string
          table_name: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string | null
          data?: Json
          id?: string
          table_name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_records_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_registry: {
        Row: {
          app_name: string
          app_url: string
          checkout_url: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          lemon_squeezy_product_id: string | null
          monthly_fee: number
          original_reseller_id: string | null
          ownership_status: string
          reseller_id: string
          status: string
          updated_at: string | null
          zeusx_share: number
        }
        Insert: {
          app_name: string
          app_url: string
          checkout_url?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          lemon_squeezy_product_id?: string | null
          monthly_fee?: number
          original_reseller_id?: string | null
          ownership_status?: string
          reseller_id: string
          status?: string
          updated_at?: string | null
          zeusx_share?: number
        }
        Update: {
          app_name?: string
          app_url?: string
          checkout_url?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          lemon_squeezy_product_id?: string | null
          monthly_fee?: number
          original_reseller_id?: string | null
          ownership_status?: string
          reseller_id?: string
          status?: string
          updated_at?: string | null
          zeusx_share?: number
        }
        Relationships: []
      }
      app_users: {
        Row: {
          app_id: string
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string | null
          email: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          app_type: string | null
          auth_mode: string
          blueprint_id: string | null
          client_active: boolean
          client_billing_address: string | null
          client_email: string | null
          client_full_name: string | null
          client_notes: string | null
          client_password: string | null
          client_phone: string | null
          client_price: number | null
          client_subscription_price: number | null
          client_tax_id: string | null
          config: Json
          created_at: string | null
          expires_at: string | null
          expiry_warning_sent: boolean
          id: string
          initial_password: string | null
          is_active: boolean
          is_managed_by_platform: boolean | null
          name: string
          payment_reset_required: boolean | null
          production_url: string | null
          slug: string | null
          status: string | null
          stripe_connect_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          totalum_app_id: string | null
          trial_end: string | null
          trial_ends_at: string
          trial_start: string | null
          updated_at: string | null
          zeusx_fee: number | null
        }
        Insert: {
          app_type?: string | null
          auth_mode?: string
          blueprint_id?: string | null
          client_active?: boolean
          client_billing_address?: string | null
          client_email?: string | null
          client_full_name?: string | null
          client_notes?: string | null
          client_password?: string | null
          client_phone?: string | null
          client_price?: number | null
          client_subscription_price?: number | null
          client_tax_id?: string | null
          config?: Json
          created_at?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean
          id?: string
          initial_password?: string | null
          is_active?: boolean
          is_managed_by_platform?: boolean | null
          name: string
          payment_reset_required?: boolean | null
          production_url?: string | null
          slug?: string | null
          status?: string | null
          stripe_connect_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          totalum_app_id?: string | null
          trial_end?: string | null
          trial_ends_at?: string
          trial_start?: string | null
          updated_at?: string | null
          zeusx_fee?: number | null
        }
        Update: {
          app_type?: string | null
          auth_mode?: string
          blueprint_id?: string | null
          client_active?: boolean
          client_billing_address?: string | null
          client_email?: string | null
          client_full_name?: string | null
          client_notes?: string | null
          client_password?: string | null
          client_phone?: string | null
          client_price?: number | null
          client_subscription_price?: number | null
          client_tax_id?: string | null
          config?: Json
          created_at?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean
          id?: string
          initial_password?: string | null
          is_active?: boolean
          is_managed_by_platform?: boolean | null
          name?: string
          payment_reset_required?: boolean | null
          production_url?: string | null
          slug?: string | null
          status?: string | null
          stripe_connect_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          totalum_app_id?: string | null
          trial_end?: string | null
          trial_ends_at?: string
          trial_start?: string | null
          updated_at?: string | null
          zeusx_fee?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "apps_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprints: {
        Row: {
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          schema: Json
          sector: string
          ui_config: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          schema?: Json
          sector: string
          ui_config?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          schema?: Json
          sector?: string
          ui_config?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sku: string
          stock_qty: number
          tenant_id: string
          unit_of_measure: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sku: string
          stock_qty?: number
          tenant_id: string
          unit_of_measure?: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sku?: string
          stock_qty?: number
          tenant_id?: string
          unit_of_measure?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: number
          provider: string
          role: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: number
          provider: string
          role: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: number
          provider?: string
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chats: {
        Row: {
          created_at: string | null
          id: string
          project_id: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clienti: {
        Row: {
          app_id: string | null
          cap: string | null
          citta: string | null
          created_at: string | null
          dati_personalizzati: Json | null
          email: string | null
          id: string
          indirizzo: string | null
          note: string | null
          partita_iva: string | null
          ragione_sociale: string | null
          telefono: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          app_id?: string | null
          cap?: string | null
          citta?: string | null
          created_at?: string | null
          dati_personalizzati?: Json | null
          email?: string | null
          id?: string
          indirizzo?: string | null
          note?: string | null
          partita_iva?: string | null
          ragione_sociale?: string | null
          telefono?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          app_id?: string | null
          cap?: string | null
          citta?: string | null
          created_at?: string | null
          dati_personalizzati?: Json | null
          email?: string | null
          id?: string
          indirizzo?: string | null
          note?: string | null
          partita_iva?: string | null
          ragione_sociale?: string | null
          telefono?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          accent_color: string | null
          address: string | null
          app_id: string
          city: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          fiscal_code: string | null
          footer_notes: string | null
          header_text: string | null
          id: string
          logo_url: string | null
          phone: string | null
          province: string | null
          slogan: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          accent_color?: string | null
          address?: string | null
          app_id: string
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          fiscal_code?: string | null
          footer_notes?: string | null
          header_text?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          province?: string | null
          slogan?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          accent_color?: string | null
          address?: string | null
          app_id?: string
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          fiscal_code?: string | null
          footer_notes?: string | null
          header_text?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          province?: string | null
          slogan?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      fatture: {
        Row: {
          anno: number
          cliente_indirizzo: string | null
          cliente_nome: string
          cliente_piva: string | null
          created_at: string | null
          data_emissione: string
          id: string
          metodo_pagamento: string | null
          numero_fattura: string
          stato: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          anno: number
          cliente_indirizzo?: string | null
          cliente_nome: string
          cliente_piva?: string | null
          created_at?: string | null
          data_emissione: string
          id?: string
          metodo_pagamento?: string | null
          numero_fattura: string
          stato?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          anno?: number
          cliente_indirizzo?: string | null
          cliente_nome?: string
          cliente_piva?: string | null
          created_at?: string | null
          data_emissione?: string
          id?: string
          metodo_pagamento?: string | null
          numero_fattura?: string
          stato?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fatture_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      magazzino: {
        Row: {
          app_id: string | null
          corriere: string | null
          created_at: string | null
          data_preparazione: string | null
          data_spedizione: string | null
          dati_personalizzati: Json | null
          id: string
          note_logistica: string | null
          numero_tracking: string | null
          ordine_id: string | null
          stato_preparazione: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          app_id?: string | null
          corriere?: string | null
          created_at?: string | null
          data_preparazione?: string | null
          data_spedizione?: string | null
          dati_personalizzati?: Json | null
          id?: string
          note_logistica?: string | null
          numero_tracking?: string | null
          ordine_id?: string | null
          stato_preparazione?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          app_id?: string | null
          corriere?: string | null
          created_at?: string | null
          data_preparazione?: string | null
          data_spedizione?: string | null
          dati_personalizzati?: Json | null
          id?: string
          note_logistica?: string | null
          numero_tracking?: string | null
          ordine_id?: string | null
          stato_preparazione?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_id: string | null
          content: string
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          chat_id?: string | null
          content: string
          created_at?: string | null
          id?: string
          role: string
        }
        Update: {
          chat_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          subtotal: number
          tenant_id: string
          unit: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          subtotal?: number
          tenant_id: string
          unit?: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          subtotal?: number
          tenant_id?: string
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          agent_id: string | null
          audio_transcript: string | null
          confidence_score: number | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          audio_transcript?: string | null
          confidence_score?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          audio_transcript?: string | null
          confidence_score?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ordini: {
        Row: {
          app_id: string | null
          cliente_id: string | null
          created_at: string | null
          data_consegna: string | null
          data_ordine: string | null
          dati_personalizzati: Json | null
          id: string
          note: string | null
          numero_ordine: string | null
          prezzo_unitario: number | null
          prodotto_id: string | null
          quantita: number | null
          stato: string | null
          tenant_id: string | null
          totale: number | null
          updated_at: string | null
        }
        Insert: {
          app_id?: string | null
          cliente_id?: string | null
          created_at?: string | null
          data_consegna?: string | null
          data_ordine?: string | null
          dati_personalizzati?: Json | null
          id?: string
          note?: string | null
          numero_ordine?: string | null
          prezzo_unitario?: number | null
          prodotto_id?: string | null
          quantita?: number | null
          stato?: string | null
          tenant_id?: string | null
          totale?: number | null
          updated_at?: string | null
        }
        Update: {
          app_id?: string | null
          cliente_id?: string | null
          created_at?: string | null
          data_consegna?: string | null
          data_ordine?: string | null
          dati_personalizzati?: Json | null
          id?: string
          note?: string | null
          numero_ordine?: string | null
          prezzo_unitario?: number | null
          prodotto_id?: string | null
          quantita?: number | null
          stato?: string | null
          tenant_id?: string | null
          totale?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      permissions_config: {
        Row: {
          created_at: string
          description: string | null
          enabled_features: string[]
          id: string
          role: string
          updated_at: string
          visible_tables: string[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled_features?: string[]
          id?: string
          role: string
          updated_at?: string
          visible_tables?: string[]
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled_features?: string[]
          id?: string
          role?: string
          updated_at?: string
          visible_tables?: string[]
        }
        Relationships: []
      }
      processed_checkout_sessions: {
        Row: {
          created_at: string | null
          plan: string
          session_id: string
          slots_added: number
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          plan: string
          session_id: string
          slots_added: number
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          plan?: string
          session_id?: string
          slots_added?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processed_checkout_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prodotti: {
        Row: {
          app_id: string | null
          categoria: string | null
          codice_articolo: string | null
          created_at: string | null
          dati_personalizzati: Json | null
          descrizione: string | null
          id: string
          immagine_url: string | null
          iva: string | null
          nome_prodotto: string | null
          prezzo: number | null
          tenant_id: string | null
          unita_misura: string | null
          updated_at: string | null
        }
        Insert: {
          app_id?: string | null
          categoria?: string | null
          codice_articolo?: string | null
          created_at?: string | null
          dati_personalizzati?: Json | null
          descrizione?: string | null
          id?: string
          immagine_url?: string | null
          iva?: string | null
          nome_prodotto?: string | null
          prezzo?: number | null
          tenant_id?: string | null
          unita_misura?: string | null
          updated_at?: string | null
        }
        Update: {
          app_id?: string | null
          categoria?: string | null
          codice_articolo?: string | null
          created_at?: string | null
          dati_personalizzati?: Json | null
          descrizione?: string | null
          id?: string
          immagine_url?: string | null
          iva?: string | null
          nome_prodotto?: string | null
          prezzo?: number | null
          tenant_id?: string | null
          unita_misura?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      product_synonyms: {
        Row: {
          created_at: string
          id: string
          product_id: string
          spoken_alias: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          spoken_alias: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          spoken_alias?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_synonyms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_synonyms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          role: string
          stripe_connect_id: string | null
          subscription_plan: string | null
          subscription_status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          stripe_connect_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          stripe_connect_id?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_subscription_price: number | null
          content: string | null
          created_at: string | null
          description: string | null
          id: string
          is_managed_by_platform: boolean | null
          name: string
          status: string | null
          stripe_subscription_id: string | null
          totalum_app_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          client_subscription_price?: number | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_managed_by_platform?: boolean | null
          name: string
          status?: string | null
          stripe_subscription_id?: string | null
          totalum_app_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          client_subscription_price?: number | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_managed_by_platform?: boolean | null
          name?: string
          status?: string | null
          stripe_subscription_id?: string | null
          totalum_app_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      righe_fattura: {
        Row: {
          aliquota_iva: number
          created_at: string | null
          descrizione: string
          fattura_id: string
          id: string
          prezzo_unitario: number
          quantita: number
        }
        Insert: {
          aliquota_iva?: number
          created_at?: string | null
          descrizione: string
          fattura_id: string
          id?: string
          prezzo_unitario?: number
          quantita?: number
        }
        Update: {
          aliquota_iva?: number
          created_at?: string | null
          descrizione?: string
          fattura_id?: string
          id?: string
          prezzo_unitario?: number
          quantita?: number
        }
        Relationships: [
          {
            foreignKeyName: "righe_fattura_fattura_id_fkey"
            columns: ["fattura_id"]
            isOneToOne: false
            referencedRelation: "fatture"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string | null
          id: string
          permissions: Json | null
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permissions?: Json | null
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permissions?: Json | null
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          app_limit: number
          city: string | null
          created_at: string | null
          id: string
          name: string
          owner_id: string
          phone: string | null
          plan: string
          slug: string
          total_apps_created: number
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          app_limit?: number
          city?: string | null
          created_at?: string | null
          id?: string
          name: string
          owner_id: string
          phone?: string | null
          plan?: string
          slug: string
          total_apps_created?: number
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          app_limit?: number
          city?: string | null
          created_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          plan?: string
          slug?: string
          total_apps_created?: number
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      test_tabella: {
        Row: {
          created_at: string | null
          id: string
          nome: string | null
          prezzo: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome?: string | null
          prezzo?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string | null
          prezzo?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          app_registry_id: string | null
          created_at: string | null
          currency: string
          event_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          reseller_id: string
          status: string
          total_amount: number
          zeusx_commission: number
        }
        Insert: {
          app_registry_id?: string | null
          created_at?: string | null
          currency?: string
          event_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          reseller_id: string
          status?: string
          total_amount: number
          zeusx_commission: number
        }
        Update: {
          app_registry_id?: string | null
          created_at?: string | null
          currency?: string
          event_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          reseller_id?: string
          status?: string
          total_amount?: number
          zeusx_commission?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_app_registry_id_fkey"
            columns: ["app_registry_id"]
            isOneToOne: false
            referencedRelation: "app_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          enabled_features: string[]
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
          visible_tables: string[]
        }
        Insert: {
          created_at?: string
          enabled_features?: string[]
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          visible_tables?: string[]
        }
        Update: {
          created_at?: string
          enabled_features?: string[]
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          visible_tables?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          id: string
          theme: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          id: string
          theme?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          id?: string
          theme?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_tenant_slots: {
        Args: { slots_to_add: number; tenant_id: string }
        Returns: undefined
      }
      admin_takeover_reseller_app: {
        Args: { target_app_id: string }
        Returns: {
          app_name: string
          message: string
          new_checkout_url: string
          original_reseller_id: string
          success: boolean
        }[]
      }
      count_tenant_apps: { Args: { p_tenant_id: string }; Returns: number }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      execute_sql: { Args: { sql_query: string }; Returns: undefined }
      get_app_client_credentials: {
        Args: { p_app_id: string }
        Returns: {
          client_password: string
          initial_password: string
        }[]
      }
      get_app_for_takeover: {
        Args: { target_app_id: string }
        Returns: {
          app_name: string
          app_url: string
          checkout_url: string
          id: string
          ownership_status: string
          reseller_email: string
          reseller_id: string
        }[]
      }
      get_my_tenant_ids: {
        Args: never
        Returns: {
          tenant_id: string
        }[]
      }
      get_reseller_apps: {
        Args: { p_reseller_id: string }
        Returns: {
          app_name: string
          app_url: string
          created_at: string
          id: string
          monthly_fee: number
          status: string
          zeusx_share: number
        }[]
      }
      get_reseller_apps_with_total: {
        Args: { p_reseller_id: string }
        Returns: {
          app_name: string
          app_url: string
          created_at: string
          id: string
          monthly_fee: number
          status: string
          total_zeusx_due: number
          zeusx_share: number
        }[]
      }
      get_reseller_debts: {
        Args: never
        Returns: {
          pending_transactions_count: number
          reseller_email: string
          reseller_id: string
          reseller_name: string
          total_debt: number
        }[]
      }
      get_tenant_slots_available: {
        Args: { tenant_id: string }
        Returns: number
      }
      get_user_tenant_ids: {
        Args: { p_user_id: string }
        Returns: {
          tenant_id: string
        }[]
      }
      get_zeusx_total_due: { Args: { p_reseller_id: string }; Returns: number }
      has_feature_access: { Args: { feature_name: string }; Returns: boolean }
      has_table_access: { Args: { table_name: string }; Returns: boolean }
      is_app_accessible: { Args: { p_app_id: string }; Returns: boolean }
      is_member_of_tenant: {
        Args: { tenant_id_to_check: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      mark_reseller_transactions_paid: {
        Args: { p_reseller_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      order_status:
        | "PENDING_CONFIRMATION"
        | "CONFIRMED"
        | "PROCESSING"
        | "COMPLETED"
        | "CANCELLED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: [
        "PENDING_CONFIRMATION",
        "CONFIRMED",
        "PROCESSING",
        "COMPLETED",
        "CANCELLED",
      ],
    },
  },
} as const
