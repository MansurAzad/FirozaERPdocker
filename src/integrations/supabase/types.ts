export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      access_roles: {
        Row: {
          business_id: string;
          created_at: string;
          description: string;
          id: string;
          name: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          description?: string;
          id?: string;
          name: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "access_roles_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      accounts: {
        Row: {
          business_id: string;
          code: string;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        };
        Insert: {
          business_id: string;
          code: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        };
        Update: {
          business_id?: string;
          code?: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          type?: Database["public"]["Enums"]["account_type"];
        };
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          business_id: string;
          created_at: string;
          file_name: string;
          file_size: number | null;
          file_url: string;
          id: string;
          mime_type: string | null;
          note: string | null;
          record_id: string;
          record_type: string;
          uploaded_by: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          file_name: string;
          file_size?: number | null;
          file_url: string;
          id?: string;
          mime_type?: string | null;
          note?: string | null;
          record_id: string;
          record_type: string;
          uploaded_by: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          file_name?: string;
          file_size?: number | null;
          file_url?: string;
          id?: string;
          mime_type?: string | null;
          note?: string | null;
          record_id?: string;
          record_type?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_name: string | null;
          actor_role: string | null;
          business_id: string;
          created_at: string;
          id: number;
          module: string;
          new_value: Json | null;
          old_value: Json | null;
          record_id: string | null;
          source_table: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          actor_name?: string | null;
          actor_role?: string | null;
          business_id: string;
          created_at?: string;
          id?: never;
          module: string;
          new_value?: Json | null;
          old_value?: Json | null;
          record_id?: string | null;
          source_table?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_name?: string | null;
          actor_role?: string | null;
          business_id?: string;
          created_at?: string;
          id?: never;
          module?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          record_id?: string | null;
          source_table?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_notifications: {
        Row: {
          action: string;
          business_id: string;
          created_at: string;
          id: number;
          module: string;
        };
        Insert: {
          action: string;
          business_id: string;
          created_at?: string;
          id?: never;
          module: string;
        };
        Update: {
          action?: string;
          business_id?: string;
          created_at?: string;
          id?: never;
          module?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_notifications_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      backup_history: {
        Row: {
          backup_type: string;
          business_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          duration_seconds: number | null;
          error_message: string | null;
          expires_at: string | null;
          file_name: string;
          file_size: number | null;
          file_url: string;
          id: string;
          record_count: number | null;
          status: string;
          table_count: number | null;
        };
        Insert: {
          backup_type: string;
          business_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_seconds?: number | null;
          error_message?: string | null;
          expires_at?: string | null;
          file_name: string;
          file_size?: number | null;
          file_url: string;
          id?: string;
          record_count?: number | null;
          status?: string;
          table_count?: number | null;
        };
        Update: {
          backup_type?: string;
          business_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_seconds?: number | null;
          error_message?: string | null;
          expires_at?: string | null;
          file_name?: string;
          file_size?: number | null;
          file_url?: string;
          id?: string;
          record_count?: number | null;
          status?: string;
          table_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "backup_history_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      backup_schedules: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string;
          id: string;
          is_active: boolean;
          last_backup_at: string | null;
          next_backup_at: string | null;
          retention_days: number;
          schedule_day: number | null;
          schedule_time: string | null;
          schedule_type: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          is_active?: boolean;
          last_backup_at?: string | null;
          next_backup_at?: string | null;
          retention_days?: number;
          schedule_day?: number | null;
          schedule_time?: string | null;
          schedule_type: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          is_active?: boolean;
          last_backup_at?: string | null;
          next_backup_at?: string | null;
          retention_days?: number;
          schedule_day?: number | null;
          schedule_time?: string | null;
          schedule_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "backup_schedules_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_reconciliation_items: {
        Row: {
          amount: number;
          cleared: boolean;
          created_at: string;
          id: string;
          reconciliation_id: string;
          reference_id: string | null;
          reference_type: string | null;
          transaction_id: string;
          transaction_type: string;
        };
        Insert: {
          amount: number;
          cleared?: boolean;
          created_at?: string;
          id?: string;
          reconciliation_id: string;
          reference_id?: string | null;
          reference_type?: string | null;
          transaction_id: string;
          transaction_type: string;
        };
        Update: {
          amount?: number;
          cleared?: boolean;
          created_at?: string;
          id?: string;
          reconciliation_id?: string;
          reference_id?: string | null;
          reference_type?: string | null;
          transaction_id?: string;
          transaction_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_items_reconciliation_id_fkey";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "bank_reconciliations";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_reconciliations: {
        Row: {
          account_id: string;
          approved_at: string | null;
          approved_by: string | null;
          book_balance: number;
          business_id: string;
          created_at: string;
          created_by: string;
          difference: number;
          id: string;
          note: string | null;
          outstanding_checks: number;
          outstanding_deposits: number;
          reconciliation_date: string;
          statement_balance: number;
          status: string;
        };
        Insert: {
          account_id: string;
          approved_at?: string | null;
          approved_by?: string | null;
          book_balance: number;
          business_id: string;
          created_at?: string;
          created_by?: string;
          difference?: number;
          id?: string;
          note?: string | null;
          outstanding_checks?: number;
          outstanding_deposits?: number;
          reconciliation_date: string;
          statement_balance: number;
          status?: string;
        };
        Update: {
          account_id?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          book_balance?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          difference?: number;
          id?: string;
          note?: string | null;
          outstanding_checks?: number;
          outstanding_deposits?: number;
          reconciliation_date?: string;
          statement_balance?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_reconciliations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          address: string | null;
          business_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["branch_kind"];
          name: string;
          phone: string | null;
          status: Database["public"]["Enums"]["record_status"];
        };
        Insert: {
          address?: string | null;
          business_id: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["branch_kind"];
          name: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Update: {
          address?: string | null;
          business_id?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["branch_kind"];
          name?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Relationships: [
          {
            foreignKeyName: "branches_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brands_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      bulk_price_updates: {
        Row: {
          affected: number;
          applied_at: string | null;
          apply_type: string;
          brand_id: string | null;
          business_id: string;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          note: string | null;
          status: string;
          target: string;
          value: number;
        };
        Insert: {
          affected?: number;
          applied_at?: string | null;
          apply_type?: string;
          brand_id?: string | null;
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          note?: string | null;
          status?: string;
          target?: string;
          value?: number;
        };
        Update: {
          affected?: number;
          applied_at?: string | null;
          apply_type?: string;
          brand_id?: string | null;
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          note?: string | null;
          status?: string;
          target?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "bulk_price_updates_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_members: {
        Row: {
          access_role_id: string | null;
          business_id: string;
          created_at: string;
          display_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Insert: {
          access_role_id?: string | null;
          business_id: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Update: {
          access_role_id?: string | null;
          business_id?: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_access_permissions: {
        Row: {
          access_role_id: string | null;
          allowed: boolean;
          business_id: string;
          created_at: string;
          id: string;
          module: string;
          permission: string;
          user_id: string | null;
        };
        Insert: {
          access_role_id?: string | null;
          allowed: boolean;
          business_id: string;
          created_at?: string;
          id?: string;
          module: string;
          permission: string;
          user_id?: string | null;
        };
        Update: {
          access_role_id?: string | null;
          allowed?: boolean;
          business_id?: string;
          created_at?: string;
          id?: string;
          module?: string;
          permission?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "business_access_permissions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_access_permissions_business_id_access_role_id_fkey";
            columns: ["business_id", "access_role_id"];
            isOneToOne: false;
            referencedRelation: "access_roles";
            referencedColumns: ["business_id", "id"];
          },
        ];
      };
      businesses: {
        Row: {
          address: string | null;
          created_at: string;
          created_by: string;
          currency: string;
          guardian_ai_block: Json | null;
          guardian_profile: Json;
          id: string;
          name: string;
          phone: string | null;
          trade_license: string | null;
          type: Database["public"]["Enums"]["business_type"];
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          created_by?: string;
          currency?: string;
          guardian_ai_block?: Json | null;
          guardian_profile?: Json;
          id?: string;
          name: string;
          phone?: string | null;
          trade_license?: string | null;
          type: Database["public"]["Enums"]["business_type"];
        };
        Update: {
          address?: string | null;
          created_at?: string;
          created_by?: string;
          currency?: string;
          guardian_ai_block?: Json | null;
          guardian_profile?: Json;
          id?: string;
          name?: string;
          phone?: string | null;
          trade_license?: string | null;
          type?: Database["public"]["Enums"]["business_type"];
        };
        Relationships: [];
      };
      categories: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_serialized: boolean;
          name: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_serialized?: boolean;
          name: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_serialized?: boolean;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      commission_rules: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          per_device: number;
          percent: number;
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          per_device?: number;
          percent?: number;
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          per_device?: number;
          percent?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commission_rules_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      commission_transactions: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          created_by: string;
          id: string;
          note: string | null;
          paid_amount: number;
          payment_date: string | null;
          payment_method: string | null;
          pending_amount: number;
          reference_id: string;
          reference_type: string;
          rule_id: string | null;
          salesman_id: string;
          status: string;
          transaction_ref: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          business_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          note?: string | null;
          paid_amount?: number;
          payment_date?: string | null;
          payment_method?: string | null;
          pending_amount?: number;
          reference_id: string;
          reference_type: string;
          rule_id?: string | null;
          salesman_id: string;
          status?: string;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          note?: string | null;
          paid_amount?: number;
          payment_date?: string | null;
          payment_method?: string | null;
          pending_amount?: number;
          reference_id?: string;
          reference_type?: string;
          rule_id?: string | null;
          salesman_id?: string;
          status?: string;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commission_transactions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_transactions_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "commission_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_transactions_salesman_id_fkey";
            columns: ["salesman_id"];
            isOneToOne: false;
            referencedRelation: "salesman_commission_summary";
            referencedColumns: ["salesman_id"];
          },
          {
            foreignKeyName: "commission_transactions_salesman_id_fkey";
            columns: ["salesman_id"];
            isOneToOne: false;
            referencedRelation: "salesmen";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_payment_requests: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          created_by: string;
          customer_id: string;
          description: string | null;
          due_date: string | null;
          id: string;
          paid_at: string | null;
          payment_id: string | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          business_id: string;
          created_at?: string;
          created_by: string;
          customer_id: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          customer_id?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_payment_requests_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payment_requests_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "customer_payment_requests_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payment_requests_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "customer_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_payments: {
        Row: {
          account_id: string;
          amount: number;
          business_id: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          id: string;
          journal_entry_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          money_txn_id: string | null;
          notes: string | null;
          paid_on: string;
          sale_id: string | null;
          txn_ref: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          journal_entry_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          notes?: string | null;
          paid_on?: string;
          sale_id?: string | null;
          txn_ref?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          journal_entry_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          notes?: string | null;
          paid_on?: string;
          sale_id?: string | null;
          txn_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "customer_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_money_txn_id_fkey";
            columns: ["money_txn_id"];
            isOneToOne: false;
            referencedRelation: "money_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_portal_sessions: {
        Row: {
          business_id: string;
          created_at: string;
          customer_id: string;
          id: string;
          ip_address: string | null;
          last_activity_at: string;
          token_id: string;
          user_agent: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          ip_address?: string | null;
          last_activity_at?: string;
          token_id: string;
          user_agent?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          ip_address?: string | null;
          last_activity_at?: string;
          token_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_portal_sessions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_portal_sessions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "customer_portal_sessions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_portal_sessions_token_id_fkey";
            columns: ["token_id"];
            isOneToOne: false;
            referencedRelation: "customer_portal_tokens";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_portal_tokens: {
        Row: {
          business_id: string;
          created_at: string;
          customer_id: string;
          expires_at: string;
          id: string;
          is_active: boolean | null;
          last_used_at: string | null;
          token: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          customer_id: string;
          expires_at: string;
          id?: string;
          is_active?: boolean | null;
          last_used_at?: string | null;
          token: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          customer_id?: string;
          expires_at?: string;
          id?: string;
          is_active?: boolean | null;
          last_used_at?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_portal_tokens_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_portal_tokens_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "customer_portal_tokens_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          address: string | null;
          alt_mobile: string | null;
          business_id: string;
          business_name: string | null;
          created_at: string;
          credit_limit: number;
          dealer_discount: number | null;
          dealer_level: string | null;
          dealer_type: string | null;
          id: string;
          mobile: string;
          name: string;
          nid: string | null;
          notes: string | null;
          opening_balance: number;
          payment_days: number | null;
          payment_terms_days: number;
          price_level: Database["public"]["Enums"]["price_level"];
          status: Database["public"]["Enums"]["record_status"];
          trade_license: string | null;
          type: Database["public"]["Enums"]["customer_type"];
        };
        Insert: {
          address?: string | null;
          alt_mobile?: string | null;
          business_id: string;
          business_name?: string | null;
          created_at?: string;
          credit_limit?: number;
          dealer_discount?: number | null;
          dealer_level?: string | null;
          dealer_type?: string | null;
          id?: string;
          mobile: string;
          name: string;
          nid?: string | null;
          notes?: string | null;
          opening_balance?: number;
          payment_days?: number | null;
          payment_terms_days?: number;
          price_level?: Database["public"]["Enums"]["price_level"];
          status?: Database["public"]["Enums"]["record_status"];
          trade_license?: string | null;
          type?: Database["public"]["Enums"]["customer_type"];
        };
        Update: {
          address?: string | null;
          alt_mobile?: string | null;
          business_id?: string;
          business_name?: string | null;
          created_at?: string;
          credit_limit?: number;
          dealer_discount?: number | null;
          dealer_level?: string | null;
          dealer_type?: string | null;
          id?: string;
          mobile?: string;
          name?: string;
          nid?: string | null;
          notes?: string | null;
          opening_balance?: number;
          payment_days?: number | null;
          payment_terms_days?: number;
          price_level?: Database["public"]["Enums"]["price_level"];
          status?: Database["public"]["Enums"]["record_status"];
          trade_license?: string | null;
          type?: Database["public"]["Enums"]["customer_type"];
        };
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_closings: {
        Row: {
          account_id: string;
          actual: number;
          business_id: string;
          cash_in: number;
          cash_out: number;
          closed_by: string | null;
          closing_date: string;
          created_at: string;
          expected: number;
          id: string;
          note: string | null;
          opening: number;
          variance: number;
        };
        Insert: {
          account_id: string;
          actual: number;
          business_id: string;
          cash_in: number;
          cash_out: number;
          closed_by?: string | null;
          closing_date: string;
          created_at?: string;
          expected: number;
          id?: string;
          note?: string | null;
          opening: number;
          variance: number;
        };
        Update: {
          account_id?: string;
          actual?: number;
          business_id?: string;
          cash_in?: number;
          cash_out?: number;
          closed_by?: string | null;
          closing_date?: string;
          created_at?: string;
          expected?: number;
          id?: string;
          note?: string | null;
          opening?: number;
          variance?: number;
        };
        Relationships: [
          {
            foreignKeyName: "daily_closings_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_closings_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_closings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      dealer_credit: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          business_id: string;
          created_at: string;
          created_by: string;
          credit_limit: number;
          current_due: number;
          customer_id: string;
          id: string;
          last_payment_date: string | null;
          payment_terms_days: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string;
          credit_limit?: number;
          current_due?: number;
          customer_id: string;
          id?: string;
          last_payment_date?: string | null;
          payment_terms_days?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          credit_limit?: number;
          current_due?: number;
          customer_id?: string;
          id?: string;
          last_payment_date?: string | null;
          payment_terms_days?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dealer_credit_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dealer_credit_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "dealer_credit_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      dealer_payments: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          created_by: string;
          customer_id: string;
          id: string;
          note: string | null;
          payment_date: string;
          payment_method: string;
          transaction_ref: string | null;
        };
        Insert: {
          amount: number;
          business_id: string;
          created_at?: string;
          created_by?: string;
          customer_id: string;
          id?: string;
          note?: string | null;
          payment_date: string;
          payment_method: string;
          transaction_ref?: string | null;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          customer_id?: string;
          id?: string;
          note?: string | null;
          payment_date?: string;
          payment_method?: string;
          transaction_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dealer_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dealer_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "dealer_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      emi_installments: {
        Row: {
          amount: number;
          balance: number;
          business_id: string;
          created_at: string;
          due_date: string;
          emi_id: string;
          id: string;
          installment_no: number;
          note: string | null;
          paid_amount: number;
          paid_at: string | null;
          payment_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          balance?: number;
          business_id: string;
          created_at?: string;
          due_date: string;
          emi_id: string;
          id?: string;
          installment_no: number;
          note?: string | null;
          paid_amount?: number;
          paid_at?: string | null;
          payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          balance?: number;
          business_id?: string;
          created_at?: string;
          due_date?: string;
          emi_id?: string;
          id?: string;
          installment_no?: number;
          note?: string | null;
          paid_amount?: number;
          paid_at?: string | null;
          payment_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emi_installments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_installments_emi_id_fkey";
            columns: ["emi_id"];
            isOneToOne: false;
            referencedRelation: "sales_emi";
            referencedColumns: ["id"];
          },
        ];
      };
      emi_payments: {
        Row: {
          account_id: string | null;
          amount: number;
          branch_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          customer_payment_id: string | null;
          emi_id: string;
          id: string;
          installment_id: string | null;
          journal_entry_id: string | null;
          kind: string;
          method: Database["public"]["Enums"]["payment_method"];
          money_txn_id: string | null;
          note: string | null;
          paid_on: string;
          sale_id: string | null;
          txn_ref: string | null;
        };
        Insert: {
          account_id?: string | null;
          amount: number;
          branch_id?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_payment_id?: string | null;
          emi_id: string;
          id?: string;
          installment_id?: string | null;
          journal_entry_id?: string | null;
          kind?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          note?: string | null;
          paid_on?: string;
          sale_id?: string | null;
          txn_ref?: string | null;
        };
        Update: {
          account_id?: string | null;
          amount?: number;
          branch_id?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_payment_id?: string | null;
          emi_id?: string;
          id?: string;
          installment_id?: string | null;
          journal_entry_id?: string | null;
          kind?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          note?: string | null;
          paid_on?: string;
          sale_id?: string | null;
          txn_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "emi_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_customer_payment_id_fkey";
            columns: ["customer_payment_id"];
            isOneToOne: false;
            referencedRelation: "customer_payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_emi_id_fkey";
            columns: ["emi_id"];
            isOneToOne: false;
            referencedRelation: "sales_emi";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_installment_id_fkey";
            columns: ["installment_id"];
            isOneToOne: false;
            referencedRelation: "emi_installments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_money_txn_id_fkey";
            columns: ["money_txn_id"];
            isOneToOne: false;
            referencedRelation: "money_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_payments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      emi_plans: {
        Row: {
          business_id: string;
          created_at: string;
          downpayment_percent: number;
          id: string;
          interest_rate: number;
          name: string;
          processing_fee: number;
          status: Database["public"]["Enums"]["record_status"];
          tenure_months: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          downpayment_percent?: number;
          id?: string;
          interest_rate?: number;
          name: string;
          processing_fee?: number;
          status?: Database["public"]["Enums"]["record_status"];
          tenure_months: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          downpayment_percent?: number;
          id?: string;
          interest_rate?: number;
          name?: string;
          processing_fee?: number;
          status?: Database["public"]["Enums"]["record_status"];
          tenure_months?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emi_plans_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      entity_comments: {
        Row: {
          business_id: string;
          comment: string;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          is_internal: boolean | null;
          metadata: Json | null;
          parent_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          comment: string;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          is_internal?: boolean | null;
          metadata?: Json | null;
          parent_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          comment?: string;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          is_internal?: boolean | null;
          metadata?: Json | null;
          parent_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entity_comments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entity_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "entity_comments";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_categories: {
        Row: {
          account_id: string;
          business_id: string;
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          account_id: string;
          business_id: string;
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          account_id?: string;
          business_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_categories_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_categories_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          account_id: string;
          amount: number;
          branch_id: string;
          business_id: string;
          category_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          expense_date: string;
          id: string;
          journal_entry_id: string | null;
          reversal_reason: string | null;
          reversed_at: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          branch_id: string;
          business_id: string;
          category_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expense_date: string;
          id?: string;
          journal_entry_id?: string | null;
          reversal_reason?: string | null;
          reversed_at?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          branch_id?: string;
          business_id?: string;
          category_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expense_date?: string;
          id?: string;
          journal_entry_id?: string | null;
          reversal_reason?: string | null;
          reversed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_emi: {
        Row: {
          business_id: string;
          closed_at: string | null;
          branch_id: string | null;
          created_at: string;
          closed_by: string | null;
          customer_id: string | null;
          downpayment: number;
          due_day: number;
          financed_amount: number;
          id: string;
          interest_amount: number;
          monthly_amount: number;
          emi_no: string | null;
          notes: string | null;
          plan_id: string | null;
          processing_fee: number;
          sale_id: string;
          settled_amount: number;
          start_date: string;
          status: string;
          tenure_months: number;
          total_amount: number;
          updated_at: string;
          waived_amount: number;
        };
        Insert: {
          business_id: string;
          branch_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          customer_id?: string | null;
          downpayment: number;
          due_day: number;
          financed_amount: number;
          id?: string;
          interest_amount?: number;
          monthly_amount: number;
          emi_no?: string | null;
          notes?: string | null;
          plan_id?: string | null;
          processing_fee?: number;
          sale_id: string;
          settled_amount?: number;
          start_date?: string;
          status?: string;
          tenure_months: number;
          total_amount: number;
          updated_at?: string;
          waived_amount?: number;
        };
        Update: {
          business_id?: string;
          branch_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          customer_id?: string | null;
          downpayment?: number;
          due_day?: number;
          financed_amount?: number;
          id?: string;
          interest_amount?: number;
          monthly_amount?: number;
          emi_no?: string | null;
          notes?: string | null;
          plan_id?: string | null;
          processing_fee?: number;
          sale_id?: string;
          settled_amount?: number;
          start_date?: string;
          status?: string;
          tenure_months?: number;
          total_amount?: number;
          updated_at?: string;
          waived_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sales_emi_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_emi_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_emi_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_emi_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "emi_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_emi_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      export_jobs: {
        Row: {
          business_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          error_message: string | null;
          export_type: string;
          file_name: string;
          file_size: number | null;
          file_url: string | null;
          filters: Json | null;
          format: string;
          id: string;
          record_count: number | null;
          status: string;
        };
        Insert: {
          business_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          error_message?: string | null;
          export_type: string;
          file_name: string;
          file_size?: number | null;
          file_url?: string | null;
          filters?: Json | null;
          format: string;
          id?: string;
          record_count?: number | null;
          status?: string;
        };
        Update: {
          business_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          error_message?: string | null;
          export_type?: string;
          file_name?: string;
          file_size?: number | null;
          file_url?: string | null;
          filters?: Json | null;
          format?: string;
          id?: string;
          record_count?: number | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "export_jobs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_alerts: {
        Row: {
          business_id: string;
          check_code: string;
          detail: string | null;
          fingerprint: string;
          first_seen: string;
          id: string;
          last_seen: string;
          ref_id: string | null;
          ref_type: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: string;
          status: string;
          title: string;
        };
        Insert: {
          business_id: string;
          check_code: string;
          detail?: string | null;
          fingerprint: string;
          first_seen?: string;
          id?: string;
          last_seen?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity: string;
          status?: string;
          title: string;
        };
        Update: {
          business_id?: string;
          check_code?: string;
          detail?: string | null;
          fingerprint?: string;
          first_seen?: string;
          id?: string;
          last_seen?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_alerts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_runs: {
        Row: {
          business_id: string;
          last_run: string;
          summary: Json | null;
        };
        Insert: {
          business_id: string;
          last_run?: string;
          summary?: Json | null;
        };
        Update: {
          business_id?: string;
          last_run?: string;
          summary?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_runs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      import_jobs: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string;
          errors: string[] | null;
          failed_records: number;
          file_name: string;
          file_url: string;
          id: string;
          import_type: string;
          processed_at: string | null;
          processed_by: string | null;
          status: string;
          success_records: number;
          total_records: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string;
          errors?: string[] | null;
          failed_records?: number;
          file_name: string;
          file_url: string;
          id?: string;
          import_type: string;
          processed_at?: string | null;
          processed_by?: string | null;
          status?: string;
          success_records?: number;
          total_records?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string;
          errors?: string[] | null;
          failed_records?: number;
          file_name?: string;
          file_url?: string;
          id?: string;
          import_type?: string;
          processed_at?: string | null;
          processed_by?: string | null;
          status?: string;
          success_records?: number;
          total_records?: number;
        };
        Relationships: [
          {
            foreignKeyName: "import_jobs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_entries: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          entry_date: string;
          entry_no: number;
          id: string;
          memo: string | null;
          ref_id: string | null;
          ref_type: string;
          reversal_of: string | null;
          reversed_at: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          entry_date: string;
          entry_no?: never;
          id?: string;
          memo?: string | null;
          ref_id?: string | null;
          ref_type: string;
          reversal_of?: string | null;
          reversed_at?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          entry_date?: string;
          entry_no?: never;
          id?: string;
          memo?: string | null;
          ref_id?: string | null;
          ref_type?: string;
          reversal_of?: string | null;
          reversed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "journal_entries_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_lines: {
        Row: {
          account_id: string;
          business_id: string;
          credit: number;
          debit: number;
          entry_id: string;
          id: number;
        };
        Insert: {
          account_id: string;
          business_id: string;
          credit?: number;
          debit?: number;
          entry_id: string;
          id?: never;
        };
        Update: {
          account_id?: string;
          business_id?: string;
          credit?: number;
          debit?: number;
          entry_id?: string;
          id?: never;
        };
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      kpi_snapshots: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          kpi_type: string;
          metadata: Json | null;
          snapshot_date: string;
          value: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          kpi_type: string;
          metadata?: Json | null;
          snapshot_date: string;
          value: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          kpi_type?: string;
          metadata?: Json | null;
          snapshot_date?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "kpi_snapshots_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      label_templates: {
        Row: {
          barcode_format: string;
          business_id: string;
          cols: number;
          created_at: string;
          height_mm: number;
          id: string;
          is_default: boolean;
          kind: string;
          name: string;
          paper: string;
          rows: number;
          show_name: boolean;
          show_price: boolean;
          show_sku: boolean;
          updated_at: string;
          width_mm: number;
        };
        Insert: {
          barcode_format?: string;
          business_id: string;
          cols?: number;
          created_at?: string;
          height_mm?: number;
          id?: string;
          is_default?: boolean;
          kind?: string;
          name: string;
          paper?: string;
          rows?: number;
          show_name?: boolean;
          show_price?: boolean;
          show_sku?: boolean;
          updated_at?: string;
          width_mm?: number;
        };
        Update: {
          barcode_format?: string;
          business_id?: string;
          cols?: number;
          created_at?: string;
          height_mm?: number;
          id?: string;
          is_default?: boolean;
          kind?: string;
          name?: string;
          paper?: string;
          rows?: number;
          show_name?: boolean;
          show_price?: boolean;
          show_sku?: boolean;
          updated_at?: string;
          width_mm?: number;
        };
        Relationships: [
          {
            foreignKeyName: "label_templates_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      money_accounts: {
        Row: {
          account_no: string | null;
          bank_branch: string | null;
          bank_name: string | null;
          branch_id: string | null;
          business_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["money_kind"];
          last_reconciled_at: string | null;
          last_reconciled_by: string | null;
          ledger_account_id: string;
          name: string;
          opening_balance: number;
          statement_closing_balance: number | null;
          status: Database["public"]["Enums"]["record_status"];
        };
        Insert: {
          account_no?: string | null;
          bank_branch?: string | null;
          bank_name?: string | null;
          branch_id?: string | null;
          business_id: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["money_kind"];
          last_reconciled_at?: string | null;
          last_reconciled_by?: string | null;
          ledger_account_id: string;
          name: string;
          opening_balance?: number;
          statement_closing_balance?: number | null;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Update: {
          account_no?: string | null;
          bank_branch?: string | null;
          bank_name?: string | null;
          branch_id?: string | null;
          business_id?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["money_kind"];
          last_reconciled_at?: string | null;
          last_reconciled_by?: string | null;
          ledger_account_id?: string;
          name?: string;
          opening_balance?: number;
          statement_closing_balance?: number | null;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Relationships: [
          {
            foreignKeyName: "money_accounts_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "money_accounts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "money_accounts_ledger_account_id_fkey";
            columns: ["ledger_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      money_transactions: {
        Row: {
          account_id: string;
          amount: number;
          business_id: string;
          created_at: string;
          created_by: string | null;
          direction: string;
          id: string;
          journal_entry_id: string | null;
          kind: string;
          method: Database["public"]["Enums"]["payment_method"] | null;
          note: string | null;
          ref_id: string | null;
          ref_type: string | null;
          reversal_of: string | null;
          reversed_at: string | null;
          txn_date: string;
          txn_ref: string | null;
        };
        Insert: {
          account_id: string;
          amount: number;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          direction: string;
          id?: string;
          journal_entry_id?: string | null;
          kind: string;
          method?: Database["public"]["Enums"]["payment_method"] | null;
          note?: string | null;
          ref_id?: string | null;
          ref_type?: string | null;
          reversal_of?: string | null;
          reversed_at?: string | null;
          txn_date: string;
          txn_ref?: string | null;
        };
        Update: {
          account_id?: string;
          amount?: number;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          direction?: string;
          id?: string;
          journal_entry_id?: string | null;
          kind?: string;
          method?: Database["public"]["Enums"]["payment_method"] | null;
          note?: string | null;
          ref_id?: string | null;
          ref_type?: string | null;
          reversal_of?: string | null;
          reversed_at?: string | null;
          txn_date?: string;
          txn_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "money_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "money_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "money_transactions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "money_transactions_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      page_visits: {
        Row: {
          business_id: string;
          device: string | null;
          id: string;
          path: string;
          session_id: string;
          user_id: string;
          visited_at: string;
        };
        Insert: {
          business_id: string;
          device?: string | null;
          id?: string;
          path: string;
          session_id: string;
          user_id?: string;
          visited_at?: string;
        };
        Update: {
          business_id?: string;
          device?: string | null;
          id?: string;
          path?: string;
          session_id?: string;
          user_id?: string;
          visited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_visits_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      product_imeis: {
        Row: {
          branch_id: string;
          business_id: string;
          cost: number;
          created_at: string;
          id: string;
          imei1: string;
          imei2: string | null;
          purchase_item_id: string | null;
          sale_item_id: string | null;
          serial_no: string | null;
          status: Database["public"]["Enums"]["imei_status"];
          variant_id: string;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          cost?: number;
          created_at?: string;
          id?: string;
          imei1: string;
          imei2?: string | null;
          purchase_item_id?: string | null;
          sale_item_id?: string | null;
          serial_no?: string | null;
          status?: Database["public"]["Enums"]["imei_status"];
          variant_id: string;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          cost?: number;
          created_at?: string;
          id?: string;
          imei1?: string;
          imei2?: string | null;
          purchase_item_id?: string | null;
          sale_item_id?: string | null;
          serial_no?: string | null;
          status?: Database["public"]["Enums"]["imei_status"];
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_imeis_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_imeis_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_imeis_purchase_item_id_fkey";
            columns: ["purchase_item_id"];
            isOneToOne: false;
            referencedRelation: "purchase_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_imeis_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_imeis_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          business_id: string;
          color: string | null;
          created_at: string;
          dealer_price: number;
          id: string;
          min_price: number;
          product_id: string;
          purchase_price: number;
          ram: string | null;
          reorder_level: number;
          retail_price: number;
          sku: string;
          status: Database["public"]["Enums"]["record_status"];
          storage: string | null;
          warranty_months: number;
          wholesale_price: number;
        };
        Insert: {
          business_id: string;
          color?: string | null;
          created_at?: string;
          dealer_price?: number;
          id?: string;
          min_price?: number;
          product_id: string;
          purchase_price?: number;
          ram?: string | null;
          reorder_level?: number;
          retail_price?: number;
          sku: string;
          status?: Database["public"]["Enums"]["record_status"];
          storage?: string | null;
          warranty_months?: number;
          wholesale_price?: number;
        };
        Update: {
          business_id?: string;
          color?: string | null;
          created_at?: string;
          dealer_price?: number;
          id?: string;
          min_price?: number;
          product_id?: string;
          purchase_price?: number;
          ram?: string | null;
          reorder_level?: number;
          retail_price?: number;
          sku?: string;
          status?: Database["public"]["Enums"]["record_status"];
          storage?: string | null;
          warranty_months?: number;
          wholesale_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          brand_id: string;
          business_id: string;
          category_id: string;
          created_at: string;
          id: string;
          model: string;
          status: Database["public"]["Enums"]["record_status"];
        };
        Insert: {
          brand_id: string;
          business_id: string;
          category_id: string;
          created_at?: string;
          id?: string;
          model: string;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Update: {
          brand_id?: string;
          business_id?: string;
          category_id?: string;
          created_at?: string;
          id?: string;
          model?: string;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_items: {
        Row: {
          business_id: string;
          id: string;
          landed_unit_cost: number;
          line_total: number;
          purchase_id: string;
          qty: number;
          rate: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          id?: string;
          landed_unit_cost: number;
          line_total: number;
          purchase_id: string;
          qty: number;
          rate: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          id?: string;
          landed_unit_cost?: number;
          line_total?: number;
          purchase_id?: string;
          qty?: number;
          rate?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_items: {
        Row: {
          business_id: string;
          created_at: string;
          discount: number;
          id: string;
          line_total: number;
          po_id: string;
          price: number;
          qty: number;
          received_qty: number;
          sort_order: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          discount?: number;
          id?: string;
          line_total?: number;
          po_id: string;
          price?: number;
          qty: number;
          received_qty?: number;
          sort_order?: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          discount?: number;
          id?: string;
          line_total?: number;
          po_id?: string;
          price?: number;
          qty?: number;
          received_qty?: number;
          sort_order?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_items_po_id_fkey";
            columns: ["po_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          branch_id: string;
          business_id: string;
          created_at: string;
          created_by: string | null;
          discount: number;
          expected_date: string | null;
          id: string;
          notes: string | null;
          po_date: string;
          po_no: string;
          status: string;
          subtotal: number;
          supplier_id: string;
          tax: number;
          terms: string | null;
          total: number;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          branch_id: string;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          expected_date?: string | null;
          id?: string;
          notes?: string | null;
          po_date?: string;
          po_no: string;
          status?: string;
          subtotal?: number;
          supplier_id: string;
          tax?: number;
          terms?: string | null;
          total?: number;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          branch_id?: string;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          expected_date?: string | null;
          id?: string;
          notes?: string | null;
          po_date?: string;
          po_no?: string;
          status?: string;
          subtotal?: number;
          supplier_id?: string;
          tax?: number;
          terms?: string | null;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_return_items: {
        Row: {
          business_id: string;
          id: string;
          imei_id: string | null;
          purchase_item_id: string;
          qty: number;
          return_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          id?: string;
          imei_id?: string | null;
          purchase_item_id: string;
          qty: number;
          return_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          id?: string;
          imei_id?: string | null;
          purchase_item_id?: string;
          qty?: number;
          return_id?: string;
          unit_cost?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_return_items_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_return_items_purchase_item_id_fkey";
            columns: ["purchase_item_id"];
            isOneToOne: false;
            referencedRelation: "purchase_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "purchase_returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_return_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_returns: {
        Row: {
          branch_id: string;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          purchase_id: string;
          reason: string | null;
          refund: number;
          return_date: string;
          return_no: string;
          supplier_id: string;
          total: number;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          purchase_id: string;
          reason?: string | null;
          refund?: number;
          return_date?: string;
          return_no: string;
          supplier_id: string;
          total?: number;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          purchase_id?: string;
          reason?: string | null;
          refund?: number;
          return_date?: string;
          return_no?: string;
          supplier_id?: string;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_returns_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "supplier_balances";
            referencedColumns: ["supplier_id"];
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      purchases: {
        Row: {
          branch_id: string;
          business_id: string;
          courier_cost: number;
          created_at: string;
          created_by: string | null;
          discount: number;
          due: number;
          id: string;
          insurance_cost: number;
          invoice_no: string;
          loading_cost: number;
          notes: string | null;
          other_cost: number;
          paid: number;
          purchase_date: string;
          status: string;
          subtotal: number;
          supplier_id: string;
          supplier_invoice_no: string | null;
          tax: number;
          total: number;
          transport_cost: number;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          courier_cost?: number;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          due?: number;
          id?: string;
          insurance_cost?: number;
          invoice_no: string;
          loading_cost?: number;
          notes?: string | null;
          other_cost?: number;
          paid?: number;
          purchase_date?: string;
          status?: string;
          subtotal?: number;
          supplier_id: string;
          supplier_invoice_no?: string | null;
          tax?: number;
          total?: number;
          transport_cost?: number;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          courier_cost?: number;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          due?: number;
          id?: string;
          insurance_cost?: number;
          invoice_no?: string;
          loading_cost?: number;
          notes?: string | null;
          other_cost?: number;
          paid?: number;
          purchase_date?: string;
          status?: string;
          subtotal?: number;
          supplier_id?: string;
          supplier_invoice_no?: string | null;
          tax?: number;
          total?: number;
          transport_cost?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchases_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "supplier_balances";
            referencedColumns: ["supplier_id"];
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      quotation_items: {
        Row: {
          business_id: string;
          created_at: string;
          description: string | null;
          discount: number;
          id: string;
          line_total: number;
          price: number;
          qty: number;
          quotation_id: string;
          sort_order: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          description?: string | null;
          discount?: number;
          id?: string;
          line_total: number;
          price: number;
          qty: number;
          quotation_id: string;
          sort_order?: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          description?: string | null;
          discount?: number;
          id?: string;
          line_total?: number;
          price?: number;
          qty?: number;
          quotation_id?: string;
          sort_order?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotation_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey";
            columns: ["quotation_id"];
            isOneToOne: false;
            referencedRelation: "quotations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotation_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      quotations: {
        Row: {
          branch_id: string;
          business_id: string;
          converted_sale_id: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          discount: number;
          doc_discount: number;
          doc_type: string;
          id: string;
          notes: string | null;
          price_level: Database["public"]["Enums"]["price_level"];
          quote_date: string;
          quote_no: string;
          status: string;
          subtotal: number;
          tax: number;
          terms: string | null;
          total: number;
          updated_at: string;
          valid_until: string | null;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          converted_sale_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          doc_discount?: number;
          doc_type?: string;
          id?: string;
          notes?: string | null;
          price_level?: Database["public"]["Enums"]["price_level"];
          quote_date?: string;
          quote_no: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          terms?: string | null;
          total?: number;
          updated_at?: string;
          valid_until?: string | null;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          converted_sale_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          doc_discount?: number;
          doc_type?: string;
          id?: string;
          notes?: string | null;
          price_level?: Database["public"]["Enums"]["price_level"];
          quote_date?: string;
          quote_no?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          terms?: string | null;
          total?: number;
          updated_at?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quotations_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_converted_sale_id_fkey";
            columns: ["converted_sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          business_id: string;
          created_at: string;
          description: string | null;
          discount: number;
          id: string;
          line_total: number;
          order_id: string;
          price: number;
          qty: number;
          sort_order: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          description?: string | null;
          discount?: number;
          id?: string;
          line_total: number;
          order_id: string;
          price: number;
          qty: number;
          sort_order?: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          description?: string | null;
          discount?: number;
          id?: string;
          line_total?: number;
          order_id?: string;
          price?: number;
          qty?: number;
          sort_order?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_payments: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          id: string;
          method: string;
          note: string | null;
          order_id: string;
          payment_date: string;
          received_by: string | null;
          reference: string | null;
        };
        Insert: {
          amount: number;
          business_id: string;
          created_at?: string;
          id?: string;
          method?: string;
          note?: string | null;
          order_id: string;
          payment_date?: string;
          received_by?: string | null;
          reference?: string | null;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          id?: string;
          method?: string;
          note?: string | null;
          order_id?: string;
          payment_date?: string;
          received_by?: string | null;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          balance: number;
          branch_id: string;
          business_id: string;
          converted_sale_id: string | null;
          courier_name: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          delivery_address: string | null;
          delivery_city: string | null;
          delivery_date: string | null;
          delivery_note: string | null;
          deposit: number;
          discount: number;
          id: string;
          notes: string | null;
          order_date: string;
          order_no: string;
          order_type: string;
          status: string;
          subtotal: number;
          tax: number;
          terms: string | null;
          total: number;
          tracking_no: string | null;
          updated_at: string;
        };
        Insert: {
          balance?: number;
          branch_id: string;
          business_id: string;
          converted_sale_id?: string | null;
          courier_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          delivery_address?: string | null;
          delivery_city?: string | null;
          delivery_date?: string | null;
          delivery_note?: string | null;
          deposit?: number;
          discount?: number;
          id?: string;
          notes?: string | null;
          order_date?: string;
          order_no: string;
          order_type?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          terms?: string | null;
          total?: number;
          tracking_no?: string | null;
          updated_at?: string;
        };
        Update: {
          balance?: number;
          branch_id?: string;
          business_id?: string;
          converted_sale_id?: string | null;
          courier_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          delivery_address?: string | null;
          delivery_city?: string | null;
          delivery_date?: string | null;
          delivery_note?: string | null;
          deposit?: number;
          discount?: number;
          id?: string;
          notes?: string | null;
          order_date?: string;
          order_no?: string;
          order_type?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          terms?: string | null;
          total?: number;
          tracking_no?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_converted_sale_id_fkey";
            columns: ["converted_sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      realtime_subscriptions: {
        Row: {
          business_id: string;
          channel: string;
          id: string;
          last_activity_at: string;
          subscribed_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          channel: string;
          id?: string;
          last_activity_at?: string;
          subscribed_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          channel?: string;
          id?: string;
          last_activity_at?: string;
          subscribed_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "realtime_subscriptions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      report_executions: {
        Row: {
          business_id: string;
          created_at: string;
          error_message: string | null;
          executed_by: string | null;
          execution_time_ms: number | null;
          execution_type: string | null;
          file_url: string | null;
          id: string;
          row_count: number | null;
          saved_report_id: string | null;
          status: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          error_message?: string | null;
          executed_by?: string | null;
          execution_time_ms?: number | null;
          execution_type?: string | null;
          file_url?: string | null;
          id?: string;
          row_count?: number | null;
          saved_report_id?: string | null;
          status?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          error_message?: string | null;
          executed_by?: string | null;
          execution_time_ms?: number | null;
          execution_type?: string | null;
          file_url?: string | null;
          id?: string;
          row_count?: number | null;
          saved_report_id?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_executions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_executions_saved_report_id_fkey";
            columns: ["saved_report_id"];
            isOneToOne: false;
            referencedRelation: "saved_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      report_recipients: {
        Row: {
          business_id: string;
          created_at: string;
          email: string;
          id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          email: string;
          id?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          email?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_recipients_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_items: {
        Row: {
          business_id: string;
          id: string;
          imei_id: string | null;
          line_total: number;
          price: number;
          qty: number;
          sale_id: string;
          unit_cost: number;
          variant_id: string;
          warranty_months: number;
        };
        Insert: {
          business_id: string;
          id?: string;
          imei_id?: string | null;
          line_total: number;
          price: number;
          qty: number;
          sale_id: string;
          unit_cost?: number;
          variant_id: string;
          warranty_months?: number;
        };
        Update: {
          business_id?: string;
          id?: string;
          imei_id?: string | null;
          line_total?: number;
          price?: number;
          qty?: number;
          sale_id?: string;
          unit_cost?: number;
          variant_id?: string;
          warranty_months?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          branch_id: string;
          business_id: string;
          cogs: number;
          created_at: string;
          created_by: string | null;
          credit_override_by: string | null;
          customer_id: string | null;
          discount: number;
          due: number;
          id: string;
          invoice_no: string;
          notes: string | null;
          paid: number;
          partner_financed: boolean;
          price_level: Database["public"]["Enums"]["price_level"];
          sale_date: string;
          status: string;
          subtotal: number;
          tax: number;
          total: number;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          cogs?: number;
          created_at?: string;
          created_by?: string | null;
          credit_override_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          due?: number;
          id?: string;
          invoice_no: string;
          notes?: string | null;
          paid?: number;
          partner_financed?: boolean;
          price_level?: Database["public"]["Enums"]["price_level"];
          sale_date?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          total?: number;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          cogs?: number;
          created_at?: string;
          created_by?: string | null;
          credit_override_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          due?: number;
          id?: string;
          invoice_no?: string;
          notes?: string | null;
          paid?: number;
          partner_financed?: boolean;
          price_level?: Database["public"]["Enums"]["price_level"];
          sale_date?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_return_items: {
        Row: {
          business_id: string;
          id: string;
          imei_id: string | null;
          price: number;
          qty: number;
          return_id: string;
          sale_item_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          id?: string;
          imei_id?: string | null;
          price: number;
          qty: number;
          return_id: string;
          sale_item_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          id?: string;
          imei_id?: string | null;
          price?: number;
          qty?: number;
          return_id?: string;
          sale_item_id?: string;
          unit_cost?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_return_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_return_items_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_return_items_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "sales_returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_return_items_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_return_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_returns: {
        Row: {
          branch_id: string;
          business_id: string;
          cost_total: number;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          discount_share: number;
          gross: number;
          id: string;
          reason: string | null;
          refund: number;
          return_date: string;
          return_no: string;
          sale_id: string;
          tax_share: number;
          total: number;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          cost_total?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount_share?: number;
          gross?: number;
          id?: string;
          reason?: string | null;
          refund?: number;
          return_date?: string;
          return_no: string;
          sale_id: string;
          tax_share?: number;
          total?: number;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          cost_total?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount_share?: number;
          gross?: number;
          id?: string;
          reason?: string | null;
          refund?: number;
          return_date?: string;
          return_no?: string;
          sale_id?: string;
          tax_share?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sales_returns_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_returns_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_returns_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "sales_returns_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_returns_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      salesmen: {
        Row: {
          address: string | null;
          business_id: string;
          created_at: string;
          created_by: string;
          email: string | null;
          id: string;
          join_date: string;
          mobile: string | null;
          name: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          address?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          join_date?: string;
          mobile?: string | null;
          name: string;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          address?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          join_date?: string;
          mobile?: string | null;
          name?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "salesmen_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_reports: {
        Row: {
          business_id: string;
          columns: Json | null;
          created_at: string;
          description: string | null;
          filters: Json | null;
          id: string;
          is_public: boolean | null;
          is_scheduled: boolean | null;
          last_run_at: string | null;
          name: string;
          report_type: string;
          schedule_cron: string | null;
          sort_by: Json | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          columns?: Json | null;
          created_at?: string;
          description?: string | null;
          filters?: Json | null;
          id?: string;
          is_public?: boolean | null;
          is_scheduled?: boolean | null;
          last_run_at?: string | null;
          name: string;
          report_type: string;
          schedule_cron?: string | null;
          sort_by?: Json | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          columns?: Json | null;
          created_at?: string;
          description?: string | null;
          filters?: Json | null;
          id?: string;
          is_public?: boolean | null;
          is_scheduled?: boolean | null;
          last_run_at?: string | null;
          name?: string;
          report_type?: string;
          schedule_cron?: string | null;
          sort_by?: Json | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_reports_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      service_items: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          description: string;
          id: string;
          job_id: string;
          qty: number;
          unit_price: number;
        };
        Insert: {
          amount?: number;
          business_id: string;
          created_at?: string;
          description: string;
          id?: string;
          job_id: string;
          qty?: number;
          unit_price?: number;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          job_id?: string;
          qty?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "service_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      service_jobs: {
        Row: {
          actual_delivery: string | null;
          advance: number;
          assigned_to: string | null;
          balance: number;
          branch_id: string;
          brand: string | null;
          business_id: string;
          created_at: string;
          customer_id: string | null;
          device_type: string | null;
          estimated_cost: number;
          estimated_delivery: string | null;
          id: string;
          job_no: string;
          labor_cost: number;
          model: string | null;
          note: string | null;
          parts_cost: number;
          problem: string | null;
          received_at: string;
          serial_imei: string | null;
          status: string;
          technician_id: string | null;
          total_cost: number;
          updated_at: string;
        };
        Insert: {
          actual_delivery?: string | null;
          advance?: number;
          assigned_to?: string | null;
          balance?: number;
          branch_id: string;
          brand?: string | null;
          business_id: string;
          created_at?: string;
          customer_id?: string | null;
          device_type?: string | null;
          estimated_cost?: number;
          estimated_delivery?: string | null;
          id?: string;
          job_no: string;
          labor_cost?: number;
          model?: string | null;
          note?: string | null;
          parts_cost?: number;
          problem?: string | null;
          received_at?: string;
          serial_imei?: string | null;
          status?: string;
          technician_id?: string | null;
          total_cost?: number;
          updated_at?: string;
        };
        Update: {
          actual_delivery?: string | null;
          advance?: number;
          assigned_to?: string | null;
          balance?: number;
          branch_id?: string;
          brand?: string | null;
          business_id?: string;
          created_at?: string;
          customer_id?: string | null;
          device_type?: string | null;
          estimated_cost?: number;
          estimated_delivery?: string | null;
          id?: string;
          job_no?: string;
          labor_cost?: number;
          model?: string | null;
          note?: string | null;
          parts_cost?: number;
          problem?: string | null;
          received_at?: string;
          serial_imei?: string | null;
          status?: string;
          technician_id?: string | null;
          total_cost?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_jobs_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      site_branding: {
        Row: {
          business_id: string;
          id: string;
          name: string;
          singleton: boolean;
        };
        Insert: {
          business_id: string;
          id?: string;
          name: string;
          singleton?: boolean;
        };
        Update: {
          business_id?: string;
          id?: string;
          name?: string;
          singleton?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "site_branding_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_adjustment_items: {
        Row: {
          adjustment_id: string;
          business_id: string;
          created_at: string;
          current_qty: number;
          diff: number;
          id: string;
          new_qty: number;
          note: string | null;
          unit_cost: number;
          variant_id: string;
        };
        Insert: {
          adjustment_id: string;
          business_id: string;
          created_at?: string;
          current_qty?: number;
          diff?: number;
          id?: string;
          new_qty?: number;
          note?: string | null;
          unit_cost?: number;
          variant_id: string;
        };
        Update: {
          adjustment_id?: string;
          business_id?: string;
          created_at?: string;
          current_qty?: number;
          diff?: number;
          id?: string;
          new_qty?: number;
          note?: string | null;
          unit_cost?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_items_adjustment_id_fkey";
            columns: ["adjustment_id"];
            isOneToOne: false;
            referencedRelation: "stock_adjustments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_adjustment_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_adjustment_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_adjustments: {
        Row: {
          adj_date: string;
          adj_no: string;
          adj_type: string;
          branch_id: string;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          posted_at: string | null;
          posted_by: string | null;
          reason: string | null;
          status: string;
          total_value: number;
          updated_at: string;
        };
        Insert: {
          adj_date?: string;
          adj_no: string;
          adj_type?: string;
          branch_id: string;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          posted_at?: string | null;
          posted_by?: string | null;
          reason?: string | null;
          status?: string;
          total_value?: number;
          updated_at?: string;
        };
        Update: {
          adj_date?: string;
          adj_no?: string;
          adj_type?: string;
          branch_id?: string;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          posted_at?: string | null;
          posted_by?: string | null;
          reason?: string | null;
          status?: string;
          total_value?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_adjustments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock: {
        Row: {
          avg_cost: number;
          branch_id: string;
          business_id: string;
          qty: number;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          avg_cost?: number;
          branch_id: string;
          business_id: string;
          qty?: number;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          avg_cost?: number;
          branch_id?: string;
          business_id?: string;
          qty?: number;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          branch_id: string;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: number;
          imei_id: string | null;
          qty_change: number;
          ref_id: string;
          ref_type: string;
          unit_cost: number;
          variant_id: string;
        };
        Insert: {
          branch_id: string;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          imei_id?: string | null;
          qty_change: number;
          ref_id: string;
          ref_type: string;
          unit_cost?: number;
          variant_id: string;
        };
        Update: {
          branch_id?: string;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          imei_id?: string | null;
          qty_change?: number;
          ref_id?: string;
          ref_type?: string;
          unit_cost?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfer_approvals: {
        Row: {
          action: string;
          approved_by: string;
          business_id: string;
          comments: string | null;
          created_at: string;
          id: string;
          transfer_id: string;
        };
        Insert: {
          action: string;
          approved_by: string;
          business_id: string;
          comments?: string | null;
          created_at?: string;
          id?: string;
          transfer_id: string;
        };
        Update: {
          action?: string;
          approved_by?: string;
          business_id?: string;
          comments?: string | null;
          created_at?: string;
          id?: string;
          transfer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfer_approvals_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_approvals_transfer_id_fkey";
            columns: ["transfer_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfers";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfer_items: {
        Row: {
          business_id: string;
          id: string;
          imei_id: string | null;
          qty: number;
          transfer_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Insert: {
          business_id: string;
          id?: string;
          imei_id?: string | null;
          qty: number;
          transfer_id: string;
          unit_cost: number;
          variant_id: string;
        };
        Update: {
          business_id?: string;
          id?: string;
          imei_id?: string | null;
          qty?: number;
          transfer_id?: string;
          unit_cost?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_items_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey";
            columns: ["transfer_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfers: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          from_branch_id: string;
          id: string;
          notes: string | null;
          received_at: string | null;
          received_by: string | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejection_reason: string | null;
          status: string;
          to_branch_id: string;
          transfer_date: string;
          transfer_no: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          from_branch_id: string;
          id?: string;
          notes?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          status?: string;
          to_branch_id: string;
          transfer_date?: string;
          transfer_no: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          from_branch_id?: string;
          id?: string;
          notes?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          status?: string;
          to_branch_id?: string;
          transfer_date?: string;
          transfer_no?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_from_branch_id_fkey";
            columns: ["from_branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_to_branch_id_fkey";
            columns: ["to_branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_payments: {
        Row: {
          amount: number;
          branch_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          journal_entry_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          money_txn_id: string | null;
          notes: string | null;
          paid_on: string;
          purchase_id: string | null;
          supplier_id: string;
          txn_ref: string | null;
        };
        Insert: {
          amount: number;
          branch_id?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          journal_entry_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          notes?: string | null;
          paid_on?: string;
          purchase_id?: string | null;
          supplier_id: string;
          txn_ref?: string | null;
        };
        Update: {
          amount?: number;
          branch_id?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          journal_entry_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          money_txn_id?: string | null;
          notes?: string | null;
          paid_on?: string;
          purchase_id?: string | null;
          supplier_id?: string;
          txn_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_payments_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_money_txn_id_fkey";
            columns: ["money_txn_id"];
            isOneToOne: false;
            referencedRelation: "money_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "supplier_balances";
            referencedColumns: ["supplier_id"];
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          address: string | null;
          bank_info: string | null;
          business_id: string;
          company: string | null;
          contact_person: string | null;
          created_at: string;
          credit_terms_days: number;
          id: string;
          mobile: string;
          name: string;
          notes: string | null;
          opening_payable: number;
          status: Database["public"]["Enums"]["record_status"];
        };
        Insert: {
          address?: string | null;
          bank_info?: string | null;
          business_id: string;
          company?: string | null;
          contact_person?: string | null;
          created_at?: string;
          credit_terms_days?: number;
          id?: string;
          mobile: string;
          name: string;
          notes?: string | null;
          opening_payable?: number;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Update: {
          address?: string | null;
          bank_info?: string | null;
          business_id?: string;
          company?: string | null;
          contact_person?: string | null;
          created_at?: string;
          credit_terms_days?: number;
          id?: string;
          mobile?: string;
          name?: string;
          notes?: string | null;
          opening_payable?: number;
          status?: Database["public"]["Enums"]["record_status"];
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_to: string | null;
          business_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          due_date: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json | null;
          priority: string | null;
          status: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          business_id: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          due_date?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json | null;
          priority?: string | null;
          status?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          business_id?: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json | null;
          priority?: string | null;
          status?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_activities: {
        Row: {
          activity_type: string;
          business_id: string;
          created_at: string;
          description: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          ip_address: string | null;
          metadata: Json | null;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          activity_type: string;
          business_id: string;
          created_at?: string;
          description: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          activity_type?: string;
          business_id?: string;
          created_at?: string;
          description?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_activities_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_notifications: {
        Row: {
          business_id: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          link: string | null;
          message: string;
          metadata: Json | null;
          read_at: string | null;
          title: string;
          type: string | null;
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          message: string;
          metadata?: Json | null;
          read_at?: string | null;
          title: string;
          type?: string | null;
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          message?: string;
          metadata?: Json | null;
          read_at?: string | null;
          title?: string;
          type?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_notifications_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_report_favorites: {
        Row: {
          created_at: string;
          id: string;
          saved_report_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          saved_report_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          saved_report_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_report_favorites_saved_report_id_fkey";
            columns: ["saved_report_id"];
            isOneToOne: false;
            referencedRelation: "saved_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      warranty_claims: {
        Row: {
          business_id: string;
          claim_date: string;
          claim_no: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          id: string;
          imei_id: string;
          issue: string;
          resolution: string | null;
          sale_item_id: string | null;
          status: string;
          updated_at: string;
          warranty_end: string | null;
        };
        Insert: {
          business_id: string;
          claim_date?: string;
          claim_no: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          imei_id: string;
          issue: string;
          resolution?: string | null;
          sale_item_id?: string | null;
          status?: string;
          updated_at?: string;
          warranty_end?: string | null;
        };
        Update: {
          business_id?: string;
          claim_date?: string;
          claim_no?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          imei_id?: string;
          issue?: string;
          resolution?: string | null;
          sale_item_id?: string | null;
          status?: string;
          updated_at?: string;
          warranty_end?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "warranty_claims_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_claims_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "warranty_claims_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_claims_imei_id_fkey";
            columns: ["imei_id"];
            isOneToOne: false;
            referencedRelation: "product_imeis";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_claims_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      bank_reconciliation_summary: {
        Row: {
          account_id: string | null;
          book_balance: number | null;
          business_id: string | null;
          created_at: string | null;
          created_by: string | null;
          difference: number | null;
          reconciliation_date: string | null;
          statement_balance: number | null;
          status: string | null;
        };
        Insert: {
          account_id?: string | null;
          book_balance?: number | null;
          business_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          difference?: number | null;
          reconciliation_date?: string | null;
          statement_balance?: number | null;
          status?: string | null;
        };
        Update: {
          account_id?: string | null;
          book_balance?: number | null;
          business_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          difference?: number | null;
          reconciliation_date?: string | null;
          statement_balance?: number | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_account_balances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_reconciliations_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "money_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_reconciliations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_balances: {
        Row: {
          business_id: string | null;
          business_name: string | null;
          credit_limit: number | null;
          current_due: number | null;
          customer_id: string | null;
          last_payment: string | null;
          last_sale: string | null;
          mobile: string | null;
          name: string | null;
          opening_balance: number | null;
          payment_terms_days: number | null;
          payments_total: number | null;
          returns_total: number | null;
          sales_total: number | null;
          type: Database["public"]["Enums"]["customer_type"] | null;
        };
        Insert: {
          business_id?: string | null;
          business_name?: string | null;
          credit_limit?: number | null;
          current_due?: never;
          customer_id?: string | null;
          last_payment?: never;
          last_sale?: never;
          mobile?: string | null;
          name?: string | null;
          opening_balance?: number | null;
          payment_terms_days?: number | null;
          payments_total?: never;
          returns_total?: never;
          sales_total?: never;
          type?: Database["public"]["Enums"]["customer_type"] | null;
        };
        Update: {
          business_id?: string | null;
          business_name?: string | null;
          credit_limit?: number | null;
          current_due?: never;
          customer_id?: string | null;
          last_payment?: never;
          last_sale?: never;
          mobile?: string | null;
          name?: string | null;
          opening_balance?: number | null;
          payment_terms_days?: number | null;
          payments_total?: never;
          returns_total?: never;
          sales_total?: never;
          type?: Database["public"]["Enums"]["customer_type"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      dealer_outstanding: {
        Row: {
          business_id: string | null;
          credit_limit: number | null;
          current_due: number | null;
          customer_id: string | null;
          days_since_last_payment: number | null;
          mobile: string | null;
          name: string | null;
          payment_terms_days: number | null;
          status: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dealer_credit_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dealer_credit_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customer_balances";
            referencedColumns: ["customer_id"];
          },
          {
            foreignKeyName: "dealer_credit_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      money_account_balances: {
        Row: {
          account_no: string | null;
          balance: number | null;
          bank_branch: string | null;
          bank_name: string | null;
          business_id: string | null;
          id: string | null;
          kind: Database["public"]["Enums"]["money_kind"] | null;
          name: string | null;
          opening_balance: number | null;
          status: Database["public"]["Enums"]["record_status"] | null;
        };
        Insert: {
          account_no?: string | null;
          balance?: never;
          bank_branch?: string | null;
          bank_name?: string | null;
          business_id?: string | null;
          id?: string | null;
          kind?: Database["public"]["Enums"]["money_kind"] | null;
          name?: string | null;
          opening_balance?: number | null;
          status?: Database["public"]["Enums"]["record_status"] | null;
        };
        Update: {
          account_no?: string | null;
          balance?: never;
          bank_branch?: string | null;
          bank_name?: string | null;
          business_id?: string | null;
          id?: string | null;
          kind?: Database["public"]["Enums"]["money_kind"] | null;
          name?: string | null;
          opening_balance?: number | null;
          status?: Database["public"]["Enums"]["record_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "money_accounts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      salesman_commission_summary: {
        Row: {
          business_id: string | null;
          mobile: string | null;
          name: string | null;
          paid_commission: number | null;
          pending_commission: number | null;
          salesman_id: string | null;
          total_commission: number | null;
          transaction_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "salesmen_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_balances: {
        Row: {
          business_id: string | null;
          current_payable: number | null;
          name: string | null;
          opening_payable: number | null;
          payments_total: number | null;
          purchases_total: number | null;
          returns_total: number | null;
          supplier_id: string | null;
        };
        Insert: {
          business_id?: string | null;
          current_payable?: never;
          name?: string | null;
          opening_payable?: number | null;
          payments_total?: never;
          purchases_total?: never;
          returns_total?: never;
          supplier_id?: string | null;
        };
        Update: {
          business_id?: string | null;
          current_payable?: never;
          name?: string | null;
          opening_payable?: number | null;
          payments_total?: never;
          purchases_total?: never;
          returns_total?: never;
          supplier_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      team_activity_feed: {
        Row: {
          activity_type: string | null;
          business_id: string | null;
          created_at: string | null;
          description: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string | null;
          user_id: string | null;
          user_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_activities_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      unread_notifications_count: {
        Row: {
          business_id: string | null;
          unread_count: number | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_notifications_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_task_summary: {
        Row: {
          business_id: string | null;
          completed_tasks: number | null;
          in_progress_tasks: number | null;
          overdue_tasks: number | null;
          pending_tasks: number | null;
          user_id: string | null;
          user_name: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      access_module_for_table: { Args: { _table: string }; Returns: string | null };
      access_rpc_allowed: { Args: { _biz: string }; Returns: boolean };
      _biz_tables: { Args: never; Returns: string[] };
      _bulk: { Args: never; Returns: boolean };
      _guardian_run: { Args: { _biz: string }; Returns: Json };
      _guardian_run_all: { Args: never; Returns: undefined };
      _money_out_check: {
        Args: { _acc: string; _amount: number };
        Returns: undefined;
      };
      _reverse_journal: {
        Args: { _biz: string; _entry: string; _memo: string };
        Returns: string;
      };
      _wipe_business: {
        Args: { _biz: string; _full: boolean };
        Returns: undefined;
      };
      account_totals: {
        Args: { _biz: string; _from: string; _to: string };
        Returns: {
          account_id: string;
          code: string;
          credit: number;
          debit: number;
          name: string;
          type: Database["public"]["Enums"]["account_type"];
        }[];
      };
      acct: { Args: { _biz: string; _code: string }; Returns: string };
      accrue_salesman_commission: {
        Args: { _biz: string; _from: string; _salesman_id: string; _to: string };
        Returns: number;
      };
      add_audit_trigger: { Args: { _table: string }; Returns: undefined };
      add_entity_comment: {
        Args: {
          _biz: string;
          _comment: string;
          _entity_id: string;
          _entity_type: string;
          _is_internal?: boolean;
          _parent_id?: string;
        };
        Returns: string;
      };
      add_expense_category: {
        Args: { _biz: string; _name: string };
        Returns: string;
      };
      approve_stock_transfer: {
        Args: { _comments: string; _transfer_id: string };
        Returns: undefined;
      };
      brand_shop_report: {
        Args: {
          _biz: string;
          _branch: string;
          _from: string;
          _limit: number;
          _offset: number;
          _section: string;
          _to: string;
        };
        Returns: Json;
      };
      calculate_commission_for_sale: {
        Args: { _biz: string; _sale_id: string; _salesman_id: string };
        Returns: number;
      };
      calculate_product_commission: {
        Args: {
          _biz: string;
          _price: number;
          _product_id: string;
          _qty: number;
          _sale_id: string;
          _salesman_id: string;
        };
        Returns: number;
      };
      check_dealer_credit_limit: {
        Args: { _biz: string; _customer_id: string; _sale_amount: number };
        Returns: {
          available_credit: number;
          can_sale: boolean;
          credit_limit: number;
          current_due: number;
          message: string;
        }[];
      };
      clean_expired_backups: { Args: never; Returns: number };
      close_day: {
        Args: {
          _account: string;
          _actual: number;
          _biz: string;
          _date: string;
          _note: string;
        };
        Returns: string;
      };
      complete_backup: {
        Args: {
          _backup_id: string;
          _duration_seconds: number;
          _file_size: number;
          _file_url: string;
          _record_count: number;
          _table_count: number;
        };
        Returns: undefined;
      };
      complete_bank_reconciliation: {
        Args: { _recon_id: string };
        Returns: undefined;
      };
      create_account: {
        Args: {
          _biz: string;
          _code: string;
          _name: string;
          _type: Database["public"]["Enums"]["account_type"];
        };
        Returns: string;
      };
      create_attachment: {
        Args: {
          _biz: string;
          _file_name: string;
          _file_size: number;
          _file_url: string;
          _mime_type: string;
          _note: string;
          _record_id: string;
          _record_type: string;
        };
        Returns: string;
      };
      create_backup_schedule: {
        Args: {
          _biz: string;
          _retention_days?: number;
          _schedule_day?: number;
          _schedule_time?: string;
          _schedule_type: string;
        };
        Returns: string;
      };
      create_business: {
        Args: {
          _address?: string;
          _name: string;
          _phone?: string;
          _type: Database["public"]["Enums"]["business_type"];
        };
        Returns: string;
      };
      create_emi_sale_full: {
        Args: { _biz: string; _data: Json; _emi: Json };
        Returns: Json;
      };
      create_expense: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _branch: string;
          _category: string;
          _date: string;
          _description: string;
        };
        Returns: string;
      };
      create_export_job: {
        Args: {
          _biz: string;
          _export_type: string;
          _filters: Json;
          _format: string;
        };
        Returns: string;
      };
      create_import_job: {
        Args: {
          _biz: string;
          _file_name: string;
          _file_url: string;
          _import_type: string;
          _total_records: number;
        };
        Returns: string;
      };
      create_manual_journal: {
        Args: { _biz: string; _date: string; _lines: Json; _memo: string };
        Returns: string;
      };
      create_money_account: {
        Args: {
          _account_no: string;
          _bank_branch: string;
          _bank_name: string;
          _biz: string;
          _branch: string;
          _kind: Database["public"]["Enums"]["money_kind"];
          _name: string;
          _opening: number;
        };
        Returns: string;
      };
      create_notification: {
        Args: {
          _biz: string;
          _entity_id?: string;
          _entity_type?: string;
          _link?: string;
          _message: string;
          _title: string;
          _type?: string;
          _user_id: string;
        };
        Returns: string;
      };
      create_payment_request: {
        Args: {
          _amount: number;
          _biz: string;
          _customer_id: string;
          _description: string;
          _due_date: string;
        };
        Returns: string;
      };
      create_purchase: { Args: { _biz: string; _data: Json }; Returns: string };
      create_purchase_return: {
        Args: { _biz: string; _data: Json };
        Returns: string;
      };
      create_sale: { Args: { _biz: string; _data: Json }; Returns: string };
      create_sales_return: {
        Args: { _biz: string; _data: Json };
        Returns: string;
      };
      create_stock_transfer: {
        Args: { _biz: string; _data: Json };
        Returns: string;
      };
      create_task: {
        Args: {
          _assigned_to: string;
          _biz: string;
          _description: string;
          _due_date?: string;
          _entity_id?: string;
          _entity_type?: string;
          _priority?: string;
          _title: string;
        };
        Returns: string;
      };
      create_warranty_claim: {
        Args: { _biz: string; _imei: string; _issue: string };
        Returns: string;
      };
      customer_due: { Args: { _c: string }; Returns: number };
      daily_summary: { Args: { _biz: string; _date: string }; Returns: Json };
      delete_account: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      delete_attachment: {
        Args: { _attachment_id: string; _biz: string };
        Returns: undefined;
      };
      delete_expense_category: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      delete_money_account: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      emi_summary: {
        Args: { _biz: string; _branch?: string | null };
        Returns: Json;
      };
      export_business: { Args: { _biz: string }; Returns: Json };
      export_customers_json: {
        Args: { _biz: string; _filters?: Json };
        Returns: Json;
      };
      export_products_json: {
        Args: { _biz: string; _filters?: Json };
        Returns: Json;
      };
      fail_backup: {
        Args: { _backup_id: string; _error_message: string };
        Returns: undefined;
      };
      generate_customer_portal_token: {
        Args: { _biz: string; _customer_id: string; _expires_in_days?: number };
        Returns: string;
      };
      generate_daily_kpi_snapshots: {
        Args: { _biz: string };
        Returns: undefined;
      };
      get_active_subscriptions: {
        Args: { _biz: string };
        Returns: {
          channel: string;
          last_activity: string;
          subscriber_count: number;
        }[];
      };
      get_attachments_for_record: {
        Args: { _biz: string; _record_id: string; _record_type: string };
        Returns: {
          created_at: string;
          file_name: string;
          file_size: number;
          file_url: string;
          id: string;
          mime_type: string;
          note: string;
          uploaded_by: string;
          uploaded_by_name: string;
        }[];
      };
      get_bank_reconciliation_summary: {
        Args: {
          _account_id: string;
          _biz: string;
          _from_date: string;
          _to_date: string;
        };
        Returns: {
          account_id: string;
          book_balance: number;
          created_at: string;
          difference: number;
          recon_id: string;
          reconciliation_date: string;
          statement_balance: number;
          status: string;
        }[];
      };
      get_customer_portal_data: {
        Args: { _biz: string; _customer_id: string };
        Returns: Json;
      };
      get_entity_comments: {
        Args: { _biz: string; _entity_id: string; _entity_type: string };
        Returns: {
          comment: string;
          created_at: string;
          id: string;
          is_internal: boolean;
          parent_id: string;
          updated_at: string;
          user_id: string;
          user_name: string;
        }[];
      };
      get_export_job_status: {
        Args: { _biz: string; _job_id: string };
        Returns: {
          completed_at: string;
          created_at: string;
          error_message: string;
          export_type: string;
          file_name: string;
          file_size: number;
          file_url: string;
          format: string;
          id: string;
          record_count: number;
          status: string;
        }[];
      };
      get_effective_access: { Args: { _biz: string }; Returns: Json };
      get_company_profile: { Args: { _biz: string }; Returns: Json };
      get_guardian_runtime_config: { Args: { _biz: string }; Returns: Json };
      get_member_access_config: {
        Args: { _biz: string; _user: string };
        Returns: Json;
      };
      has_module_access: {
        Args: { _biz: string; _module: string; _permission?: string };
        Returns: boolean;
      };
      get_kpi_trend: {
        Args: {
          _biz: string;
          _from_date: string;
          _kpi_type: string;
          _to_date: string;
        };
        Returns: {
          metadata: Json;
          snapshot_date: string;
          value: number;
        }[];
      };
      get_pending_transfer_approvals: {
        Args: { _biz: string };
        Returns: {
          from_branch_name: string;
          item_count: number;
          notes: string;
          requested_at: string;
          requested_by: string;
          to_branch_name: string;
          total_value: number;
          transfer_id: string;
        }[];
      };
      get_salesman_commission_summary: {
        Args: {
          _biz: string;
          _from_date: string;
          _salesman_id: string;
          _to_date: string;
        };
        Returns: {
          paid_commission: number;
          pending_commission: number;
          salesman_id: string;
          salesman_name: string;
          total_commission: number;
          total_sales: number;
          transaction_count: number;
        }[];
      };
      get_saved_reports: {
        Args: { _biz: string; _report_type?: string };
        Returns: {
          columns: Json;
          created_at: string;
          description: string;
          filters: Json;
          id: string;
          is_public: boolean;
          name: string;
          report_type: string;
          user_id: string;
          user_name: string;
        }[];
      };
      get_team_activity: {
        Args: { _biz: string; _limit?: number };
        Returns: {
          activity_type: string;
          created_at: string;
          description: string;
          entity_id: string;
          entity_type: string;
          id: string;
          user_id: string;
          user_name: string;
        }[];
      };
      get_user_notifications: {
        Args: { _biz: string; _limit?: number; _unread_only?: boolean };
        Returns: {
          created_at: string;
          id: string;
          link: string;
          message: string;
          read_at: string;
          title: string;
          type: string;
        }[];
      };
      get_user_tasks: {
        Args: { _biz: string; _status?: string; _user_id?: string };
        Returns: {
          assigned_to: string;
          assigned_to_name: string;
          created_at: string;
          created_by: string;
          created_by_name: string;
          description: string;
          due_date: string;
          entity_id: string;
          entity_type: string;
          id: string;
          priority: string;
          status: string;
          title: string;
        }[];
      };
      guardian_snapshot: { Args: { _biz: string }; Returns: Json };
      has_biz_role: {
        Args: {
          _biz: string;
          _roles: Database["public"]["Enums"]["member_role"][];
        };
        Returns: boolean;
      };
      is_member: { Args: { _biz: string }; Returns: boolean };
      jl: { Args: { _acc: string; _cr: number; _dr: number }; Returns: Json };
      load_demo_data: { Args: { _biz: string }; Returns: undefined };
      log_user_activity: {
        Args: {
          _activity_type: string;
          _biz: string;
          _description: string;
          _entity_id: string;
          _entity_type: string;
          _metadata?: Json;
        };
        Returns: string;
      };
      mark_all_notifications_read: {
        Args: { _biz: string };
        Returns: undefined;
      };
      mark_notification_read: {
        Args: { _notification_id: string };
        Returns: undefined;
      };
      mark_quotation_converted: {
        Args: { _id: string; _biz: string; _sale: string };
        Returns: undefined;
      };
      mark_reconciliation_item_cleared: {
        Args: { _cleared: boolean; _item_id: string };
        Returns: undefined;
      };
      money_balance: {
        Args: { _account: string; _upto?: string };
        Returns: number;
      };
      money_ledger_code: {
        Args: { _k: Database["public"]["Enums"]["money_kind"] };
        Returns: string;
      };
      pay_salesman_commission: {
        Args: {
          _amount: number;
          _biz: string;
          _commission_id: string;
          _note: string;
          _payment_method: string;
          _transaction_ref: string;
        };
        Returns: undefined;
      };
      pay_supplier: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _date: string;
          _method: Database["public"]["Enums"]["payment_method"];
          _note: string;
          _supplier: string;
          _txn_ref: string;
        };
        Returns: string;
      };
      post_journal: {
        Args: {
          _biz: string;
          _date: string;
          _lines: Json;
          _memo: string;
          _ref_id: string;
          _ref_type: string;
        };
        Returns: string;
      };
      receive_customer_payment: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _customer: string;
          _date: string;
          _method: Database["public"]["Enums"]["payment_method"];
          _note: string;
          _txn_ref: string;
        };
        Returns: string;
      };
      receive_emi_payment: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _date: string;
          _emi: string;
          _installment?: string | null;
          _method: Database["public"]["Enums"]["payment_method"];
          _note: string;
          _txn_ref: string;
        };
        Returns: string;
      };
      receive_stock_transfer: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      record_kpi_snapshot: {
        Args: {
          _biz: string;
          _kpi_type: string;
          _metadata?: Json;
          _snapshot_date: string;
          _value: number;
        };
        Returns: undefined;
      };
      record_money_txn: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _date: string;
          _direction: string;
          _kind: string;
          _method: Database["public"]["Enums"]["payment_method"];
          _note: string;
          _txn_ref: string;
        };
        Returns: string;
      };
      reject_stock_transfer: {
        Args: { _reason: string; _transfer_id: string };
        Returns: undefined;
      };
      request_transfer_approval: {
        Args: { _notes: string; _transfer_id: string };
        Returns: undefined;
      };
      reset_business: {
        Args: { _biz: string; _confirm: string; _mode: string };
        Returns: undefined;
      };
      restore_business: {
        Args: { _biz: string; _confirm: string; _data: Json };
        Returns: undefined;
      };
      resume_guardian_ai: {
        Args: { _biz: string; _confirm: string };
        Returns: undefined;
      };
      reverse_expense: {
        Args: { _biz: string; _id: string; _reason: string };
        Returns: undefined;
      };
      reverse_journal: {
        Args: { _biz: string; _id: string; _reason: string };
        Returns: string;
      };
      reverse_money_txn: {
        Args: { _biz: string; _id: string; _reason: string };
        Returns: undefined;
      };
      run_guardian_checks: { Args: { _biz: string }; Returns: Json };
      save_access_role: {
        Args: {
          _biz: string;
          _description: string;
          _name: string;
          _permissions: Json;
          _role_id: string | null;
        };
        Returns: string;
      };
      save_member_access: {
        Args: {
          _biz: string;
          _overrides: Json;
          _role_id: string | null;
          _user: string;
        };
        Returns: undefined;
      };
      delete_access_role: {
        Args: { _biz: string; _role_id: string };
        Returns: undefined;
      };
      save_quotation: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      save_report_config: {
        Args: {
          _biz: string;
          _columns: Json;
          _description: string;
          _filters: Json;
          _is_public?: boolean;
          _name: string;
          _report_type: string;
          _sort_by: Json;
        };
        Returns: string;
      };
      seed_finance: { Args: { _biz: string }; Returns: undefined };
      set_guardian_alert: {
        Args: { _biz: string; _id: string; _status: string };
        Returns: undefined;
      };
      set_dealer_credit: {
        Args: {
          _biz: string;
          _credit_limit: number;
          _customer: string;
          _payment_terms_days: number;
          _status?: string;
        };
        Returns: undefined;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      start_backup: {
        Args: { _backup_type: string; _biz: string };
        Returns: string;
      };
      start_bank_reconciliation: {
        Args: {
          _account_id: string;
          _biz: string;
          _note: string;
          _reconciliation_date: string;
          _statement_balance: number;
        };
        Returns: string;
      };
      subscribe_realtime_channel: {
        Args: { _biz: string; _channel: string };
        Returns: undefined;
      };
      transfer_money: {
        Args: {
          _amount: number;
          _biz: string;
          _date: string;
          _from: string;
          _note: string;
          _to: string;
        };
        Returns: string;
      };
      unsubscribe_realtime_channel: {
        Args: { _biz: string; _channel: string };
        Returns: undefined;
      };
      update_account: {
        Args: { _biz: string; _id: string; _name: string };
        Returns: undefined;
      };
      update_dealer_credit_on_payment: {
        Args: { _amount: number; _biz: string; _customer_id: string };
        Returns: undefined;
      };
      update_dealer_credit_on_sale: {
        Args: {
          _biz: string;
          _customer_id: string;
          _due: number;
          _paid: number;
          _sale_amount: number;
        };
        Returns: undefined;
      };
      update_expense: {
        Args: {
          _account: string;
          _amount: number;
          _biz: string;
          _branch: string;
          _category: string;
          _date: string;
          _description: string;
          _id: string;
        };
        Returns: string;
      };
      update_expense_category: {
        Args: { _biz: string; _id: string; _name: string };
        Returns: undefined;
      };
      update_export_job_status: {
        Args: {
          _error_message?: string;
          _file_size?: number;
          _file_url?: string;
          _job_id: string;
          _record_count?: number;
          _status: string;
        };
        Returns: undefined;
      };
      update_import_job: {
        Args: {
          _errors: string[];
          _failed_records: number;
          _job_id: string;
          _status: string;
          _success_records: number;
        };
        Returns: undefined;
      };
      update_money_account: {
        Args: {
          _account_no: string;
          _bank_branch: string;
          _bank_name: string;
          _biz: string;
          _branch: string;
          _id: string;
          _name: string;
          _status: Database["public"]["Enums"]["record_status"];
        };
        Returns: undefined;
      };
      update_quotation_status: {
        Args: { _biz: string; _id: string; _status: string };
        Returns: undefined;
      };
      add_order_payment: {
        Args: {
          _amount: number;
          _biz: string;
          _id: string;
          _method?: string;
          _note?: string;
          _payment_date?: string;
          _reference?: string;
        };
        Returns: string;
      };
      mark_order_converted: {
        Args: { _biz: string; _id: string; _sale: string };
        Returns: undefined;
      };
      save_order: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      update_order_status: {
        Args: { _biz: string; _id: string; _status: string };
        Returns: undefined;
      };
      update_task_status: {
        Args: { _status: string; _task_id: string };
        Returns: undefined;
      };
      update_warranty_claim: {
        Args: {
          _biz: string;
          _id: string;
          _resolution: string;
          _status: string;
        };
        Returns: undefined;
      };
      verify_customer_portal_token: {
        Args: { _token: string };
        Returns: {
          business_id: string;
          customer_id: string;
          customer_mobile: string;
          customer_name: string;
        }[];
      };
      verify_job_token: {
        Args: { _name: string; _token: string };
        Returns: boolean;
      };
      visit_log: {
        Args: { _biz: string; _from: string };
        Returns: {
          device: string;
          path: string;
          session_id: string;
          user_name: string;
          visited_at: string;
        }[];
      };
      apply_bulk_price_update: {
        Args: { _biz: string; _data: Json };
        Returns: number;
      };
      dead_slow_stock_report: {
        Args: { _biz: string; _dead_days?: number; _slow_days?: number };
        Returns: {
          avg_cost: number;
          brand: string;
          bucket: string;
          days_since: number;
          last_sale: string;
          product: string;
          qty: number;
          sku: string;
          stock_value: number;
          variant_id: string;
        }[];
      };
      post_purchase_return: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      post_stock_adjustment: {
        Args: { _biz: string; _id: string };
        Returns: undefined;
      };
      receive_po_items: {
        Args: { _biz: string; _data: Json; _id: string };
        Returns: undefined;
      };
      save_label_template: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      save_purchase_order: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      save_purchase_return: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      save_service_job: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      save_service_items: {
        Args: { _biz: string; _data: Json; _id: string };
        Returns: undefined;
      };
      save_stock_adjustment: {
        Args: { _biz: string; _data?: Json; _id?: string };
        Returns: string;
      };
      set_order_delivery: {
        Args: { _biz: string; _data: Json; _id: string };
        Returns: undefined;
      };
      supplier_aging_report: {
        Args: { _as_of?: string; _biz: string };
        Returns: {
          b0_30: number;
          b31_60: number;
          b61_90: number;
          b91_120: number;
          b_over_120: number;
          supplier_id: string;
          supplier_name: string;
          total_due: number;
        }[];
      };
      update_po_status: {
        Args: { _biz: string; _id: string; _status: string };
        Returns: undefined;
      };
      update_service_status: {
        Args: { _biz: string; _id: string; _status: string };
        Returns: undefined;
      };
    };
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
      branch_kind: "head" | "branch" | "warehouse";
      business_type: "retail" | "wholesale" | "both";
      customer_type:
        | "retail"
        | "retail_shop"
        | "wholesale_dealer"
        | "sub_dealer"
        | "corporate"
        | "vip"
        | "dealer";
      imei_status: "IN_STOCK" | "RESERVED" | "SOLD" | "RETURNED" | "WARRANTY";
      member_role:
        | "owner"
        | "manager"
        | "accountant"
        | "salesman"
        | "store_keeper"
        | "purchase_officer"
        | "branch_manager"
        | "viewer";
      money_kind: "cash" | "bank" | "mfs";
      payment_method: "cash" | "bank" | "bkash" | "nagad" | "rocket" | "card" | "cheque" | "other";
      price_level: "retail" | "wholesale" | "dealer" | "special";
      record_status: "active" | "inactive";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      branch_kind: ["head", "branch", "warehouse"],
      business_type: ["retail", "wholesale", "both"],
      customer_type: [
        "retail",
        "retail_shop",
        "wholesale_dealer",
        "sub_dealer",
        "corporate",
        "vip",
        "dealer",
      ],
      imei_status: ["IN_STOCK", "RESERVED", "SOLD", "RETURNED", "WARRANTY"],
      member_role: [
        "owner",
        "manager",
        "accountant",
        "salesman",
        "store_keeper",
        "purchase_officer",
        "branch_manager",
        "viewer",
      ],
      money_kind: ["cash", "bank", "mfs"],
      payment_method: ["cash", "bank", "bkash", "nagad", "rocket", "card", "cheque", "other"],
      price_level: ["retail", "wholesale", "dealer", "special"],
      record_status: ["active", "inactive"],
    },
  },
} as const;
