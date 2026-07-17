import { createClient } from "@supabase/supabase-js";

const config = window.BKT_SUPABASE_CONFIG;

if (!config?.url || !config?.publishableKey) {
  throw new Error("Supabase bağlantı bilgileri eksik.");
}

export const supabase = createClient(
  config.url,
  config.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
