import { createSupabaseClient } from "../supabase/supabaseClient.js";
import { LocalStorageRepository } from "./LocalStorageRepository.js";
import { SupabaseRepository } from "./SupabaseRepository.js";

export async function createRepository(options = {}) {
  const localStorageRepository = new LocalStorageRepository(options.storage);
  const supabaseClient = options.supabaseClient || createSupabaseClient(options);
  const supabaseRepository = new SupabaseRepository(supabaseClient, localStorageRepository);

  await supabaseRepository.healthCheck();
  return supabaseRepository;
}

export { LocalStorageRepository, SupabaseRepository };
