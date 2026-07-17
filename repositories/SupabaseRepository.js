export class SupabaseRepository {
  constructor(supabaseClient, fallbackRepository = null) {
    this.supabase = supabaseClient;
    this.fallback = fallbackRepository;
    this.mode = "supabase";
    this.available = Boolean(supabaseClient);
    this.offline = !this.available;
  }

  async healthCheck() {
    if (!this.supabase) {
      this.switchOffline();
      return false;
    }

    const { error } = await this.supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) this.switchOffline();
    else {
      this.available = true;
      this.offline = false;
      this.mode = "supabase";
    }
    return this.available;
  }

  async getJsonSetting(key, fallback = null) {
    if (!this.available) return this.fallback?.getJson(key, fallback) ?? fallback;

    const { data, error } = await this.supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", key)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      this.switchOffline();
      return this.fallback?.getJson(key, fallback) ?? fallback;
    }

    return data?.setting_value ?? fallback;
  }

  async setJsonSetting(key, value) {
    if (!this.available) {
      this.fallback?.setJson(key, value);
      return;
    }

    const { error } = await this.supabase
      .from("settings")
      .upsert({
        setting_key: key,
        setting_value: value,
        deleted_at: null
      }, { onConflict: "setting_key" });

    if (error) {
      this.switchOffline();
      this.fallback?.setJson(key, value);
      return;
    }

    this.fallback?.setJson(key, value);
  }

  async list(table, filters = {}) {
    if (!this.available) return [];
    let query = this.supabase.from(table).select("*").is("deleted_at", null);
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    const { data, error } = await query;
    if (error) {
      this.switchOffline();
      return [];
    }
    return data || [];
  }

  async upsert(table, row, conflictTarget = "id") {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from(table)
      .upsert(row, { onConflict: conflictTarget })
      .select()
      .single();
    if (error) {
      this.switchOffline();
      return null;
    }
    return data;
  }

  async softDelete(table, id) {
    if (!this.available) return false;
    const { error } = await this.supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      this.switchOffline();
      return false;
    }
    return true;
  }

  switchOffline() {
    this.available = false;
    this.offline = true;
    this.mode = "localStorage";
  }
}
