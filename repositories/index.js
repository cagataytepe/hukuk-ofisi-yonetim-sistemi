import { createSupabaseClient } from "../supabase/supabaseClient.js";
import { SupabaseRepository } from "./SupabaseRepository.js";

export async function createRepository(options = {}) {
  const supabaseClient = options.supabaseClient || createSupabaseClient(options);
  const supabaseRepository = new SupabaseRepository(supabaseClient);

  await supabaseRepository.healthCheck();
  return supabaseRepository;
}

export { SupabaseRepository };
