import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let client: SupabaseClient | null = null;

export const isSupabaseConfigured = (): boolean => {
  if (import.meta.env.VITE_MOCK_AUTH === "true") return false;
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (
    supabaseUrl.includes("your-project.supabase.co") ||
    supabaseAnonKey.includes("your-anon-key") ||
    supabaseAnonKey === "placeholder"
  ) {
    return false;
  }
  return true;
};

export const getSupabaseClient = (): SupabaseClient => {
  if (!client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Supabase credentials not configured. Please define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file."
      );
    }
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
};
