import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  url?.trim() && anonKey?.trim(),
);

/**
 * Cliente Supabase para Realtime (Broadcast) e futuras APIs.
 * Null se VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não estiverem no .env (build).
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!.trim(), anonKey!.trim(), {
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null;
