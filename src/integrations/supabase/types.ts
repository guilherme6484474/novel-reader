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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      nav_community_reports: {
        Row: {
          alert_id: string | null
          created_at: string
          description: string | null
          id: string
          is_anonymous: boolean
          latitude: number
          longitude: number
          report_type: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          alert_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          latitude: number
          longitude: number
          report_type?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          alert_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_anonymous?: boolean
          latitude?: number
          longitude?: number
          report_type?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nav_community_reports_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "nav_security_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      nav_muted_areas: {
        Row: {
          alert_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          alert_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          alert_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nav_muted_areas_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "nav_security_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      nav_points_of_interest: {
        Row: {
          address: string | null
          category: string
          created_at: string
          id: string
          is_24h: boolean
          latitude: number
          longitude: number
          name: string
          phone: string | null
          safety_rating: number | null
        }
        Insert: {
          address?: string | null
          category: string
          created_at?: string
          id?: string
          is_24h?: boolean
          latitude: number
          longitude: number
          name: string
          phone?: string | null
          safety_rating?: number | null
        }
        Update: {
          address?: string | null
          category?: string
          created_at?: string
          id?: string
          is_24h?: boolean
          latitude?: number
          longitude?: number
          name?: string
          phone?: string | null
          safety_rating?: number | null
        }
        Relationships: []
      }
      nav_security_alerts: {
        Row: {
          alert_level: string
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          polygon_coordinates: Json | null
          radius_meters: number
          source: string
          title: string
          updated_at: string
          verification_count: number
          verified: boolean
        }
        Insert: {
          alert_level?: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          polygon_coordinates?: Json | null
          radius_meters?: number
          source?: string
          title: string
          updated_at?: string
          verification_count?: number
          verified?: boolean
        }
        Update: {
          alert_level?: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          polygon_coordinates?: Json | null
          radius_meters?: number
          source?: string
          title?: string
          updated_at?: string
          verification_count?: number
          verified?: boolean
        }
        Relationships: []
      }
      nav_user_preferences: {
        Row: {
          alert_sensitivity: string
          created_at: string
          id: string
          prefer_safe_routes: boolean
          sound_alerts: boolean
          updated_at: string
          user_id: string
          visual_alerts: boolean
        }
        Insert: {
          alert_sensitivity?: string
          created_at?: string
          id?: string
          prefer_safe_routes?: boolean
          sound_alerts?: boolean
          updated_at?: string
          user_id: string
          visual_alerts?: boolean
        }
        Update: {
          alert_sensitivity?: string
          created_at?: string
          id?: string
          prefer_safe_routes?: boolean
          sound_alerts?: boolean
          updated_at?: string
          user_id?: string
          visual_alerts?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reading_history: {
        Row: {
          chapter_title: string | null
          chapter_url: string
          id: string
          last_read_at: string
          novel_title: string
          novel_url: string
          user_id: string
        }
        Insert: {
          chapter_title?: string | null
          chapter_url: string
          id?: string
          last_read_at?: string
          novel_title: string
          novel_url: string
          user_id: string
        }
        Update: {
          chapter_title?: string | null
          chapter_url?: string
          id?: string
          last_read_at?: string
          novel_title?: string
          novel_url?: string
          user_id?: string
        }
        Relationships: []
      }
      tts_usage: {
        Row: {
          characters_count: number
          created_at: string
          engine: string
          id: string
          lang: string
          user_id: string | null
        }
        Insert: {
          characters_count?: number
          created_at?: string
          engine?: string
          id?: string
          lang?: string
          user_id?: string | null
        }
        Update: {
          characters_count?: number
          created_at?: string
          engine?: string
          id?: string
          lang?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
