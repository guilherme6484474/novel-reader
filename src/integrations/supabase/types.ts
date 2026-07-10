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
      estatisticas_mando: {
        Row: {
          created_at: string
          derrotas_casa: number
          derrotas_fora: number
          empates_casa: number
          empates_fora: number
          gols_contra_casa: number
          gols_contra_fora: number
          gols_pro_casa: number
          gols_pro_fora: number
          id: string
          jogos_casa: number
          jogos_fora: number
          temporada: string
          time_id: string
          updated_at: string
          vitorias_casa: number
          vitorias_fora: number
        }
        Insert: {
          created_at?: string
          derrotas_casa?: number
          derrotas_fora?: number
          empates_casa?: number
          empates_fora?: number
          gols_contra_casa?: number
          gols_contra_fora?: number
          gols_pro_casa?: number
          gols_pro_fora?: number
          id?: string
          jogos_casa?: number
          jogos_fora?: number
          temporada: string
          time_id: string
          updated_at?: string
          vitorias_casa?: number
          vitorias_fora?: number
        }
        Update: {
          created_at?: string
          derrotas_casa?: number
          derrotas_fora?: number
          empates_casa?: number
          empates_fora?: number
          gols_contra_casa?: number
          gols_contra_fora?: number
          gols_pro_casa?: number
          gols_pro_fora?: number
          id?: string
          jogos_casa?: number
          jogos_fora?: number
          temporada?: string
          time_id?: string
          updated_at?: string
          vitorias_casa?: number
          vitorias_fora?: number
        }
        Relationships: [
          {
            foreignKeyName: "estatisticas_mando_time_id_fkey"
            columns: ["time_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_confrontos: {
        Row: {
          competicao: string | null
          created_at: string
          data: string
          gols_time_a: number
          gols_time_b: number
          id: string
          time_a_id: string
          time_b_id: string
        }
        Insert: {
          competicao?: string | null
          created_at?: string
          data: string
          gols_time_a?: number
          gols_time_b?: number
          id?: string
          time_a_id: string
          time_b_id: string
        }
        Update: {
          competicao?: string | null
          created_at?: string
          data?: string
          gols_time_a?: number
          gols_time_b?: number
          id?: string
          time_a_id?: string
          time_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_confrontos_time_a_id_fkey"
            columns: ["time_a_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_confrontos_time_b_id_fkey"
            columns: ["time_b_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
        ]
      }
      jogos: {
        Row: {
          api_football_fixture_id: number | null
          api_football_league_id: number | null
          created_at: string
          data_hora: string
          estadio: string | null
          id: string
          liga: string | null
          status: string
          time_casa_id: string
          time_visitante_id: string
          updated_at: string
        }
        Insert: {
          api_football_fixture_id?: number | null
          api_football_league_id?: number | null
          created_at?: string
          data_hora: string
          estadio?: string | null
          id?: string
          liga?: string | null
          status?: string
          time_casa_id: string
          time_visitante_id: string
          updated_at?: string
        }
        Update: {
          api_football_fixture_id?: number | null
          api_football_league_id?: number | null
          created_at?: string
          data_hora?: string
          estadio?: string | null
          id?: string
          liga?: string | null
          status?: string
          time_casa_id?: string
          time_visitante_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jogos_time_casa_id_fkey"
            columns: ["time_casa_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jogos_time_visitante_id_fkey"
            columns: ["time_visitante_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
        ]
      }
      jogos_historicos_time: {
        Row: {
          adversario_id: string | null
          adversario_nome: string
          casa_ou_fora: string
          competicao: string | null
          created_at: string
          data: string
          fonte: string
          gols_contra: number
          gols_pro: number
          id: string
          resultado: string
          time_id: string
        }
        Insert: {
          adversario_id?: string | null
          adversario_nome: string
          casa_ou_fora: string
          competicao?: string | null
          created_at?: string
          data: string
          fonte?: string
          gols_contra?: number
          gols_pro?: number
          id?: string
          resultado: string
          time_id: string
        }
        Update: {
          adversario_id?: string | null
          adversario_nome?: string
          casa_ou_fora?: string
          competicao?: string | null
          created_at?: string
          data?: string
          fonte?: string
          gols_contra?: number
          gols_pro?: number
          id?: string
          resultado?: string
          time_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jogos_historicos_time_adversario_id_fkey"
            columns: ["adversario_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jogos_historicos_time_time_id_fkey"
            columns: ["time_id"]
            isOneToOne: false
            referencedRelation: "times"
            referencedColumns: ["id"]
          },
        ]
      }
      odds: {
        Row: {
          atualizado_em: string
          casa_de_apostas: string
          id: string
          jogo_id: string
          odd_casa: number
          odd_empate: number
          odd_visitante: number
        }
        Insert: {
          atualizado_em?: string
          casa_de_apostas: string
          id?: string
          jogo_id: string
          odd_casa: number
          odd_empate: number
          odd_visitante: number
        }
        Update: {
          atualizado_em?: string
          casa_de_apostas?: string
          id?: string
          jogo_id?: string
          odd_casa?: number
          odd_empate?: number
          odd_visitante?: number
        }
        Relationships: [
          {
            foreignKeyName: "odds_jogo_id_fkey"
            columns: ["jogo_id"]
            isOneToOne: false
            referencedRelation: "jogos"
            referencedColumns: ["id"]
          },
        ]
      }
      previsoes: {
        Row: {
          comparativo: Json | null
          conselho: string | null
          criado_em: string
          id: string
          jogo_id: string
          modelo_usado: string
          prob_casa: number
          prob_empate: number
          prob_visitante: number
        }
        Insert: {
          comparativo?: Json | null
          conselho?: string | null
          criado_em?: string
          id?: string
          jogo_id: string
          modelo_usado?: string
          prob_casa: number
          prob_empate: number
          prob_visitante: number
        }
        Update: {
          comparativo?: Json | null
          conselho?: string | null
          criado_em?: string
          id?: string
          jogo_id?: string
          modelo_usado?: string
          prob_casa?: number
          prob_empate?: number
          prob_visitante?: number
        }
        Relationships: [
          {
            foreignKeyName: "previsoes_jogo_id_fkey"
            columns: ["jogo_id"]
            isOneToOne: false
            referencedRelation: "jogos"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_history: {
        Row: {
          chapter_title: string | null
          chapter_url: string
          deleted_at: string | null
          id: string
          last_read_at: string
          novel_title: string
          novel_url: string
          scroll_percent: number
          scroll_position: number
          tts_char_index: number
          user_id: string
        }
        Insert: {
          chapter_title?: string | null
          chapter_url: string
          deleted_at?: string | null
          id?: string
          last_read_at?: string
          novel_title: string
          novel_url: string
          scroll_percent?: number
          scroll_position?: number
          tts_char_index?: number
          user_id: string
        }
        Update: {
          chapter_title?: string | null
          chapter_url?: string
          deleted_at?: string | null
          id?: string
          last_read_at?: string
          novel_title?: string
          novel_url?: string
          scroll_percent?: number
          scroll_position?: number
          tts_char_index?: number
          user_id?: string
        }
        Relationships: []
      }
      times: {
        Row: {
          created_at: string
          estadio: string | null
          id: string
          liga: string | null
          logo_url: string | null
          nome: string
          pais: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          estadio?: string | null
          id?: string
          liga?: string | null
          logo_url?: string | null
          nome: string
          pais?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          estadio?: string | null
          id?: string
          liga?: string | null
          logo_url?: string | null
          nome?: string
          pais?: string | null
          updated_at?: string
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
