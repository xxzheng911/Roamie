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
      affiliate_products: {
        Row: {
          affiliate_url: string
          category: string | null
          created_at: string
          destination: string | null
          id: string
          image_url: string | null
          is_active: boolean
          platform: string
          title: string
        }
        Insert: {
          affiliate_url: string
          category?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          platform: string
          title: string
        }
        Update: {
          affiliate_url?: string
          category?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          platform?: string
          title?: string
        }
        Relationships: []
      }
      conversation_context: {
        Row: {
          budget: string | null
          companions: string | null
          destination: string | null
          mood: string | null
          plus_memory: Json
          season: string | null
          selected_places: Json
          session_extras: Json
          transportation: string | null
          travel_date: string | null
          travel_days: number | null
          updated_at: string
          user_id: string
          weather: string | null
        }
        Insert: {
          budget?: string | null
          companions?: string | null
          destination?: string | null
          mood?: string | null
          plus_memory?: Json
          season?: string | null
          selected_places?: Json
          session_extras?: Json
          transportation?: string | null
          travel_date?: string | null
          travel_days?: number | null
          updated_at?: string
          user_id: string
          weather?: string | null
        }
        Update: {
          budget?: string | null
          companions?: string | null
          destination?: string | null
          mood?: string | null
          plus_memory?: Json
          season?: string | null
          selected_places?: Json
          session_extras?: Json
          transportation?: string | null
          travel_date?: string | null
          travel_days?: number | null
          updated_at?: string
          user_id?: string
          weather?: string | null
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
          travel_preferences: Json | null
          travel_style: string | null
          travel_tags: Json | null
          survey_completed: boolean
          survey_completed_at: string | null
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
          travel_preferences?: Json | null
          travel_style?: string | null
          travel_tags?: Json | null
          survey_completed?: boolean
          survey_completed_at?: string | null
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
          travel_preferences?: Json | null
          travel_style?: string | null
          travel_tags?: Json | null
          survey_completed?: boolean
          survey_completed_at?: string | null
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
          image_url: string | null
          image_source: string | null
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
          image_url?: string | null
          image_source?: string | null
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
          image_url?: string | null
          image_source?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
