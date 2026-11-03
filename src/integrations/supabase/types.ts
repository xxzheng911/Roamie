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
  public: {
    Tables: {
      credit_accounts: {
        Row: {
          user_id: string
          plan: string
          monthly_limit: number
          available_credits: number
          reserved_credits: number
          period_start: string
          period_end: string
          last_reset_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          plan?: string
          monthly_limit?: number
          available_credits?: number
          reserved_credits?: number
          period_start: string
          period_end: string
          last_reset_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          plan?: string
          monthly_limit?: number
          available_credits?: number
          reserved_credits?: number
          period_start?: string
          period_end?: string
          last_reset_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          id: string
          user_id: string
          feature_type: string
          amount: number
          status: string
          request_id: string
          idempotency_key: string
          metadata: Json
          environment: string
          created_at: string
          committed_at: string | null
          rolled_back_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          feature_type: string
          amount: number
          status?: string
          request_id: string
          idempotency_key: string
          metadata?: Json
          environment?: string
          created_at?: string
          committed_at?: string | null
          rolled_back_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          feature_type?: string
          amount?: number
          status?: string
          request_id?: string
          idempotency_key?: string
          metadata?: Json
          environment?: string
          created_at?: string
          committed_at?: string | null
          rolled_back_at?: string | null
        }
        Relationships: []
      }
      credit_debug_overrides: {
        Row: {
          user_id: string
          available_credits: number
          reserved_credits: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          available_credits?: number
          reserved_credits?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          available_credits?: number
          reserved_credits?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      itineraries: {
        Row: {
          blocks: Json | null
          city: string | null
          created_at: string
          id: string
          mood: string | null
          title: string
          user_id: string
        }
        Insert: {
          blocks?: Json | null
          city?: string | null
          created_at?: string
          id?: string
          mood?: string | null
          title: string
          user_id: string
        }
        Update: {
          blocks?: Json | null
          city?: string | null
          created_at?: string
          id?: string
          mood?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_preferences: Json | null
          auth_provider: string | null
          avatar_url: string | null
          bio: string | null
          cover_image_url: string | null
          created_at: string
          display_name: string | null
          id: string
          language: string | null
          notifications_enabled: boolean
          plan_tier: string
          plus_available: boolean
          subscription_provider: string
          subscription_status: string
          travel_personality: Json | null
          updated_at: string
        }
        Insert: {
          ai_preferences?: Json | null
          auth_provider?: string | null
          avatar_url?: string | null
          bio?: string | null
          cover_image_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          language?: string | null
          notifications_enabled?: boolean
          plan_tier?: string
          plus_available?: boolean
          subscription_provider?: string
          subscription_status?: string
          travel_personality?: Json | null
          updated_at?: string
        }
        Update: {
          ai_preferences?: Json | null
          auth_provider?: string | null
          avatar_url?: string | null
          bio?: string | null
          cover_image_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string | null
          notifications_enabled?: boolean
          plan_tier?: string
          plus_available?: boolean
          subscription_provider?: string
          subscription_status?: string
          travel_personality?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      user_plus_entitlements: {
        Row: {
          id: string
          user_id: string
          source: string
          starts_at: string
          expires_at: string | null
          revoked_at: string | null
          granted_at: string
          granted_by: string | null
          reason: string | null
          revoked_by: string | null
          revocation_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source: string
          starts_at?: string
          expires_at?: string | null
          revoked_at?: string | null
          granted_at?: string
          granted_by?: string | null
          reason?: string | null
          revoked_by?: string | null
          revocation_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          source?: string
          starts_at?: string
          expires_at?: string | null
          revoked_at?: string | null
          granted_at?: string
          granted_by?: string | null
          reason?: string | null
          revoked_by?: string | null
          revocation_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_places: {
        Row: {
          address: string | null
          category: string | null
          city: string | null
          cover_image: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          metadata: Json
          mood_tag: string | null
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          category?: string | null
          city?: string | null
          cover_image?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          metadata?: Json
          mood_tag?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          category?: string | null
          city?: string | null
          cover_image?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          metadata?: Json
          mood_tag?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_trips: {
        Row: {
          cover_image: string | null
          cover_image_url: string | null
          cover_query: string | null
          cover_source: string | null
          created_at: string
          custom_cover_image_url: string | null
          custom_title: string | null
          description: string | null
          id: string
          is_cover_customized: boolean
          is_title_customized: boolean
          mood: string | null
          payload: Json | null
          title: string
          trip_data: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_image?: string | null
          cover_image_url?: string | null
          cover_query?: string | null
          cover_source?: string | null
          created_at?: string
          custom_cover_image_url?: string | null
          custom_title?: string | null
          description?: string | null
          id?: string
          is_cover_customized?: boolean
          is_title_customized?: boolean
          mood?: string | null
          payload?: Json | null
          title: string
          trip_data?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_image?: string | null
          cover_image_url?: string | null
          cover_query?: string | null
          cover_source?: string | null
          created_at?: string
          custom_cover_image_url?: string | null
          custom_title?: string | null
          description?: string | null
          id?: string
          is_cover_customized?: boolean
          is_title_customized?: boolean
          mood?: string | null
          payload?: Json | null
          title?: string
          trip_data?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trip_invites: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          invitee_email: string | null
          invitee_user_id: string | null
          inviter_id: string
          is_link: boolean
          revoked_at: string | null
          status: string
          token: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          invitee_email?: string | null
          invitee_user_id?: string | null
          inviter_id: string
          is_link?: boolean
          revoked_at?: string | null
          status?: string
          token: string
          trip_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          invitee_email?: string | null
          invitee_user_id?: string | null
          inviter_id?: string
          is_link?: boolean
          revoked_at?: string | null
          status?: string
          token?: string
          trip_id?: string
        }
        Relationships: []
      }
      trip_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          is_owner: boolean
          status: string
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_owner?: boolean
          status?: string
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_owner?: boolean
          status?: string
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trip_expenses: {
        Row: {
          amount_minor: number
          client_request_id: string
          created_at: string
          created_by: string
          currency: string
          currency_exponent: number
          deleted_at: string | null
          id: string
          kind: "expense" | "settlement"
          note: string | null
          spent_on: string
          split_method: "equal" | "exact" | "percent"
          title: string
          trip_id: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          amount_minor: number
          client_request_id: string
          created_at?: string
          created_by: string
          currency: string
          currency_exponent: number
          deleted_at?: string | null
          id?: string
          kind: "expense" | "settlement"
          note?: string | null
          spent_on: string
          split_method: "equal" | "exact" | "percent"
          title: string
          trip_id: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          amount_minor?: number
          client_request_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          currency_exponent?: number
          deleted_at?: string | null
          id?: string
          kind?: "expense" | "settlement"
          note?: string | null
          spent_on?: string
          split_method?: "equal" | "exact" | "percent"
          title?: string
          trip_id?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "saved_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_expense_payers: {
        Row: {
          amount_minor: number
          expense_id: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          expense_id: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          expense_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_expense_payers_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "trip_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_expense_shares: {
        Row: {
          expense_id: string
          percent_bp: number | null
          share_minor: number
          user_id: string
        }
        Insert: {
          expense_id: string
          percent_bp?: number | null
          share_minor: number
          user_id: string
        }
        Update: {
          expense_id?: string
          percent_bp?: number | null
          share_minor?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_expense_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "trip_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_categories: {
        Row: {
          created_at: string
          default_key:
            | "clothing"
            | "toiletries"
            | "electronics"
            | "documents"
            | "medicine"
            | "other"
            | null
          deleted_at: string | null
          icon_key: string
          id: string
          name: string | null
          sort_index: number
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_key?:
            | "clothing"
            | "toiletries"
            | "electronics"
            | "documents"
            | "medicine"
            | "other"
            | null
          deleted_at?: string | null
          icon_key?: string
          id?: string
          name?: string | null
          sort_index?: number
          trip_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          default_key?:
            | "clothing"
            | "toiletries"
            | "electronics"
            | "documents"
            | "medicine"
            | "other"
            | null
          deleted_at?: string | null
          icon_key?: string
          id?: string
          name?: string | null
          sort_index?: number
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_categories_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "saved_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_items: {
        Row: {
          category_id: string
          checked_at: string | null
          client_request_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_checked: boolean
          name: string
          note: string | null
          quantity: number
          sort_index: number
          trip_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          category_id: string
          checked_at?: string | null
          client_request_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_checked?: boolean
          name: string
          note?: string | null
          quantity?: number
          sort_index?: number
          trip_id: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Update: {
          category_id?: string
          checked_at?: string | null
          client_request_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_checked?: boolean
          name?: string
          note?: string | null
          quantity?: number
          sort_index?: number
          trip_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "packing_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "packing_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "saved_trips"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      resolve_user_plus_entitlement: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_grant_plus_entitlement: {
        Args: {
          p_user_id: string
          p_source: string
          p_expires_at?: string | null
          p_reason?: string | null
          p_granted_by?: string | null
          p_starts_at?: string
        }
        Returns: string
      }
      admin_revoke_plus_entitlement: {
        Args: {
          p_entitlement_id: string
          p_reason?: string | null
          p_revoked_by?: string | null
        }
        Returns: boolean
      }
      admin_dashboard_phase1: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_search?: string | null
          p_sort?: string
        }
        Returns: Json
      }
      credits_get_account: {
        Args: Record<string, never>
        Returns: Json
      }
      credits_check: {
        Args: { p_feature_type: string; p_amount?: number }
        Returns: Json
      }
      credits_reserve: {
        Args: {
          p_feature_type: string
          p_request_id: string
          p_idempotency_key: string
          p_amount?: number
          p_metadata?: Json
        }
        Returns: Json
      }
      credits_commit: {
        Args: { p_ledger_id?: string | null; p_idempotency_key?: string | null }
        Returns: Json
      }
      credits_rollback: {
        Args: { p_ledger_id?: string | null; p_idempotency_key?: string | null }
        Returns: Json
      }
      credits_debug_set: {
        Args: { p_available: number; p_force_plan?: string | null }
        Returns: Json
      }
      credits_debug_reset: {
        Args: Record<string, never>
        Returns: Json
      }
      credits_debug_deduct: {
        Args: { p_amount?: number }
        Returns: Json
      }
      credits_debug_clear_override: {
        Args: Record<string, never>
        Returns: Json
      }
      credits_release_stale_reservations: {
        Args: { p_user_id?: string | null; p_max_age?: unknown }
        Returns: number
      }
      accept_trip_invite: {
        Args: { invite_token: string }
        Returns: string
      }
      get_trip_member_public_profiles: {
        Args: { p_trip_id: string }
        Returns: {
          user_id: string
          display_name: string | null
          avatar_url: string | null
        }[]
      }
      get_trip_invite_by_token: {
        Args: { invite_token: string }
        Returns: {
          created_at: string
          expires_at: string | null
          id: string
          invitee_email: string | null
          invitee_user_id: string | null
          inviter_id: string
          status: string
          token: string
          trip_id: string
        }
      }
      create_trip_invite: {
        Args: { p_trip_id: string }
        Returns: {
          invite_id: string
          invite_token: string
        }[]
      }
      set_trip_invite_link_enabled: {
        Args: { p_trip_id: string; p_enabled: boolean }
        Returns: {
          enabled: boolean
          invite_id: string | null
          invite_token: string | null
        }[]
      }
      get_trip_invite_preview: {
        Args: { invite_token: string }
        Returns: {
          state: "valid" | "full" | "revoked" | "expired" | "invalid"
          trip_title: string | null
          date_start: string | null
          date_end: string | null
          cover_url: string | null
          inviter_display_name: string | null
          member_count: number | null
        }[]
      }
      upsert_trip_expense: {
        Args: {
          p_trip_id: string
          p_expense: Json
          p_expected_version: number | null
        }
        Returns: {
          expense_id: string
          expense_version: number
          replayed: boolean
        }[]
      }
      delete_trip_expense: {
        Args: { p_expense_id: string; p_expected_version: number }
        Returns: {
          expense_id: string
          expense_version: number
        }[]
      }
      restore_trip_expense: {
        Args: { p_expense_id: string }
        Returns: {
          expense_id: string
          expense_version: number
        }[]
      }
      ensure_my_packing_categories: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["packing_categories"]["Row"][]
      }
      ensure_my_packing_other_category: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["packing_categories"]["Row"]
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
