import { supabase } from "../src/supabase.js";

export function createSupabaseClient() {
  return supabase;
}

export const supabaseClient = supabase;
