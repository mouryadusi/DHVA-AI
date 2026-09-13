// Hand-written to match supabase/migrations/0001_init.sql exactly.
//
// Note: this is NOT run through `supabase gen types` because that requires
// a live, linked Supabase project (network access this build environment
// doesn't have). Once you have `supabase` CLI linked to a real project, run:
//
//   supabase gen types typescript --linked > lib/types/database.ts
//
// ...and replace this file with the generated one — it will be a superset
// of what's here and will stay in sync with schema changes automatically.

export type CallStatus = "in_progress" | "completed" | "failed" | "no_answer";
export type CallOutcome =
  | "booked"
  | "order_placed"
  | "message_taken"
  | "transferred"
  | "answered_faq"
  | "abandoned"
  | null;

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string };
        Update: Partial<{ name: string }>;
      };
      org_members: {
        Row: { org_id: string; user_id: string; role: "owner" | "admin" | "member"; created_at: string };
        Insert: { org_id: string; user_id: string; role?: "owner" | "admin" | "member" };
        Update: Partial<{ role: "owner" | "admin" | "member" }>;
      };
      businesses: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          slug: string;
          vertical: string;
          description: string | null;
          timezone: string;
          default_language: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          slug: string;
          vertical?: string;
          description?: string | null;
          timezone?: string;
          default_language?: string;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          timezone: string;
          default_language: string;
        }>;
      };
      locations: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          address: string | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: { business_id: string; name: string; address?: string | null; is_primary?: boolean };
        Update: Partial<{ name: string; address: string | null; is_primary: boolean }>;
      };
      phone_numbers: {
        Row: {
          id: string;
          business_id: string;
          e164_number: string;
          provider: "telnyx" | "twilio";
          livekit_trunk_id: string | null;
          livekit_dispatch_rule_id: string | null;
          status: "pending" | "active" | "disabled";
          created_at: string;
        };
        Insert: {
          business_id: string;
          e164_number: string;
          provider?: "telnyx" | "twilio";
          livekit_trunk_id?: string | null;
          livekit_dispatch_rule_id?: string | null;
          status?: "pending" | "active" | "disabled";
        };
        Update: Partial<{
          livekit_trunk_id: string | null;
          livekit_dispatch_rule_id: string | null;
          status: "pending" | "active" | "disabled";
        }>;
      };
      agents: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          greeting: string;
          personality: string;
          language: string;
          llm_provider: "anthropic" | "openai";
          llm_model: string;
          stt_provider: string;
          tts_provider: "cartesia" | "elevenlabs";
          tts_voice_id: string | null;
          escalation_phone_number: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["agents"]["Row"]> & { business_id: string };
        Update: Partial<Database["public"]["Tables"]["agents"]["Row"]>;
      };
      business_hours: {
        Row: {
          id: string;
          business_id: string;
          day_of_week: number;
          open_time: string | null;
          close_time: string | null;
          is_closed: boolean;
        };
        Insert: {
          business_id: string;
          day_of_week: number;
          open_time?: string | null;
          close_time?: string | null;
          is_closed?: boolean;
        };
        Update: Partial<{ open_time: string | null; close_time: string | null; is_closed: boolean }>;
      };
      services: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          description: string | null;
          duration_minutes: number | null;
          price_cents: number | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          business_id: string;
          name: string;
          description?: string | null;
          duration_minutes?: number | null;
          price_cents?: number | null;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["services"]["Row"]>;
      };
      products: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          description: string | null;
          category: string | null;
          price_cents: number;
          is_available: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          business_id: string;
          name: string;
          description?: string | null;
          category?: string | null;
          price_cents: number;
          is_available?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
      };
      faqs: {
        Row: {
          id: string;
          business_id: string;
          question: string;
          answer: string;
          sort_order: number;
          created_at: string;
        };
        Insert: { business_id: string; question: string; answer: string; sort_order?: number };
        Update: Partial<{ question: string; answer: string; sort_order: number }>;
      };
      business_policies: {
        Row: { id: string; business_id: string; policy_type: string; content: string; created_at: string };
        Insert: { business_id: string; policy_type: string; content: string };
        Update: Partial<{ policy_type: string; content: string }>;
      };
      customers: {
        Row: {
          id: string;
          business_id: string;
          phone_number: string;
          name: string | null;
          email: string | null;
          notes: string | null;
          created_at: string;
          last_contact_at: string | null;
        };
        Insert: {
          business_id: string;
          phone_number: string;
          name?: string | null;
          email?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>;
      };
      calls: {
        Row: {
          id: string;
          business_id: string;
          customer_id: string | null;
          livekit_room_name: string | null;
          direction: "inbound" | "outbound";
          from_number: string | null;
          to_number: string | null;
          started_at: string;
          ended_at: string | null;
          duration_seconds: number | null;
          status: CallStatus;
          outcome: CallOutcome;
          transferred: boolean;
          transfer_reason: string | null;
          recording_consent: boolean;
          needs_review: boolean;
          review_reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["calls"]["Row"]> & { business_id: string };
        Update: Partial<Database["public"]["Tables"]["calls"]["Row"]>;
      };
      call_messages: {
        Row: {
          id: string;
          call_id: string;
          role: "user" | "assistant" | "system" | "tool";
          content: string;
          sequence: number;
          created_at: string;
        };
        Insert: { call_id: string; role: "user" | "assistant" | "system" | "tool"; content: string; sequence: number };
        Update: never;
      };
      call_summaries: {
        Row: {
          id: string;
          call_id: string;
          summary_text: string;
          opportunity_saved: boolean;
          created_at: string;
        };
        Insert: { call_id: string; summary_text: string; opportunity_saved?: boolean };
        Update: never;
      };
      tool_executions: {
        Row: {
          id: string;
          call_id: string;
          tool_name: string;
          input_json: Record<string, unknown>;
          output_json: Record<string, unknown> | null;
          success: boolean;
          error_message: string | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          call_id: string;
          tool_name: string;
          input_json: Record<string, unknown>;
          output_json?: Record<string, unknown> | null;
          success: boolean;
          error_message?: string | null;
          latency_ms?: number | null;
        };
        Update: never;
      };
      integrations: {
        Row: {
          id: string;
          business_id: string;
          provider: string;
          config_json: Record<string, unknown>;
          status: "active" | "disabled" | "error";
          created_at: string;
        };
        Insert: {
          business_id: string;
          provider: string;
          config_json?: Record<string, unknown>;
          status?: "active" | "disabled" | "error";
        };
        Update: Partial<{ config_json: Record<string, unknown>; status: "active" | "disabled" | "error" }>;
      };
      audit_logs: {
        Row: {
          id: string;
          org_id: string | null;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata_json: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          org_id?: string | null;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata_json?: Record<string, unknown>;
        };
        Update: never;
      };
    };
  };
}
