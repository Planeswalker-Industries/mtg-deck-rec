export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      app_config: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: number
          payload: Json | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: never
          payload?: Json | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: never
          payload?: Json | null
        }
        Relationships: []
      }
      card_global_stats: {
        Row: {
          card_id: number
          computed_at: string
          decks_with: number
          eligible_decks: number
          rate: number
        }
        Insert: {
          card_id: number
          computed_at?: string
          decks_with: number
          eligible_decks: number
          rate: number
        }
        Update: {
          card_id?: number
          computed_at?: string
          decks_with?: number
          eligible_decks?: number
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_global_stats_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_names: {
        Row: {
          card_id: number
          kind: string
          name_loose: string | null
          name_normalized: string
        }
        Insert: {
          card_id: number
          kind: string
          name_loose?: string | null
          name_normalized: string
        }
        Update: {
          card_id?: number
          kind?: string
          name_loose?: string | null
          name_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_names_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_stats: {
        Row: {
          card_id: number
          cheapest_finish: string | null
          cheapest_usd: number | null
          commander_products: number
          computed_at: string
          first_printed_at: string | null
          paper_printings: number
          paper_sets: number
          staple_score: number
        }
        Insert: {
          card_id: number
          cheapest_finish?: string | null
          cheapest_usd?: number | null
          commander_products: number
          computed_at?: string
          first_printed_at?: string | null
          paper_printings: number
          paper_sets: number
          staple_score?: number
        }
        Update: {
          card_id?: number
          cheapest_finish?: string | null
          cheapest_usd?: number | null
          commander_products?: number
          computed_at?: string
          first_printed_at?: string | null
          paper_printings?: number
          paper_sets?: number
          staple_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_stats_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_tags: {
        Row: {
          card_id: number
          tag_id: string
          weight: number
          weight_raw: string
        }
        Insert: {
          card_id: number
          tag_id: string
          weight: number
          weight_raw: string
        }
        Update: {
          card_id?: number
          tag_id?: string
          weight?: number
          weight_raw?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_tags_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          artist: string | null
          can_be_commander: boolean
          card_faces: Json | null
          color_identity: number
          content_hash: string
          copy_limit: number | null
          deleted_at: string | null
          equivalence_base_id: number | null
          game_changer: boolean
          id: number
          images: Json | null
          is_basic_land: boolean
          is_digital_only: boolean
          layout: string
          legal_commander: string
          legalities: Json
          mana_value: number
          name: string
          name_normalized: string
          oracle_id: string
          oracle_text: string | null
          partner_kind: string | null
          partner_qualifier: string | null
          prices_as_of: string | null
          reference_price_finish: string | null
          reference_price_usd: number | null
          released_at: string | null
          rules_hash: string | null
          scryfall_uri: string
          slug: string
          type_line: string
          updated_at: string
        }
        Insert: {
          artist?: string | null
          can_be_commander: boolean
          card_faces?: Json | null
          color_identity: number
          content_hash: string
          copy_limit?: number | null
          deleted_at?: string | null
          equivalence_base_id?: number | null
          game_changer?: boolean
          id?: never
          images?: Json | null
          is_basic_land: boolean
          is_digital_only: boolean
          layout: string
          legal_commander: string
          legalities: Json
          mana_value: number
          name: string
          name_normalized: string
          oracle_id: string
          oracle_text?: string | null
          partner_kind?: string | null
          partner_qualifier?: string | null
          prices_as_of?: string | null
          reference_price_finish?: string | null
          reference_price_usd?: number | null
          released_at?: string | null
          rules_hash?: string | null
          scryfall_uri: string
          slug: string
          type_line: string
          updated_at?: string
        }
        Update: {
          artist?: string | null
          can_be_commander?: boolean
          card_faces?: Json | null
          color_identity?: number
          content_hash?: string
          copy_limit?: number | null
          deleted_at?: string | null
          equivalence_base_id?: number | null
          game_changer?: boolean
          id?: never
          images?: Json | null
          is_basic_land?: boolean
          is_digital_only?: boolean
          layout?: string
          legal_commander?: string
          legalities?: Json
          mana_value?: number
          name?: string
          name_normalized?: string
          oracle_id?: string
          oracle_text?: string | null
          partner_kind?: string | null
          partner_qualifier?: string | null
          prices_as_of?: string | null
          reference_price_finish?: string | null
          reference_price_usd?: number | null
          released_at?: string | null
          rules_hash?: string | null
          scryfall_uri?: string
          slug?: string
          type_line?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_equivalence_base_id_fkey"
            columns: ["equivalence_base_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_import_rows: {
        Row: {
          card_id: number
          condition: string
          finish: string
          import_id: number
          lang: string
          printing_id: string | null
          quantity: number
        }
        Insert: {
          card_id: number
          condition: string
          finish: string
          import_id: number
          lang: string
          printing_id?: string | null
          quantity: number
        }
        Update: {
          card_id?: number
          condition?: string
          finish?: string
          import_id?: number
          lang?: string
          printing_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "collection_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_imports: {
        Row: {
          committed_at: string | null
          created_at: string
          id: number
          mode: string
          rows_total: number
          source_app: string
          status: string
          user_id: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          id?: never
          mode: string
          rows_total?: number
          source_app: string
          status?: string
          user_id: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          id?: never
          mode?: string
          rows_total?: number
          source_app?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      collection_items: {
        Row: {
          card_id: number
          condition: string
          finish: string
          id: number
          import_id: number | null
          lang: string
          printing_id: string | null
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          card_id: number
          condition: string
          finish: string
          id?: never
          import_id?: number | null
          lang: string
          printing_id?: string | null
          quantity: number
          updated_at?: string
          user_id: string
        }
        Update: {
          card_id?: number
          condition?: string
          finish?: string
          id?: never
          import_id?: number | null
          lang?: string
          printing_id?: string | null
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "collection_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_printing_id_fkey"
            columns: ["printing_id"]
            isOneToOne: false
            referencedRelation: "printings"
            referencedColumns: ["id"]
          },
        ]
      }
      commander_card_stats: {
        Row: {
          card_id: number
          commander_key_id: number
          decks_with: number
          eligible_decks: number | null
          inclusion_shrunk: number
          synergy: number
        }
        Insert: {
          card_id: number
          commander_key_id: number
          decks_with: number
          eligible_decks?: number | null
          inclusion_shrunk: number
          synergy: number
        }
        Update: {
          card_id?: number
          commander_key_id?: number
          decks_with?: number
          eligible_decks?: number | null
          inclusion_shrunk?: number
          synergy?: number
        }
        Relationships: [
          {
            foreignKeyName: "commander_card_stats_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commander_card_stats_commander_key_id_fkey"
            columns: ["commander_key_id"]
            isOneToOne: false
            referencedRelation: "commander_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      commander_keys: {
        Row: {
          color_identity: number
          commander_1: number
          commander_2: number | null
          created_at: string
          id: number
          slug: string
        }
        Insert: {
          color_identity: number
          commander_1: number
          commander_2?: number | null
          created_at?: string
          id?: never
          slug: string
        }
        Update: {
          color_identity?: number
          commander_1?: number
          commander_2?: number | null
          created_at?: string
          id?: never
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "commander_keys_commander_1_fkey"
            columns: ["commander_1"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commander_keys_commander_2_fkey"
            columns: ["commander_2"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      commander_requests: {
        Row: {
          client_key: string | null
          commander_card_id: number
          created_at: string
          decks_collected: number
          decks_listed: number | null
          decks_target: number
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: number
          started_at: string | null
          status: Database["public"]["Enums"]["commander_request_status"]
          updated_at: string
        }
        Insert: {
          client_key?: string | null
          commander_card_id: number
          created_at?: string
          decks_collected?: number
          decks_listed?: number | null
          decks_target: number
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: never
          started_at?: string | null
          status?: Database["public"]["Enums"]["commander_request_status"]
          updated_at?: string
        }
        Update: {
          client_key?: string | null
          commander_card_id?: number
          created_at?: string
          decks_collected?: number
          decks_listed?: number | null
          decks_target?: number
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: never
          started_at?: string | null
          status?: Database["public"]["Enums"]["commander_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commander_requests_commander_card_id_fkey"
            columns: ["commander_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      commander_stats: {
        Row: {
          bracket_counts: Json
          commander_key_id: number
          computed_at: string
          deck_count: number
          deck_months: Json
          role_profile: Json
          source_counts: Json
        }
        Insert: {
          bracket_counts: Json
          commander_key_id: number
          computed_at?: string
          deck_count: number
          deck_months?: Json
          role_profile?: Json
          source_counts: Json
        }
        Update: {
          bracket_counts?: Json
          commander_key_id?: number
          computed_at?: string
          deck_count?: number
          deck_months?: Json
          role_profile?: Json
          source_counts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "commander_stats_commander_key_id_fkey"
            columns: ["commander_key_id"]
            isOneToOne: true
            referencedRelation: "commander_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_identity_stats: {
        Row: {
          color_identity: number
          computed_at: string
          deck_months: Json
        }
        Insert: {
          color_identity: number
          computed_at?: string
          deck_months: Json
        }
        Update: {
          color_identity?: number
          computed_at?: string
          deck_months?: Json
        }
        Relationships: []
      }
      deck_cards: {
        Row: {
          card_id: number
          deck_id: string
          quantity: number
          section: string
        }
        Insert: {
          card_id: number
          deck_id: string
          quantity: number
          section: string
        }
        Update: {
          card_id?: number
          deck_id?: string
          quantity?: number
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_cards_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          bracket: number | null
          card_count: number
          color_identity: number
          commander_1: number | null
          commander_2: number | null
          created_at: string
          id: string
          include_in_corpus: boolean
          is_public: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bracket?: number | null
          card_count?: number
          color_identity?: number
          commander_1?: number | null
          commander_2?: number | null
          created_at?: string
          id?: string
          include_in_corpus?: boolean
          is_public?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bracket?: number | null
          card_count?: number
          color_identity?: number
          commander_1?: number | null
          commander_2?: number | null
          created_at?: string
          id?: string
          include_in_corpus?: boolean
          is_public?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decks_commander_1_fkey"
            columns: ["commander_1"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decks_commander_2_fkey"
            columns: ["commander_2"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      formats: {
        Row: {
          code: string
          deck_size: number
          has_command_zone: boolean
          name: string
          scryfall_legality_key: string
          singleton: boolean
          uses_color_identity: boolean
        }
        Insert: {
          code: string
          deck_size: number
          has_command_zone: boolean
          name: string
          scryfall_legality_key: string
          singleton: boolean
          uses_color_identity: boolean
        }
        Update: {
          code?: string
          deck_size?: number
          has_command_zone?: boolean
          name?: string
          scryfall_legality_key?: string
          singleton?: boolean
          uses_color_identity?: boolean
        }
        Relationships: []
      }
      printings: {
        Row: {
          card_id: number
          collector_number: string
          content_hash: string
          deleted_at: string | null
          finishes: string[]
          id: string
          is_digital: boolean
          lang: string
          prices_as_of: string | null
          released_at: string | null
          set_code: string
          tcgplayer_etched_id: number | null
          tcgplayer_id: number | null
          usd: number | null
          usd_etched: number | null
          usd_foil: number | null
        }
        Insert: {
          card_id: number
          collector_number: string
          content_hash: string
          deleted_at?: string | null
          finishes: string[]
          id: string
          is_digital: boolean
          lang: string
          prices_as_of?: string | null
          released_at?: string | null
          set_code: string
          tcgplayer_etched_id?: number | null
          tcgplayer_id?: number | null
          usd?: number | null
          usd_etched?: number | null
          usd_foil?: number | null
        }
        Update: {
          card_id?: number
          collector_number?: string
          content_hash?: string
          deleted_at?: string | null
          finishes?: string[]
          id?: string
          is_digital?: boolean
          lang?: string
          prices_as_of?: string | null
          released_at?: string | null
          set_code?: string
          tcgplayer_etched_id?: number | null
          tcgplayer_id?: number | null
          usd?: number | null
          usd_etched?: number | null
          usd_foil?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "printings_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      share_import_sources: {
        Row: {
          disabled_at: string | null
          disabled_reason: string | null
          enabled: boolean
          last_blocked_status: number | null
          source: string
          updated_at: string
        }
        Insert: {
          disabled_at?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          last_blocked_status?: number | null
          source: string
          updated_at?: string
        }
        Update: {
          disabled_at?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          last_blocked_status?: number | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      slug_redirects: {
        Row: {
          kind: string
          old_slug: string
          target_id: number
        }
        Insert: {
          kind: string
          old_slug: string
          target_id: number
        }
        Update: {
          kind?: string
          old_slug?: string
          target_id?: number
        }
        Relationships: []
      }
      swap_votes: {
        Row: {
          commander_ids: number[]
          commander_key_id: number | null
          created_at: string
          id: number
          matched_tag_ids: string[]
          replacement_card_id: number
          session_id: string | null
          shown_card_ids: number[]
          shown_position: number | null
          source: string
          target_card_id: number
          updated_at: string
          user_id: string | null
          value: number
          voter_key: string
        }
        Insert: {
          commander_ids?: number[]
          commander_key_id?: number | null
          created_at?: string
          id?: never
          matched_tag_ids?: string[]
          replacement_card_id: number
          session_id?: string | null
          shown_card_ids?: number[]
          shown_position?: number | null
          source: string
          target_card_id: number
          updated_at?: string
          user_id?: string | null
          value: number
          voter_key: string
        }
        Update: {
          commander_ids?: number[]
          commander_key_id?: number | null
          created_at?: string
          id?: never
          matched_tag_ids?: string[]
          replacement_card_id?: number
          session_id?: string | null
          shown_card_ids?: number[]
          shown_position?: number | null
          source?: string
          target_card_id?: number
          updated_at?: string
          user_id?: string | null
          value?: number
          voter_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_votes_commander_key_id_fkey"
            columns: ["commander_key_id"]
            isOneToOne: false
            referencedRelation: "commander_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_votes_replacement_card_id_fkey"
            columns: ["replacement_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_votes_target_card_id_fkey"
            columns: ["target_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          checkpoint: Json | null
          error: string | null
          finished_at: string | null
          heartbeat_at: string
          id: number
          job: Database["public"]["Enums"]["sync_job"]
          metrics: Json | null
          rows_changed: number
          rows_read: number
          source_updated_at: string | null
          source_uri: string | null
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
          worker_id: string
        }
        Insert: {
          checkpoint?: Json | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: never
          job: Database["public"]["Enums"]["sync_job"]
          metrics?: Json | null
          rows_changed?: number
          rows_read?: number
          source_updated_at?: string | null
          source_uri?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
          worker_id: string
        }
        Update: {
          checkpoint?: Json | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: never
          job?: Database["public"]["Enums"]["sync_job"]
          metrics?: Json | null
          rows_changed?: number
          rows_read?: number
          source_updated_at?: string | null
          source_uri?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
          worker_id?: string
        }
        Relationships: []
      }
      tag_closure: {
        Row: {
          ancestor_id: string
          depth: number
          descendant_id: string
        }
        Insert: {
          ancestor_id: string
          depth: number
          descendant_id: string
        }
        Update: {
          ancestor_id?: string
          depth?: number
          descendant_id?: string
        }
        Relationships: []
      }
      tag_edges: {
        Row: {
          child_id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          parent_id: string
        }
        Update: {
          child_id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_edges_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_edges_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          card_count: number
          content_hash: string
          deleted_at: string | null
          description: string | null
          disabled: boolean
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          id: string
          idf: number
          label: string
          slug: string
          type: string
          updated_at: string
        }
        Insert: {
          card_count?: number
          content_hash: string
          deleted_at?: string | null
          description?: string | null
          disabled?: boolean
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id: string
          idf?: number
          label: string
          slug: string
          type: string
          updated_at?: string
        }
        Update: {
          card_count?: number
          content_hash?: string
          deleted_at?: string | null
          description?: string | null
          disabled?: boolean
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          idf?: number
          label?: string
          slug?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      worker_status: {
        Row: {
          heartbeat_at: string
          name: string
        }
        Insert: {
          heartbeat_at: string
          name: string
        }
        Update: {
          heartbeat_at?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      collection_cards: {
        Row: {
          card_id: number | null
          quantity: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      functional_tags: {
        Row: {
          tag_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      card_functional_tags: {
        Args: { p_card_id: number }
        Returns: {
          depth: number
          label: string
          slug: string
          tag_id: string
        }[]
      }
      card_top_commanders: {
        Args: { p_card_id: number; p_limit?: number; p_min_decks: number }
        Returns: {
          commander_1: number
          commander_2: number
          commander_key_id: number
          decks_with: number
          eligible_decks: number
          slug: string
        }[]
      }
      cast_swap_vote: {
        Args: {
          p_commander_ids?: number[]
          p_commander_key_id?: number
          p_matched_tag_ids?: string[]
          p_position?: number
          p_replacement: number
          p_session_id?: string
          p_shown_card_ids?: number[]
          p_source?: string
          p_target: number
          p_value: number
          p_visitor_key: string
        }
        Returns: Json
      }
      catalog_epoch: { Args: never; Returns: string }
      clean_deck_name: {
        Args: { p_max: number; p_name: string }
        Returns: string
      }
      commander_collector_online: { Args: never; Returns: boolean }
      commander_request_config: { Args: never; Returns: Json }
      commander_request_json: {
        Args: {
          p_client_key: string
          r: Database["public"]["Tables"]["commander_requests"]["Row"]
        }
        Returns: Json
      }
      commander_request_recent: {
        Args: { p_card_id: number }
        Returns: {
          client_key: string | null
          commander_card_id: number
          created_at: string
          decks_collected: number
          decks_listed: number | null
          decks_target: number
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: number
          started_at: string | null
          status: Database["public"]["Enums"]["commander_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commander_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_collection_import: { Args: { p_import_id: number }; Returns: Json }
      duplicate_deck: {
        Args: { p_deck_id: string; p_name?: string }
        Returns: string
      }
      get_commander_request: {
        Args: { p_card_id: number; p_client_key: string }
        Returns: Json
      }
      get_commander_request_status: {
        Args: { p_client_key: string; p_request_id: number }
        Returns: Json
      }
      get_public_config: { Args: { p_key: string }; Returns: Json }
      hit_rate_limit: {
        Args: { p_bucket: string; p_visitor: string }
        Returns: number
      }
      my_collection_totals: { Args: never; Returns: Json }
      my_owned_card_ids: { Args: never; Returns: number[] }
      prices_checked_at: { Args: never; Returns: string }
      rebuild_tag_closure: { Args: never; Returns: undefined }
      rec_add_candidates:
        | {
            Args: {
              p_allow_game_changers: boolean
              p_alpha: number
              p_deck_count: number
              p_exclude: number[]
              p_identity_mask: number
              p_key_ids: number[]
              p_limit?: number
              p_owned?: number[]
            }
            Returns: {
              baseline: number
              card_id: number
              decks_with: number
            }[]
          }
        | {
            Args: {
              p_allow_game_changers: boolean
              p_alpha: number
              p_exclude: number[]
              p_identity_mask: number
              p_key_ids: number[]
              p_key_weights: number[]
              p_limit?: number
              p_owned?: number[]
            }
            Returns: {
              baseline: number
              card_id: number
              decks_with: number
            }[]
          }
      rec_card_roles: {
        Args: { p_card_ids: number[]; p_role_ids: string[] }
        Returns: {
          card_id: number
          role_id: string
        }[]
      }
      rec_functional_tag_count: { Args: { p_card_id: number }; Returns: number }
      rec_swap_candidates: {
        Args: {
          p_allow_game_changers: boolean
          p_exclude: number[]
          p_identity_mask: number
          p_limit?: number
          p_owned?: number[]
          p_target: number
        }
        Returns: {
          card_id: number
          is_functional_twin: boolean
          matches: Json
          staple_score: number
          tag_similarity: number
        }[]
      }
      rename_deck: {
        Args: { p_deck_id: string; p_name: string }
        Returns: undefined
      }
      request_commander_decks: {
        Args: { p_card_id: number; p_client_key: string }
        Returns: Json
      }
      resolve_card_names: {
        Args: { p_names: string[] }
        Returns: {
          card_id: number
          input: string
          rank: number
          score: number
          via: string
        }[]
      }
      resolve_collection_rows: {
        Args: { p_rows: Json }
        Returns: {
          card_id: number
          finishes: string[]
          lang: string
          printing_id: string
          row_no: number
          via: string
        }[]
      }
      save_collection_rows: {
        Args: { p_import_id: number; p_rows: Json }
        Returns: number
      }
      save_deck: {
        Args: {
          p_bracket?: number
          p_cards?: Json
          p_deck_id?: string
          p_name?: string
        }
        Returns: string
      }
      search_cards: {
        Args: { p_commander_only?: boolean; p_limit?: number; p_query: string }
        Returns: {
          card_id: number
        }[]
      }
      set_deck_visibility: {
        Args: { p_deck_id: string; p_is_public: boolean }
        Returns: undefined
      }
      sitemap_slugs: { Args: never; Returns: Json }
      start_collection_import: {
        Args: { p_mode: string; p_source_app: string }
        Returns: number
      }
    }
    Enums: {
      commander_request_status:
        | "queued"
        | "checking"
        | "collecting"
        | "aggregating"
        | "done"
        | "not_enough_decks"
        | "failed"
      deck_source: "archidekt" | "moxfield" | "user" | "precon"
      sync_job:
        | "scryfall_catalog"
        | "oracle_tags"
        | "archidekt_crawl"
        | "corpus_aggregate"
        | "precon_import"
        | "vote_aggregate"
        | "scryfall_printings"
      sync_status:
        | "running"
        | "succeeded"
        | "skipped_unchanged"
        | "failed"
        | "failed_sanity"
        | "abandoned"
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
      commander_request_status: [
        "queued",
        "checking",
        "collecting",
        "aggregating",
        "done",
        "not_enough_decks",
        "failed",
      ],
      deck_source: ["archidekt", "moxfield", "user", "precon"],
      sync_job: [
        "scryfall_catalog",
        "oracle_tags",
        "archidekt_crawl",
        "corpus_aggregate",
        "precon_import",
        "vote_aggregate",
        "scryfall_printings",
      ],
      sync_status: [
        "running",
        "succeeded",
        "skipped_unchanged",
        "failed",
        "failed_sanity",
        "abandoned",
      ],
    },
  },
} as const

