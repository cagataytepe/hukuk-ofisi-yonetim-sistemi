export class SupabaseRepository {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
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
    if (!this.available) return fallback;

    const { data, error } = await this.supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", key)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      this.switchOffline();
      return fallback;
    }

    return data?.setting_value ?? fallback;
  }

  async setJsonSetting(key, value) {
    if (!this.available) {
      throw new Error("Supabase bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.");
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
      throw error;
    }
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
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) {
      console.error("[BKT collections delete] Supabase RPC soft delete empty result.", { id, status, statusText });
      throw new Error("Collection was not found or was already deleted.");
    }
    return rows[0];
  }

  async getFiles() {
    if (!this.available) return [];
    const { data, error } = await this.supabase
      .from("files")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      this.switchOffline();
      return [];
    }
    return data || [];
  }

  async getFileIdCandidates() {
    if (!this.available) return [];
    const { data, error } = await this.supabase
      .from("files")
      .select("id,legacy_id,display_id,record_kind,file_type,follow_type,metadata,deleted_at,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    return data || [];
  }

  async getDashboardData(filters = {}) {
    if (!this.available) {
      return {
        files: [],
        upcomingHearings: [],
        recentFiles: [],
        recentHearings: [],
        assignedTasks: [],
        overdueTasks: [],
        deadlines: [],
        deadlineError: "",
        taskError: "",
        profiles: [],
        generatedAt: new Date().toISOString()
      };
    }
    const now = new Date();
    const todayIso = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
    let profileId = this.isUuid(filters.profileId) ? filters.profileId : "";
    if (!profileId) {
      try {
        const { data } = await this.supabase.auth.getUser();
        profileId = this.isUuid(data?.user?.id) ? data.user.id : "";
      } catch (error) {
        console.error("[BKT dashboard tasks] Current profile id could not be resolved.", { message: error?.message || String(error) });
      }
    }
    const [filesResult, upcomingResult, deadlinesResult, profilesResult] = await Promise.all([
      this.supabase.from("files").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      this.supabase.from("hearings").select("*").is("deleted_at", null).gte("hearing_date", todayIso).order("hearing_date", { ascending: true }).order("hearing_time", { ascending: true }),
      this.supabase.from("deadlines").select("*").is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }),
      this.supabase.from("profiles").select("id,display_name,email,title,role_id,is_active,deleted_at").is("deleted_at", null).eq("is_active", true).order("display_name", { ascending: true })
    ]);
    const failed = [filesResult, upcomingResult, deadlinesResult, profilesResult].find(result => result.error);
    if (failed) {
      console.error("[BKT dashboard] Supabase dashboard verisi okunamadı.", failed.error);
      throw failed.error;
    }
    let assignedTasks = [];
    let overdueTasks = [];
    let taskError = "";
    try {
      const assignedTaskQuery = profileId
        ? this.supabase
            .from("tasks")
            .select("*")
            .is("deleted_at", null)
            .eq("responsible_profile_id", profileId)
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const overdueTaskQuery = this.supabase
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .lt("due_date", todayIso)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      const [assignedResult, overdueResult] = await Promise.all([assignedTaskQuery, overdueTaskQuery]);
      const taskFailure = [assignedResult, overdueResult].find(result => result.error);
      if (taskFailure) throw taskFailure.error;
      assignedTasks = assignedResult.data || [];
      overdueTasks = overdueResult.data || [];
    } catch (error) {
      console.error("[BKT dashboard tasks] Supabase task data could not be loaded.", {
        code: error?.code,
        message: error?.message || String(error),
        details: error?.details,
        hint: error?.hint
      });
      taskError = "Görev bilgileri yüklenemedi.";
    }
    return {
      files: filesResult.data || [],
      upcomingHearings: upcomingResult.data || [],
      recentFiles: [],
      recentHearings: [],
      deadlines: deadlinesResult.data || [],
      assignedTasks,
      overdueTasks,
      deadlineError: "",
      taskError,
      profiles: profilesResult.data || [],
      generatedAt: new Date().toISOString()
    };
  }

  async getFile(id) {
    if (!this.available || !id) return null;
    let query = this.supabase
      .from("files")
      .select(`
        id,
        legacy_id,
        display_id,
        record_kind,
        file_type,
        follow_type,
        file_no,
        court_or_office,
        decision_no,
        subject,
        status,
        opening_date,
        responsible_profile_id,
        responsible_name,
        client_name,
        opponent_name,
        description,
        account_info,
        instrument_info,
        metadata,
        created_at,
        updated_at,
        deleted_at,
        responsible_profile:profiles!files_responsible_profile_id_fkey(id,display_name)
      `)
      .is("deleted_at", null);
    query = this.isUuid(id)
      ? query.eq("id", id)
      : query.or(`legacy_id.eq.${escapePostgrestValue(id)},display_id.eq.${escapePostgrestValue(id)}`);
    const { data, error } = await query.maybeSingle();
    if (error) {
      this.switchOffline();
      return null;
    }
    return data || null;
  }

  async createFile(row) {
    if (!this.available) return null;
    let payload = fileCreatePayload(row);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const { data, error } = await this.supabase
        .from("files")
        .insert(payload)
        .select()
        .single();
      if (!error) return data;
      if (!isDuplicateLegacyFileIdError(error) || !payload.legacy_id) {
        this.switchOffline();
        return null;
      }
      const nextPayload = nextFilePayloadWithBumpedLegacyId(payload);
      if (!nextPayload) throw error;
      console.warn("[BKT files create] Legacy ID kullanÄ±ldÄ±ÄŸÄ± iÃ§in yeni ID deneniyor.", {
        previousLegacyId: payload.legacy_id,
        nextLegacyId: nextPayload.legacy_id
      });
      payload = nextPayload;
    }
    throw new Error("Dosya oluÅŸturulamadÄ±: uygun boÅŸ dosya ID deÄŸeri bulunamadÄ±.");
  }

  async updateFile(id, row) {
    if (!this.available || !id) return null;
    let fileId = id;
    if (!this.isUuid(fileId)) {
      const existing = await this.getFile(id);
      fileId = existing?.id || "";
    }
    if (!this.isUuid(fileId)) return null;
    const { data, error } = await this.supabase
      .from("files")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", fileId)
      .select()
      .single();
    if (error) {
      this.switchOffline();
      return null;
    }
    return data;
  }

  async deleteFile(id) {
    if (!this.available || !id) return false;
    let fileId = id;
    if (!this.isUuid(fileId)) {
      const existing = await this.getFile(id);
      fileId = existing?.id || "";
    }
    if (!this.isUuid(fileId)) return false;
    const { data, error } = await this.supabase
      .rpc("soft_delete_file", { p_file_id: fileId });
    if (error) {
      console.error("[BKT files delete] Supabase RPC soft delete hatası.", {
        requestedId: id,
        fileId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) throw new Error("File was not found or was already deleted.");
    return rows[0];
  }

  async getHearings(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("hearings")
      .select("*")
      .is("deleted_at", null)
      .order("hearing_date", { ascending: true })
      .order("hearing_time", { ascending: true });

    if (filters.dateFrom) query = query.gte("hearing_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("hearing_date", filters.dateTo);
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.excuseType) query = query.eq("excuse_type", filters.excuseType);
    if (filters.participantProfileId) query = query.eq("participant_profile_id", filters.participantProfileId);

    const { data, error } = await query;
    if (error) {
      this.switchOffline();
      return [];
    }
    return data || [];
  }

  async getHearing(id) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error } = await this.supabase
      .from("hearings")
      .select("*")
      .eq(column, id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      this.switchOffline();
      return null;
    }
    return data || null;
  }

  async createHearing(row) {
    if (!this.available) return null;
    const { data, error, status, statusText } = await this.supabase
      .from("hearings")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT hearings create] Supabase INSERT hatası.", {
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload: {
          ...row,
          metadata: row?.metadata ? "[metadata]" : row?.metadata,
          outcome: row?.outcome ? "[outcome]" : row?.outcome
        }
      });
      throw error;
    }
    if (!data) throw new Error("Duruşma oluşturuldu ancak kayıt dönmedi.");
    return data;
  }

  async updateHearing(id, row) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error } = await this.supabase
      .from("hearings")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq(column, id)
      .select()
      .single();
    if (error) {
      this.switchOffline();
      return null;
    }
    return data;
  }

  async deleteHearing(id) {
    if (!this.available || !id) return false;
    let hearingId = id;
    if (!this.isUuid(hearingId)) {
      const existing = await this.getHearing(id);
      hearingId = existing?.id || "";
    }
    if (!this.isUuid(hearingId)) {
      console.error("[BKT hearings delete] Duruşma UUID bulunamadı.", { requestedId: id, resolvedId: hearingId });
      throw new Error("Duruşma UUID bulunamadı.");
    }
    const { data, error, status, statusText } = await this.supabase
      .rpc("soft_delete_hearing", { p_hearing_id: hearingId });
    if (error) {
      console.error("[BKT hearings delete] Supabase RPC soft delete hatası.", {
        requestedId: id,
        hearingId,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) {
      const notFound = new Error("Duruşma kaydı bulunamadı veya zaten silinmiş.");
      console.error("[BKT hearings delete] Supabase RPC soft delete satır döndürmedi.", {
        requestedId: id,
        hearingId,
        status,
        statusText
      });
      throw notFound;
    }
    return rows[0];
  }

  async completeHearing(id, outcome = {}) {
    const existing = await this.getHearing(id);
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateHearing(id, {
      status: "completed",
      outcome: outcome && typeof outcome === "object" ? outcome : { text: String(outcome || "") },
      metadata: { ...metadata, completedAt: new Date().toISOString() }
    });
  }

  async reopenHearing(id) {
    const existing = await this.getHearing(id);
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateHearing(id, {
      status: "scheduled",
      metadata: { ...metadata, reopenedAt: new Date().toISOString() }
    });
  }

  async getDeadlines(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("deadlines")
      .select("*")
      .is("deleted_at", null)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });

    if (filters.dateFrom) query = query.gte("due_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("due_date", filters.dateTo);
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.responsibleProfileId) query = query.eq("responsible_profile_id", filters.responsibleProfileId);

    const { data, error } = await query;
    if (error) {
      console.error("[BKT deadlines] Supabase SELECT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    const [files, profiles] = await Promise.all([
      this.getFiles(),
      this.supabase
        .from("profiles")
        .select("id,display_name,email,title,role_id,is_active,deleted_at")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("display_name", { ascending: true })
    ]);
    if (profiles.error) {
      console.error("[BKT deadlines] Profil listesi okunamadı.", {
        code: profiles.error.code,
        message: profiles.error.message,
        details: profiles.error.details,
        hint: profiles.error.hint
      });
      throw profiles.error;
    }
    const filesById = new Map((files || []).map(file => [file.id, file]));
    const profilesById = new Map((profiles.data || []).map(profile => [profile.id, profile]));
    return (data || []).map(row => ({
      ...row,
      file: filesById.get(row.file_id) || null,
      responsible_profile: profilesById.get(row.responsible_profile_id) || null
    }));
  }

  async getDeadline(id) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error } = await this.supabase
      .from("deadlines")
      .select("*")
      .eq(column, id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("[BKT deadlines] Supabase tek kayıt SELECT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || null;
  }

  async createDeadline(row) {
    if (!this.available) return null;
    const { data, error, status, statusText } = await this.supabase
      .from("deadlines")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT deadlines create] Supabase INSERT hatası.", {
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload: {
          ...row,
          metadata: row?.metadata ? "[metadata]" : row?.metadata
        }
      });
      throw error;
    }
    if (!data) throw new Error("Süreli iş oluşturuldu ancak kayıt dönmedi.");
    return data;
  }

  async updateDeadline(id, row) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error, status, statusText } = await this.supabase
      .from("deadlines")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq(column, id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT deadlines update] Supabase UPDATE hatası.", {
        requestedId: id,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload: {
          ...row,
          metadata: row?.metadata ? "[metadata]" : row?.metadata
        }
      });
      throw error;
    }
    return data;
  }

  async completeDeadline(id) {
    const existing = await this.getDeadline(id);
    if (!existing) throw new Error("Süreli iş kaydı bulunamadı.");
    const today = this.localDateString();
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateDeadline(id, {
      status: "Tamamlandı",
      completed_at: new Date().toISOString(),
      completed_late: Boolean(existing.due_date && existing.due_date < today),
      metadata: { ...metadata, completedFromUiAt: new Date().toISOString() }
    });
  }

  async reopenDeadline(id) {
    const existing = await this.getDeadline(id);
    if (!existing) throw new Error("Süreli iş kaydı bulunamadı.");
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateDeadline(id, {
      status: "Aktif",
      completed_at: null,
      completed_late: false,
      metadata: { ...metadata, reopenedFromUiAt: new Date().toISOString() }
    });
  }

  async deleteDeadline(id) {
    if (!this.available || !id) return false;
    let deadlineId = id;
    if (!this.isUuid(deadlineId)) {
      const existing = await this.getDeadline(id);
      deadlineId = existing?.id || "";
    }
    if (!this.isUuid(deadlineId)) {
      console.error("[BKT deadlines delete] Süreli iş UUID bulunamadı.", { requestedId: id, resolvedId: deadlineId });
      throw new Error("Süreli iş UUID bulunamadı.");
    }
    const { data, error, status, statusText } = await this.supabase
      .rpc("soft_delete_deadline", { p_deadline_id: deadlineId });
    if (error) {
      console.error("[BKT deadlines delete] Supabase RPC soft delete hatası.", {
        requestedId: id,
        deadlineId,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) {
      console.error("[BKT deadlines delete] Supabase RPC soft delete satır döndürmedi.", {
        requestedId: id,
        deadlineId,
        status,
        statusText
      });
      throw new Error("Süreli iş kaydı bulunamadı veya zaten silinmiş.");
    }
    return rows[0];
  }

  async getTasks(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (filters.dateFrom) query = query.gte("due_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("due_date", filters.dateTo);
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.taskType) query = query.eq("task_type", filters.taskType);
    if (filters.priority) query = query.eq("priority", filters.priority);
    const responsibleFilter = filters.responsibleProfileId || filters.assignedToProfileId;
    if (responsibleFilter) query = query.eq("responsible_profile_id", responsibleFilter);

    const { data, error } = await query;
    if (error) {
      console.error("[BKT tasks] Supabase SELECT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    const [files, profiles] = await Promise.all([
      this.getFiles(),
      this.supabase
        .from("profiles")
        .select("id,display_name,email,title,role_id,is_active,deleted_at")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("display_name", { ascending: true })
    ]);
    if (profiles.error) {
      console.error("[BKT tasks] Profil listesi okunamadı.", {
        code: profiles.error.code,
        message: profiles.error.message,
        details: profiles.error.details,
        hint: profiles.error.hint
      });
      throw profiles.error;
    }
    const filesById = new Map((files || []).map(file => [file.id, file]));
    const profilesById = new Map((profiles.data || []).map(profile => [profile.id, profile]));
    return (data || []).map(row => ({
      ...row,
      file: filesById.get(row.file_id) || null,
      responsible_profile: profilesById.get(row.responsible_profile_id) || null
    }));
  }

  async getTask(id) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .eq(column, id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("[BKT tasks] Supabase tek kayıt SELECT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || null;
  }

  async createTask(row) {
    if (!this.available) return null;
    const { data, error, status, statusText } = await this.supabase
      .from("tasks")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT tasks create] Supabase INSERT hatası.", {
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload: {
          ...row,
          metadata: row?.metadata ? "[metadata]" : row?.metadata
        }
      });
      throw error;
    }
    if (!data) throw new Error("Görev oluşturuldu ancak kayıt dönmedi.");
    return data;
  }

  async updateTask(id, row) {
    if (!this.available || !id) return null;
    const column = this.isUuid(id) ? "id" : "legacy_id";
    const { data, error, status, statusText } = await this.supabase
      .from("tasks")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq(column, id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT tasks update] Supabase UPDATE hatası.", {
        requestedId: id,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload: {
          ...row,
          metadata: row?.metadata ? "[metadata]" : row?.metadata
        }
      });
      throw error;
    }
    return data;
  }

  async completeTask(id) {
    const existing = await this.getTask(id);
    if (!existing) throw new Error("Görev kaydı bulunamadı.");
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateTask(id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { ...metadata, completedFromUiAt: new Date().toISOString() }
    });
  }

  async reopenTask(id) {
    const existing = await this.getTask(id);
    if (!existing) throw new Error("Görev kaydı bulunamadı.");
    const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    return this.updateTask(id, {
      status: "active",
      completed_at: null,
      metadata: { ...metadata, reopenedFromUiAt: new Date().toISOString() }
    });
  }

  async deleteTask(id) {
    if (!this.available || !id) return false;
    let taskId = id;
    if (!this.isUuid(taskId)) {
      const existing = await this.getTask(id);
      taskId = existing?.id || "";
    }
    if (!this.isUuid(taskId)) {
      console.error("[BKT tasks delete] Görev UUID bulunamadı.", { requestedId: id, resolvedId: taskId });
      throw new Error("Görev UUID bulunamadı.");
    }
    const { data, error, status, statusText } = await this.supabase
      .rpc("soft_delete_task", { p_task_id: taskId });
    if (error) {
      console.error("[BKT tasks delete] Supabase RPC soft delete hatası.", {
        requestedId: id,
        taskId,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) {
      console.error("[BKT tasks delete] Supabase RPC soft delete satır döndürmedi.", {
        requestedId: id,
        taskId,
        status,
        statusText
      });
      throw new Error("Görev kaydı bulunamadı veya zaten silinmiş.");
    }
    return rows[0];
  }

  async getClients(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("clients")
      .select("*")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (filters.clientType) query = query.eq("client_type", filters.clientType);
    const { data, error } = await query;
    if (error) {
      console.error("[BKT clients] Supabase SELECT hatası.", {
        filters,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async getFileParties(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("file_parties")
      .select(`
        id,
        legacy_id,
        file_id,
        client_id,
        party_type,
        side,
        role,
        role_label,
        name,
        tax_id,
        phone,
        email,
        is_primary,
        metadata,
        created_at,
        updated_at,
        deleted_at,
        client:clients(id,name,tax_id,national_id,phone,email,client_type)
      `)
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);

    const { data, error } = await query;
    if (error) {
      console.error("[BKT file parties] Supabase SELECT hatası.", {
        fileId: filters.fileId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async findClientForParty(party = {}) {
    if (!this.available) return null;
    const name = normalizeTextValue(party.name);
    const taxId = normalizeTaxIdentifier(party.taxId || party.tax_id);
    if (taxId) {
      const { data, error } = await this.supabase
        .from("clients")
        .select("id,legacy_id,name,tax_id,national_id,client_type,metadata,deleted_at")
        .eq("tax_id", taxId)
        .is("deleted_at", null)
        .limit(2);
      if (error) throw error;
      if ((data || []).length === 1) return data[0];
    }
    if (!name) return null;
    const { data, error } = await this.supabase
      .from("clients")
      .select("id,legacy_id,name,tax_id,national_id,client_type,metadata,deleted_at")
      .eq("name", name)
      .is("deleted_at", null)
      .limit(2);
    if (error) throw error;
    return (data || []).length === 1 ? data[0] : null;
  }

  async createClient(row) {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from("clients")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async createFileParty(row) {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from("file_parties")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async syncFileParties(fileId, parties = []) {
    if (!this.available || !this.isUuid(fileId)) return [];
    const cleanParties = (Array.isArray(parties) ? parties : [])
      .map(normalizeRepositoryParty)
      .filter(party => party.name || party.taxId);
    if (!cleanParties.length) return [];
    const existingParties = await this.getFileParties({ fileId });
    const existingKeys = new Set(existingParties.map(filePartyIdentityKey));
    const savedRows = [];

    for (const party of cleanParties) {
      let client = await this.findClientForParty(party);
      if (!client) {
        client = await this.createClient({
          name: party.name || "İsimsiz taraf",
          tax_id: party.taxId || null,
          client_type: inferRepositoryClientType(party.name, party.taxId),
          metadata: {
            source: "file-form",
            createdFromFileId: fileId
          }
        });
      }
      const row = {
        file_id: fileId,
        client_id: client?.id || null,
        party_type: party.partyType || "other",
        side: party.side || "other",
        role: party.roleLabel || null,
        role_label: party.roleLabel || null,
        name: party.name || client?.name || "İsimsiz taraf",
        tax_id: party.taxId || client?.tax_id || null,
        phone: party.phone || null,
        email: party.email || null,
        is_primary: Boolean(party.isPrimary),
        metadata: {
          source: "file-form",
          clientMatch: client?.id ? "matched-or-created" : "none"
        }
      };
      const key = filePartyIdentityKey(row);
      if (existingKeys.has(key)) continue;
      const saved = await this.createFileParty(row);
      if (saved) {
        existingKeys.add(filePartyIdentityKey(saved));
        savedRows.push(saved);
      }
    }
    return savedRows;
  }

  async getCollections(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("collections")
      .select("*")
      .is("deleted_at", null)
      .order("collection_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.paymentPlanId) query = query.eq("payment_plan_id", filters.paymentPlanId);
    const { data, error } = await query;
    if (error) {
      console.error("[BKT collections] Supabase SELECT hatası.", {
        filters,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async createCollection(row) {
    if (!this.available) return null;
    const { data, error, status, statusText } = await this.supabase
      .from("collections")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT collections create] Supabase INSERT hatası.", {
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async updateCollection(id, row) {
    if (!this.available || !id) return null;
    const { data, error, status, statusText } = await this.supabase
      .from("collections")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT collections update] Supabase UPDATE hatası.", {
        id,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async deleteCollection(id) {
    if (!this.available || !id) return false;
    const { data, error, status, statusText } = await this.supabase
      .rpc("soft_delete_collection", { p_collection_id: id });
    if (error) {
      console.error("[BKT collections delete] Supabase soft delete hatası.", {
        id,
        status,
        statusText,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return true;
  }

  async getPaymentPlans(filters = {}) {
    if (!this.available) return [];
    let query = this.supabase
      .from("payment_plans")
      .select("*, client:clients(id,name,tax_id,national_id,client_type)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (filters.fileId) query = query.eq("file_id", filters.fileId);
    if (filters.clientId) query = query.eq("client_id", filters.clientId);
    const { data, error } = await query;
    if (error) {
      console.error("[BKT payment plans] Supabase SELECT hatası.", {
        filters,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    const planIds = (data || []).map(row => row.id).filter(Boolean);
    if (!planIds.length) return data || [];
    const { data: installments, error: installmentError } = await this.supabase
      .from("payment_installments")
      .select("*")
      .in("payment_plan_id", planIds)
      .is("deleted_at", null)
      .order("sequence_no", { ascending: true });
    if (installmentError) {
      console.error("[BKT payment installments] Supabase SELECT hatası.", {
        planIds,
        code: installmentError.code,
        message: installmentError.message,
        details: installmentError.details,
        hint: installmentError.hint
      });
      throw installmentError;
    }
    const installmentsByPlan = new Map();
    (installments || []).forEach(row => {
      const list = installmentsByPlan.get(row.payment_plan_id) || [];
      list.push(row);
      installmentsByPlan.set(row.payment_plan_id, list);
    });
    return (data || []).map(row => ({
      ...row,
      installments: installmentsByPlan.get(row.id) || []
    }));
  }

  async createPaymentPlan(row) {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from("payment_plans")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT payment plans create] Supabase INSERT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async updatePaymentPlan(id, row) {
    if (!this.available || !id) return null;
    const { data, error } = await this.supabase
      .from("payment_plans")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT payment plans update] Supabase UPDATE hatası.", {
        id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async deletePaymentPlan(id) {
    if (!this.available || !id) return false;
    const { data, error } = await this.supabase
      .rpc("soft_delete_payment_plan", { p_payment_plan_id: id });
    if (error) {
      console.error("[BKT payment plans delete] Supabase soft delete hatası.", {
        id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    if (!Array.isArray(data) || !data.length) throw new Error("Ödeme planı soft delete RPC boş sonuç döndürdü.");
    return true;
  }

  async replacePaymentInstallments(paymentPlanId, installments = []) {
    if (!this.available || !paymentPlanId) return [];
    const now = new Date().toISOString();
    const { error: deleteError } = await this.supabase
      .from("payment_installments")
      .update({ deleted_at: now, updated_at: now })
      .eq("payment_plan_id", paymentPlanId)
      .is("deleted_at", null);
    if (deleteError) {
      console.error("[BKT payment installments replace] Supabase soft delete hatası.", {
        paymentPlanId,
        code: deleteError.code,
        message: deleteError.message,
        details: deleteError.details,
        hint: deleteError.hint
      });
      throw deleteError;
    }
    const rows = installments.map((installment, index) => ({
      payment_plan_id: paymentPlanId,
      sequence_no: installment.sequence || index + 1,
      due_date: installment.dueDate || installment.due_date || this.localDateString(),
      amount: installment.amount ?? 0,
      paid_amount: installment.paidAmount ?? 0,
      paid_date: installment.paidDate || null,
      status: installment.status || null,
      payments: Array.isArray(installment.payments) ? installment.payments : [],
      metadata: installment.metadata || {}
    }));
    if (!rows.length) return [];
    const { data, error } = await this.supabase
      .from("payment_installments")
      .insert(rows)
      .select();
    if (error) {
      console.error("[BKT payment installments replace] Supabase INSERT hatası.", {
        paymentPlanId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async updatePaymentInstallment(id, row) {
    if (!this.available || !id) return null;
    const { data, error } = await this.supabase
      .from("payment_installments")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT payment installments update] Supabase UPDATE hatası.", {
        id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async getFileNotes(filters = {}) {
    if (!this.available || !filters.fileId) return [];
    const { data, error } = await this.supabase
      .from("file_notes")
      .select("id,legacy_id,file_id,note_text,author_profile_id,author_name,created_at,updated_at,deleted_at,author_profile:profiles!file_notes_author_profile_id_fkey(id,display_name)")
      .eq("file_id", filters.fileId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[BKT file notes] Supabase SELECT hatası.", {
        fileId: filters.fileId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async createFileNote(row) {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from("file_notes")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT file notes create] Supabase INSERT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async updateFileNote(id, row) {
    if (!this.available || !id) return null;
    const { data, error } = await this.supabase
      .from("file_notes")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) {
      console.error("[BKT file notes update] Supabase UPDATE hatası.", {
        id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  async deleteFileNote(id) {
    if (!this.available || !id) return false;
    const { error } = await this.supabase
      .from("file_notes")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[BKT file notes delete] Supabase soft delete hatası.", {
        id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return true;
  }

  async getTimelineEvents(filters = {}) {
    if (!this.available || !filters.fileId) return [];
    const { data, error } = await this.supabase
      .from("timeline_events")
      .select("id,legacy_id,file_id,event_type,title,description,event_date,actor_profile_id,actor_name,metadata,created_at,updated_at,deleted_at,actor_profile:profiles!timeline_events_actor_profile_id_fkey(id,display_name)")
      .eq("file_id", filters.fileId)
      .is("deleted_at", null)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[BKT timeline events] Supabase SELECT hatası.", {
        fileId: filters.fileId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data || [];
  }

  async createTimelineEvent(row) {
    if (!this.available) return null;
    const { data, error } = await this.supabase
      .from("timeline_events")
      .insert(cleanInsertPayload(row))
      .select()
      .single();
    if (error) {
      console.error("[BKT timeline events create] Supabase INSERT hatası.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  }

  localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  switchOffline() {
    this.available = false;
    this.offline = true;
    this.mode = "supabase-unavailable";
  }
}

function normalizeTextValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeTaxIdentifier(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function inferRepositoryClientType(name, taxId) {
  const normalizedName = normalizeTextValue(name).toLocaleLowerCase("tr-TR");
  const normalizedTax = normalizeTaxIdentifier(taxId);
  if (/\b(a\.?ş\.?|anonim|limited|ltd|şti|şirket|sanayi|ticaret|kooperatif|bankası|belediyesi)\b/i.test(normalizedName)) {
    return "company";
  }
  if (normalizedTax.length === 10) return "company";
  if (normalizedTax.length === 11) return "person";
  return "unknown";
}

function repositoryPartyTypeFromRole(role = "", fallbackType = "other") {
  const normalized = normalizeTextValue(role)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalized.includes("davaci")) return "plaintiff";
  if (normalized.includes("davali")) return "defendant";
  if (normalized.includes("alacakli")) return "creditor";
  if (normalized.includes("borclu")) return "debtor";
  if (normalized.includes("sanik")) return "accused";
  if (normalized.includes("musteki") || normalized.includes("sikayetci") || normalized.includes("magdur")) return "complainant";
  return fallbackType || "other";
}

function normalizeRepositoryParty(party = {}) {
  const roleLabel = normalizeTextValue(party.roleLabel || party.role || "");
  const fallbackType = party.partyType || (party.side === "represented" ? "client" : party.side === "opposing" ? "opponent" : "other");
  return {
    name: normalizeTextValue(party.name),
    taxId: normalizeTaxIdentifier(party.taxId || party.tax_id),
    roleLabel,
    partyType: repositoryPartyTypeFromRole(roleLabel, fallbackType),
    side: party.side || "other",
    phone: normalizeTextValue(party.phone),
    email: normalizeTextValue(party.email),
    isPrimary: Boolean(party.isPrimary)
  };
}

function filePartyIdentityKey(row = {}) {
  return [
    row.file_id || "",
    row.client_id || "",
    normalizeTextValue(row.name).toLocaleLowerCase("tr-TR"),
    normalizeTaxIdentifier(row.tax_id || row.taxId),
    normalizeTextValue(row.party_type || row.partyType).toLocaleLowerCase("tr-TR"),
    normalizeTextValue(row.side).toLocaleLowerCase("tr-TR"),
    normalizeTextValue(row.role_label || row.role || row.roleLabel).toLocaleLowerCase("tr-TR")
  ].join("|");
}

function isDuplicateLegacyFileIdError(error) {
  return error?.code === "23505" && /files_legacy_id_key|duplicate key/i.test(String(error?.message || ""));
}

function cleanInsertPayload(row = {}) {
  const payload = { ...row };
  if ("legacy_id" in payload) delete payload.legacy_id;
  return payload;
}

function fileCreatePayload(row = {}) {
  const payload = cleanInsertPayload(row);
  const legacyId = String(payload.legacy_id || "").trim();
  const displayId = String(payload.display_id || "").trim();
  if (legacyId && displayId && legacyId === displayId) {
    delete payload.legacy_id;
  }
  return payload;
}

function escapePostgrestValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\)/g, "\\)");
}

function incrementLegacyFileId(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.+?-)(\d+)$/);
  if (!match) return "";
  return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, "0")}`;
}

function nextFilePayloadWithBumpedLegacyId(row = {}) {
  const oldLegacyId = row.legacy_id || row.display_id || "";
  const nextLegacyId = incrementLegacyFileId(oldLegacyId);
  if (!nextLegacyId) return null;
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? { ...row.metadata }
    : row.metadata;
  if (metadata && Array.isArray(metadata.timeline)) {
    metadata.timeline = metadata.timeline.map(item => ({
      ...item,
      id: String(item.id || "").replace(oldLegacyId, nextLegacyId)
    }));
  }
  return {
    ...row,
    legacy_id: nextLegacyId,
    display_id: !row.display_id || row.display_id === oldLegacyId ? nextLegacyId : row.display_id,
    metadata
  };
}
