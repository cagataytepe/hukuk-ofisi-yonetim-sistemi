import { supabase } from "../src/supabase.js";

(function () {
  const config = window.BKT_SUPABASE_CONFIG || {};
  const supabaseUrl = config.url || "";
  const supabaseAnonKey = config.publishableKey || "";
  const standardRoleNames = [
    "Yönetici / Partner",
    "Avukat",
    "Stajyer Avukat",
    "Sekreter / Asistan",
    "Muhasebe",
    "Yalnızca Görüntüleme"
  ];

  function createSupabaseRepository() {
    const authClient = supabase;
    const cache = new Map();

    const repository = {
      authClient,
      mode: "supabase",
      available: Boolean(authClient),
      offline: !authClient,
      ready: Promise.resolve(false),
      writeQueue: Promise.resolve(),
      getItem(key) {
        if (cache.has(key)) return cache.get(key);
        return null;
      },
      async getItemAsync(key) {
        await repository.ready;
        return repository.getItem(key);
      },
      setItem(key, value) {
        cache.set(key, value);
        return repository.enqueueWrite(async () => {
          await repository.writeSetting(key, value);
        });
      },
      async setItemAsync(key, value) {
        await repository.setItem(key, value);
      },
      removeItem(key) {
        cache.delete(key);
        return repository.enqueueWrite(async () => {
          await repository.deleteSetting(key);
        });
      },
      async removeItemAsync(key) {
        await repository.removeItem(key);
      },
      async preload() {
        if (!repository.available) {
          repository.switchToOffline("Supabase bağlantı bilgileri veya supabase-js yüklenemedi.");
          return false;
        }

        const session = await repository.getSession();
        if (!session) {
          notifyStatus("unauthenticated", "Supabase oturumu bekleniyor.");
          return false;
        }

        return repository.reload();
      },
      async reload() {
        try {
          const response = await fetch(
            `${restUrl("settings")}?select=setting_key,setting_value&deleted_at=is.null`,
            { headers: await authHeaders(repository) }
          );
          if (!response.ok) throw new Error(`settings okunamadı: ${response.status}`);

          const rows = await response.json();
          rows.forEach(row => {
            const value = serializeSettingValue(row.setting_value);
            cache.set(row.setting_key, value);
          });

          repository.available = true;
          repository.offline = false;
          repository.mode = "supabase";
          notifyStatus("online", "Supabase bağlantısı kuruldu.");
          return true;
        } catch (error) {
          repository.switchToOffline("Supabase bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.", error);
          return false;
        }
      },
      async getSession() {
        if (!authClient) return null;
        const { data, error } = await authClient.auth.getSession();
        if (error) return null;
        return data?.session || null;
      },
      async signIn(identifier, password) {
        const email = String(identifier || "").trim();
        if (!authClient) throw new Error("Supabase sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.");
        const { data, error } = await authClient.auth.signInWithPassword({ email, password });
        if (error) {
          console.error("Supabase Auth giriş hatası.", error);
          throw new Error(mapAuthErrorMessage(error));
        }
        await repository.reload();
        return data;
      },
      async signOut() {
        if (authClient) await authClient.auth.signOut();
        cache.clear();
        notifyStatus("unauthenticated", "Oturum kapatıldı.");
      },
      async restoreAuthUser() {
        const session = await repository.getSession();
        if (!session?.user) return null;
        await repository.reload();
        return repository.getCurrentUser();
      },
      async sendPasswordReset(email) {
        if (!authClient) throw new Error("Supabase Auth yüklenemedi.");
        const redirectTo = config.passwordResetRedirectTo || window.location.href.split("#")[0];
        const { error } = await authClient.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo });
        if (error) throw error;
      },
      async updatePassword(password) {
        if (!authClient) throw new Error("Supabase Auth yüklenemedi.");
        const { data, error } = await authClient.auth.updateUser({ password });
        if (error) throw error;
        return data;
      },
      async getCurrentUser() {
        if (!authClient) return null;
        const { data, error } = await authClient.auth.getUser();
        if (error || !data?.user) return null;
        return repository.getProfileUser(data.user);
      },
      async getProfileUser(authUser) {
        const profileResponse = await fetch(
          `${restUrl("profiles")}?select=id,role_id,display_name,username,title,email,is_active&deleted_at=is.null&id=eq.${encodeURIComponent(authUser.id)}&limit=1`,
          { headers: await authHeaders(repository) }
        );
        if (!profileResponse.ok) throw new Error(`Profil okunamadı: ${profileResponse.status}`);
        const profiles = await profileResponse.json();
        const profile = profiles[0];
        if (!profile) throw new Error("Bu kullanıcı için uygulama profili bulunamadı. Sistem yöneticinizle iletişime geçin.");
        if (profile.is_active === false) throw new Error("Kullanıcı hesabınız pasif durumdadır.");

        const [role, rolePermissions, profilePermissions] = await Promise.all([
          repository.fetchRole(profile.role_id),
          repository.fetchPermissions({ roleId: profile.role_id }),
          repository.fetchPermissions({ profileId: profile.id })
        ]);
        const roleName = canonicalRoleDisplayName(role || { name: profile.title || "" });
        const permissions = normalizePermissions(rolePermissions, profilePermissions, roleName);
        if (!permissions.view) throw new Error("Veri görüntüleme yetkiniz bulunmuyor.");

        return {
          id: profile.id,
          authUserId: authUser.id,
          username: profile.username || "",
          displayName: profileDisplayName(profile),
          email: profile.email || authUser.email,
          active: profile.is_active !== false,
          roleName,
          permissions
        };
      },
      async listProfiles() {
        if (!authClient) return [];
        const query = `${restUrl("profiles")}?select=id,role_id,display_name,title,email,is_active&is_active=eq.true&deleted_at=is.null&order=display_name.asc`;
        console.debug("[BKT profiles] sorgu", {
          table: "public.profiles",
          select: ["id", "role_id", "display_name", "title", "email"],
          filters: { is_active: true, deleted_at: null },
          order: "display_name.asc"
        });

        let response;
        try {
          response = await fetch(query, { headers: await authHeaders(repository) });
        } catch (error) {
          console.error("[BKT profiles] sorgu hatası", { message: error?.message || String(error) });
          showConnectionWarning("Kullanıcı profilleri yüklenemedi.");
          throw new Error("Kullanıcı profilleri yüklenemedi.");
        }

        if (!response.ok) {
          console.error("[BKT profiles] sorgu hatası", {
            status: response.status,
            statusText: response.statusText
          });
          showConnectionWarning("Kullanıcı profilleri yüklenemedi.");
          throw new Error("Kullanıcı profilleri yüklenemedi.");
        }

        const profiles = await response.json();
        console.debug("[BKT profiles] dönen profil sayısı", profiles.length);
        console.debug("[BKT profiles] dönen profiller", profiles.map(profile => ({
          id: profile.id,
          display_name: profile.display_name
        })));

        const users = await Promise.all(profiles.map(async profile => {
          const [role, rolePermissions, profilePermissions] = await Promise.all([
            repository.fetchRole(profile.role_id),
            repository.fetchPermissions({ roleId: profile.role_id }),
            repository.fetchPermissions({ profileId: profile.id })
          ]);
          const roleName = canonicalRoleDisplayName(role || { name: profile.title || "" });
          return {
            id: profile.id,
            username: "",
            displayName: profileDisplayName(profile),
            email: profile.email || "",
            active: profile.is_active !== false,
            roleName,
            permissions: normalizePermissions(rolePermissions, profilePermissions, roleName)
          };
        }));
        return uniqueProfiles(users);
      },
      async listRoles() {
        if (!authClient) return [];
        const response = await fetch(`${restUrl("roles")}?select=id,name,is_system,metadata,created_at&deleted_at=is.null&order=name.asc`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) throw new Error(`Roller okunamadı: ${response.status}`);
        const roleRows = uniqueRoles(await response.json());
        return Promise.all(roleRows.map(async role => {
          const displayName = canonicalRoleDisplayName(role);
          return {
            ...role,
            name: displayName,
            permissions: normalizePermissions(await repository.fetchPermissions({ roleId: role.id }), [], displayName)
          };
        }));
      },
      async listManagedProfiles() {
        if (!authClient) return [];
        const response = await fetch(
          `${restUrl("profiles")}?select=id,role_id,display_name,title,email,is_active&deleted_at=is.null&order=display_name.asc`,
          { headers: await authHeaders(repository) }
        );
        if (!response.ok) throw new Error(`Kullanıcı profilleri okunamadı: ${response.status}`);
        const profiles = await response.json();
        const users = await Promise.all(profiles.map(async profile => {
          const [role, rolePermissions, profilePermissions] = await Promise.all([
            repository.fetchRole(profile.role_id),
            repository.fetchPermissions({ roleId: profile.role_id }),
            repository.fetchPermissions({ profileId: profile.id })
          ]);
          const roleName = role?.name || profile.title || "";
          return {
            id: profile.id,
            roleId: profile.role_id || "",
            displayName: profileDisplayName(profile),
            email: profile.email || "",
            active: profile.is_active !== false,
            roleName,
            title: profile.title || "",
            permissions: normalizePermissions(rolePermissions, profilePermissions, roleName)
          };
        }));
        return uniqueProfiles(users);
      },
      async updateManagedProfile({ id, roleId = "", active = true, permissions = {} } = {}) {
        if (!id) throw new Error("Profil seçilmedi.");
        const role = roleId ? await repository.fetchRole(roleId) : null;
        const rows = Object.entries(permissions).map(([permissionKey, allowed]) => ({
          profile_id: id,
          role_id: roleId || null,
          permission_key: permissionKey,
          allowed: Boolean(allowed),
          metadata: { source: "bkt-user-management" },
          updated_at: new Date().toISOString(),
          deleted_at: null
        }));

        for (const row of rows) {
          const permissionFilter = [
            `profile_id=eq.${encodeURIComponent(row.profile_id)}`,
            `role_id=eq.${encodeURIComponent(row.role_id)}`,
            `permission_key=eq.${encodeURIComponent(row.permission_key)}`
          ].join("&");
          const patchResponse = await fetch(`${restUrl("user_permissions")}?${permissionFilter}`, {
            method: "PATCH",
            headers: {
              ...(await authHeaders(repository)),
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify({
              allowed: row.allowed,
              metadata: row.metadata,
              updated_at: row.updated_at,
              deleted_at: null
            })
          });
          if (!patchResponse.ok) throw new Error(`Yetkiler güncellenemedi: ${patchResponse.status}`);
          const patchedRows = await patchResponse.json();
          if (patchedRows.length) continue;

          const permissionResponse = await fetch(`${restUrl("user_permissions")}`, {
            method: "POST",
            headers: {
              ...(await authHeaders(repository)),
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify(row)
          });
          if (!permissionResponse.ok) throw new Error(`Yetkiler kaydedilemedi: ${permissionResponse.status}`);
        }

        const profileResponse = await fetch(`${restUrl("profiles")}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            role_id: roleId || null,
            title: role?.name || null,
            is_active: Boolean(active),
            updated_at: new Date().toISOString()
          })
        });
        if (!profileResponse.ok) throw new Error(`Profil güncellenemedi: ${profileResponse.status}`);
        return true;
      },
      async getFiles() {
        const response = await fetch(
          `${restUrl("files")}?select=*&deleted_at=is.null&order=created_at.desc`,
          { headers: await authHeaders(repository) }
        );
        if (!response.ok) throw new Error(`Dosyalar okunamadı: ${response.status}`);
        return response.json();
      },
      async getFileIdCandidates() {
        const select = [
          "id",
          "legacy_id",
          "display_id",
          "record_kind",
          "file_type",
          "follow_type",
          "metadata",
          "deleted_at",
          "created_at"
        ].join(",");
        const response = await fetch(
          `${restUrl("files")}?select=${select}&order=created_at.desc`,
          { headers: await authHeaders(repository) }
        );
        if (!response.ok) throw new Error(`Dosya ID adayları okunamadı: ${response.status}`);
        return response.json();
      },
      async getFile(id) {
        if (!id) return null;
        const fileSelect = [
          "id",
          "legacy_id",
          "display_id",
          "record_kind",
          "file_type",
          "follow_type",
          "file_no",
          "court_or_office",
          "decision_no",
          "subject",
          "status",
          "opening_date",
          "responsible_profile_id",
          "responsible_name",
          "client_name",
          "opponent_name",
          "description",
          "account_info",
          "instrument_info",
          "metadata",
          "created_at",
          "updated_at",
          "deleted_at",
          "responsible_profile:profiles!files_responsible_profile_id_fkey(id,display_name)"
        ].join(",");
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `or=(legacy_id.eq.${encodeURIComponent(id)},display_id.eq.${encodeURIComponent(id)})`;
        const response = await fetch(
          `${restUrl("files")}?select=${fileSelect}&deleted_at=is.null&${filter}&limit=1`,
          { headers: await authHeaders(repository) }
        );
        if (!response.ok) throw new Error(`Dosya okunamadı: ${response.status}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async createFile(row) {
        let payload = fileCreatePayload(row);
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const response = await fetch(`${restUrl("files")}`, {
            method: "POST",
            headers: {
              ...(await authHeaders(repository)),
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(payload)
          });
          if (response.ok) {
            const rows = await response.json();
            return rows[0] || null;
          }
          const body = await safeResponseText(response);
          if (!isDuplicateLegacyFileId(response.status, body) || !payload.legacy_id) {
            throw new Error(`Dosya oluşturulamadı: ${response.status} ${body}`);
          }
          const nextPayload = nextFilePayloadWithBumpedLegacyId(payload);
          if (!nextPayload) throw new Error(`Dosya oluşturulamadı: ${response.status} ${body}`);
          console.warn("[BKT files create] Legacy ID kullanıldığı için yeni ID deneniyor.", {
            previousLegacyId: payload.legacy_id,
            nextLegacyId: nextPayload.legacy_id
          });
          payload = nextPayload;
        }
        throw new Error("Dosya oluşturulamadı: uygun boş dosya ID değeri bulunamadı.");
      },
      async updateFile(id, row) {
        if (!id) throw new Error("Dosya seçilmedi.");
        let fileId = id;
        if (!isUuid(fileId)) {
          const existing = await repository.getFile(id);
          fileId = existing?.id || "";
        }
        if (!isUuid(fileId)) throw new Error("Dosya UUID değeri çözümlenemedi.");
        const filter = `id=eq.${encodeURIComponent(fileId)}`;
        const response = await fetch(`${restUrl("files")}?${filter}`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Dosya güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async deleteFile(id) {
        if (!id) throw new Error("Dosya seçilmedi.");
        let fileId = id;
        if (!isUuid(fileId)) {
          const existing = await repository.getFile(id);
          fileId = existing?.id || "";
        }
        if (!isUuid(fileId)) {
          console.error("[BKT files delete] File UUID could not be resolved.", { requestedId: id, resolvedId: fileId });
          throw new Error("File UUID could not be resolved.");
        }
        const { data, error, status, statusText } = await authClient.rpc("soft_delete_file", { p_file_id: fileId });
        if (error) {
          console.error("[BKT files delete] Supabase RPC soft delete failed.", {
            requestedId: id,
            fileId,
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
          console.error("[BKT files delete] Supabase RPC soft delete returned no rows.", {
            requestedId: id,
            fileId,
            status,
            statusText
          });
          throw new Error("File was not found or was already deleted.");
        }
        return rows[0];
      },
      async getDashboardData(filters = {}) {
        const now = new Date();
        const todayIso = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0")
        ].join("-");
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        const weekStartIso = [
          weekStart.getFullYear(),
          String(weekStart.getMonth() + 1).padStart(2, "0"),
          String(weekStart.getDate()).padStart(2, "0")
        ].join("-");
        const fileSelect = "id,legacy_id,display_id,record_kind,file_type,follow_type,file_no,court_or_office,decision_no,subject,status,opening_date,responsible_profile_id,responsible_name,client_name,opponent_name,description,account_info,instrument_info,metadata,created_at,updated_at,deleted_at";
        const hearingSelect = "id,legacy_id,file_id,court,case_file_no,hearing_date,hearing_time,client_name,party_role,excuse_type,attendee_profile_id,attendee_name,participant_profile_id,participant_name,note,outcome,status,metadata,created_at,updated_at,deleted_at";
        const deadlineSelect = "id,legacy_id,file_id,title,task,description,responsible_profile_id,responsible_name,start_date,due_date,status,completed_at,completed_late,created_at,updated_at,deleted_at,metadata";
        const taskSelect = "id,legacy_id,task_type,file_id,title,description,responsible_profile_id,responsible_name,due_date,status,priority,completed_at,created_by_profile_id,created_at,updated_at,deleted_at,metadata";
        const profileSelect = "id,display_name,email,title,role_id,is_active,deleted_at";
        const headers = await authHeaders(repository);
        let profileId = isUuid(filters.profileId) ? filters.profileId : "";
        if (!profileId && authClient) {
          try {
            const { data } = await authClient.auth.getUser();
            profileId = isUuid(data?.user?.id) ? data.user.id : "";
          } catch (error) {
            console.error("[BKT dashboard tasks] Current profile id could not be resolved.", { message: error?.message || String(error) });
          }
        }
        const [filesResponse, upcomingResponse, deadlinesResponse, profilesResponse] = await Promise.all([
          fetch(`${restUrl("files")}?select=${fileSelect}&deleted_at=is.null&order=created_at.desc`, { headers }),
          fetch(`${restUrl("hearings")}?select=${hearingSelect}&deleted_at=is.null&hearing_date=gte.${encodeURIComponent(weekStartIso)}&order=hearing_date.asc.nullslast&order=hearing_time.asc.nullslast`, { headers }),
          fetch(`${restUrl("deadlines")}?select=${deadlineSelect}&deleted_at=is.null&order=due_date.asc.nullslast&order=created_at.desc`, { headers }),
          fetch(`${restUrl("profiles")}?select=${profileSelect}&deleted_at=is.null&is_active=eq.true&order=display_name.asc`, { headers })
        ]);
        const responses = [
          ["files", filesResponse],
          ["upcomingHearings", upcomingResponse],
          ["deadlines", deadlinesResponse],
          ["profiles", profilesResponse]
        ];
        const failed = responses.find(([, response]) => !response.ok);
        if (failed) throw new Error(`Dashboard verisi okunamadı (${failed[0]}): ${failed[1].status} ${await safeResponseText(failed[1])}`);
        const [files, upcomingHearings, deadlines, profiles] = await Promise.all(responses.map(([, response]) => response.json()));
        let assignedTasks = [];
        let overdueTasks = [];
        let taskError = "";
        try {
          const taskRequests = [
            profileId
              ? fetch(`${restUrl("tasks")}?select=${taskSelect}&deleted_at=is.null&responsible_profile_id=eq.${encodeURIComponent(profileId)}&order=due_date.asc.nullslast&order=created_at.desc`, { headers })
              : Promise.resolve(null),
            fetch(`${restUrl("tasks")}?select=${taskSelect}&deleted_at=is.null&due_date=lt.${encodeURIComponent(todayIso)}&order=due_date.asc.nullslast&order=created_at.desc`, { headers })
          ];
          const [assignedResponse, overdueResponse] = await Promise.all(taskRequests);
          if (assignedResponse && !assignedResponse.ok) throw new Error(`assignedTasks: ${assignedResponse.status} ${await safeResponseText(assignedResponse)}`);
          if (overdueResponse && !overdueResponse.ok) throw new Error(`overdueTasks: ${overdueResponse.status} ${await safeResponseText(overdueResponse)}`);
          assignedTasks = assignedResponse ? await assignedResponse.json() : [];
          overdueTasks = overdueResponse ? await overdueResponse.json() : [];
        } catch (error) {
          console.error("[BKT dashboard tasks] Supabase task data could not be loaded.", {
            message: error?.message || String(error)
          });
          taskError = "Görev bilgileri yüklenemedi.";
        }
        return {
          files,
          upcomingHearings,
          recentFiles: [],
          recentHearings: [],
          deadlines,
          assignedTasks,
          overdueTasks,
          deadlineError: "",
          taskError,
          profiles,
          generatedAt: new Date().toISOString()
        };
      },
      async getHearings(filters = {}) {
        const params = [
          "select=id,legacy_id,file_id,court,case_file_no,hearing_date,hearing_time,client_name,party_role,excuse_type,attendee_profile_id,attendee_name,participant_profile_id,participant_name,note,outcome,status,metadata,created_at,updated_at,deleted_at",
          "deleted_at=is.null",
          "order=hearing_date.asc.nullslast",
          "order=hearing_time.asc.nullslast"
        ];
        if (filters.dateFrom) params.push(`hearing_date=gte.${encodeURIComponent(filters.dateFrom)}`);
        if (filters.dateTo) params.push(`hearing_date=lte.${encodeURIComponent(filters.dateTo)}`);
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.status) params.push(`status=eq.${encodeURIComponent(filters.status)}`);
        if (filters.excuseType) params.push(`excuse_type=eq.${encodeURIComponent(filters.excuseType)}`);
        if (filters.participantProfileId) params.push(`participant_profile_id=eq.${encodeURIComponent(filters.participantProfileId)}`);

        const response = await fetch(`${restUrl("hearings")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) throw new Error(`Duruşmalar okunamadı: ${response.status} ${await safeResponseText(response)}`);
        const hearings = await response.json();
        const [files, profiles] = await Promise.all([
          repository.getFiles(),
          repository.listProfiles().catch(() => [])
        ]);
        const filesById = new Map((files || []).map(file => [file.id, file]));
        const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
        return hearings.map(row => ({
          ...row,
          file: filesById.get(row.file_id) || null,
          participant_profile: profilesById.get(row.participant_profile_id || row.attendee_profile_id) || null
        }));
      },
      async getHearing(id) {
        if (!id) return null;
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("hearings")}?select=*&deleted_at=is.null&${filter}&limit=1`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) throw new Error(`Duruşma okunamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async createHearing(row) {
        const response = await fetch(`${restUrl("hearings")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}
          console.error("[BKT hearings create] Supabase INSERT failed.", {
            status: response.status,
            statusText: response.statusText,
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            hint: parsed.hint,
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata,
              outcome: row?.outcome ? "[outcome]" : row?.outcome
            }
          });
          throw new Error(`Duruşma oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        if (!rows[0]) {
          console.error("[BKT hearings create] Supabase INSERT returned no row.", { payload: row });
          throw new Error("Duruşma oluşturuldu ancak kayıt dönmedi.");
        }
        return rows[0];
      },
      async updateHearing(id, row) {
        if (!id) throw new Error("Duruşma seçilmedi.");
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("hearings")}?${filter}`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error(`Duruşma güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async deleteHearing(id) {
        if (!id) throw new Error("Duruşma seçilmedi.");
        let hearingId = id;
        if (!isUuid(hearingId)) {
          const existing = await repository.getHearing(id);
          hearingId = existing?.id || "";
        }
        if (!isUuid(hearingId)) {
          console.error("[BKT hearings delete] Hearing UUID could not be resolved.", { requestedId: id, resolvedId: hearingId });
          throw new Error("Hearing UUID could not be resolved.");
        }
        const { data, error, status, statusText } = await authClient.rpc("soft_delete_hearing", { p_hearing_id: hearingId });
        if (error) {
          console.error("[BKT hearings delete] Supabase RPC soft delete failed.", {
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
          console.error("[BKT hearings delete] Supabase RPC soft delete returned no rows.", {
            requestedId: id,
            hearingId,
            status,
            statusText
          });
          throw new Error("Hearing was not found or was already deleted.");
        }
        return rows[0];
      },
      async completeHearing(id, outcome = {}) {
        const existing = await repository.getHearing(id);
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateHearing(id, {
          status: "completed",
          outcome: outcome && typeof outcome === "object" ? outcome : { text: String(outcome || "") },
          metadata: {
            ...metadata,
            completedAt: new Date().toISOString()
          }
        });
      },
      async reopenHearing(id) {
        const existing = await repository.getHearing(id);
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateHearing(id, {
          status: "scheduled",
          metadata: {
            ...metadata,
            reopenedAt: new Date().toISOString()
          }
        });
      },
      async getDeadlines(filters = {}) {
        const params = [
          "select=id,legacy_id,file_id,title,task,description,responsible_profile_id,responsible_name,start_date,due_date,status,completed_at,completed_late,created_at,updated_at,deleted_at,metadata",
          "deleted_at=is.null",
          "order=due_date.asc.nullslast",
          "order=created_at.desc"
        ];
        if (filters.dateFrom) params.push(`due_date=gte.${encodeURIComponent(filters.dateFrom)}`);
        if (filters.dateTo) params.push(`due_date=lte.${encodeURIComponent(filters.dateTo)}`);
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.status) params.push(`status=eq.${encodeURIComponent(filters.status)}`);
        if (filters.responsibleProfileId) params.push(`responsible_profile_id=eq.${encodeURIComponent(filters.responsibleProfileId)}`);

        const response = await fetch(`${restUrl("deadlines")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT deadlines] Supabase SELECT failed.", {
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Süreli işler okunamadı: ${response.status}`);
        }
        const deadlines = await response.json();
        const [files, profiles] = await Promise.all([
          repository.getFiles(),
          repository.listProfiles().catch(() => [])
        ]);
        const filesById = new Map((files || []).map(file => [file.id, file]));
        const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
        return deadlines.map(row => ({
          ...row,
          file: filesById.get(row.file_id) || null,
          responsible_profile: profilesById.get(row.responsible_profile_id) || null
        }));
      },
      async getDeadline(id) {
        if (!id) return null;
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("deadlines")}?select=*&deleted_at=is.null&${filter}&limit=1`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) throw new Error(`Süreli iş okunamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async createDeadline(row) {
        const response = await fetch(`${restUrl("deadlines")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}
          console.error("[BKT deadlines create] Supabase INSERT failed.", {
            status: response.status,
            statusText: response.statusText,
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            hint: parsed.hint,
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata
            }
          });
          throw new Error(`Süreli iş oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        if (!rows[0]) {
          console.error("[BKT deadlines create] Supabase INSERT returned no row.", { payload: row });
          throw new Error("Süreli iş oluşturuldu ancak kayıt dönmedi.");
        }
        return rows[0];
      },
      async updateDeadline(id, row) {
        if (!id) throw new Error("Süreli iş seçilmedi.");
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("deadlines")}?${filter}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}
          console.error("[BKT deadlines update] Supabase UPDATE failed.", {
            requestedId: id,
            status: response.status,
            statusText: response.statusText,
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            hint: parsed.hint,
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata
            }
          });
          throw new Error(`Süreli iş güncellenemedi: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async completeDeadline(id) {
        const existing = await repository.getDeadline(id);
        if (!existing) throw new Error("Süreli iş kaydı bulunamadı.");
        const today = localDateString();
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateDeadline(id, {
          status: "Tamamlandı",
          completed_at: new Date().toISOString(),
          completed_late: Boolean(existing.due_date && existing.due_date < today),
          metadata: {
            ...metadata,
            completedFromUiAt: new Date().toISOString()
          }
        });
      },
      async reopenDeadline(id) {
        const existing = await repository.getDeadline(id);
        if (!existing) throw new Error("Süreli iş kaydı bulunamadı.");
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateDeadline(id, {
          status: "Aktif",
          completed_at: null,
          completed_late: false,
          metadata: {
            ...metadata,
            reopenedFromUiAt: new Date().toISOString()
          }
        });
      },
      async deleteDeadline(id) {
        if (!id) throw new Error("Süreli iş seçilmedi.");
        let deadlineId = id;
        if (!isUuid(deadlineId)) {
          const existing = await repository.getDeadline(id);
          deadlineId = existing?.id || "";
        }
        if (!isUuid(deadlineId)) {
          console.error("[BKT deadlines delete] Deadline UUID could not be resolved.", { requestedId: id, resolvedId: deadlineId });
          throw new Error("Deadline UUID could not be resolved.");
        }
        const { data, error, status, statusText } = await authClient.rpc("soft_delete_deadline", { p_deadline_id: deadlineId });
        if (error) {
          console.error("[BKT deadlines delete] Supabase RPC soft delete failed.", {
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
          console.error("[BKT deadlines delete] Supabase RPC soft delete returned no rows.", {
            requestedId: id,
            deadlineId,
            status,
            statusText
          });
          throw new Error("Deadline was not found or was already deleted.");
        }
        return rows[0];
      },
      async getTasks(filters = {}) {
        const params = [
          "select=id,legacy_id,task_type,file_id,title,description,responsible_profile_id,responsible_name,due_date,status,priority,completed_at,created_by_profile_id,created_at,updated_at,deleted_at,metadata",
          "deleted_at=is.null",
          "order=due_date.asc.nullslast",
          "order=created_at.desc"
        ];
        if (filters.dateFrom) params.push(`due_date=gte.${encodeURIComponent(filters.dateFrom)}`);
        if (filters.dateTo) params.push(`due_date=lte.${encodeURIComponent(filters.dateTo)}`);
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.status) params.push(`status=eq.${encodeURIComponent(filters.status)}`);
        if (filters.taskType) params.push(`task_type=eq.${encodeURIComponent(filters.taskType)}`);
        if (filters.priority) params.push(`priority=eq.${encodeURIComponent(filters.priority)}`);
        const responsibleFilter = filters.responsibleProfileId || filters.assignedToProfileId;
        if (responsibleFilter) params.push(`responsible_profile_id=eq.${encodeURIComponent(responsibleFilter)}`);

        const response = await fetch(`${restUrl("tasks")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT tasks] Supabase SELECT failed.", {
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Görevler okunamadı: ${response.status}`);
        }
        const tasks = await response.json();
        const [files, profiles] = await Promise.all([
          repository.getFiles(),
          repository.listProfiles().catch(() => [])
        ]);
        const filesById = new Map((files || []).map(file => [file.id, file]));
        const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
        return tasks.map(row => ({
          ...row,
          file: filesById.get(row.file_id) || null,
          responsible_profile: profilesById.get(row.responsible_profile_id) || null
        }));
      },
      async getTask(id) {
        if (!id) return null;
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("tasks")}?select=*&deleted_at=is.null&${filter}&limit=1`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) throw new Error(`Görev okunamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async createTask(row) {
        const response = await fetch(`${restUrl("tasks")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}
          console.error("[BKT tasks create] Supabase INSERT failed.", {
            status: response.status,
            statusText: response.statusText,
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            hint: parsed.hint,
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata
            }
          });
          throw new Error(`Görev oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        if (!rows[0]) {
          console.error("[BKT tasks create] Supabase INSERT returned no row.", {
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata
            }
          });
          throw new Error("Görev oluşturuldu ancak kayıt dönmedi.");
        }
        return rows[0];
      },
      async updateTask(id, row) {
        if (!id) throw new Error("Görev seçilmedi.");
        const filter = isUuid(id)
          ? `id=eq.${encodeURIComponent(id)}`
          : `legacy_id=eq.${encodeURIComponent(id)}`;
        const response = await fetch(`${restUrl("tasks")}?${filter}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}
          console.error("[BKT tasks update] Supabase UPDATE failed.", {
            requestedId: id,
            status: response.status,
            statusText: response.statusText,
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            hint: parsed.hint,
            payload: {
              ...row,
              metadata: row?.metadata ? "[metadata]" : row?.metadata
            }
          });
          throw new Error(`Görev güncellenemedi: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async completeTask(id) {
        const existing = await repository.getTask(id);
        if (!existing) throw new Error("Görev kaydı bulunamadı.");
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateTask(id, {
          status: "completed",
          completed_at: new Date().toISOString(),
          metadata: {
            ...metadata,
            completedFromUiAt: new Date().toISOString()
          }
        });
      },
      async reopenTask(id) {
        const existing = await repository.getTask(id);
        if (!existing) throw new Error("Görev kaydı bulunamadı.");
        const metadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        return repository.updateTask(id, {
          status: "active",
          completed_at: null,
          metadata: {
            ...metadata,
            reopenedFromUiAt: new Date().toISOString()
          }
        });
      },
      async deleteTask(id) {
        if (!id) throw new Error("Görev seçilmedi.");
        let taskId = id;
        if (!isUuid(taskId)) {
          const existing = await repository.getTask(id);
          taskId = existing?.id || "";
        }
        if (!isUuid(taskId)) {
          console.error("[BKT tasks delete] Task UUID could not be resolved.", { requestedId: id, resolvedId: taskId });
          throw new Error("Task UUID could not be resolved.");
        }
        const { data, error, status, statusText } = await authClient.rpc("soft_delete_task", { p_task_id: taskId });
        if (error) {
          console.error("[BKT tasks delete] Supabase RPC soft delete failed.", {
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
          console.error("[BKT tasks delete] Supabase RPC soft delete returned no rows.", {
            requestedId: id,
            taskId,
            status,
            statusText
          });
          throw new Error("Task was not found or was already deleted.");
        }
        return rows[0];
      },
      async getClients(filters = {}) {
        const params = [
          "select=id,legacy_id,name,tax_id,national_id,phone,email,address,client_type,metadata,created_at,updated_at,deleted_at",
          "deleted_at=is.null",
          "order=name.asc"
        ];
        if (filters.clientType) params.push(`client_type=eq.${encodeURIComponent(filters.clientType)}`);
        const response = await fetch(`${restUrl("clients")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT clients] Supabase SELECT failed.", {
            filters,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Müvekkiller okunamadı: ${response.status}`);
        }
        return response.json();
      },
      async getFileParties(filters = {}) {
        const select = [
          "id",
          "legacy_id",
          "file_id",
          "client_id",
          "party_type",
          "side",
          "role",
          "role_label",
          "name",
          "tax_id",
          "phone",
          "email",
          "is_primary",
          "represented_by_office",
          "notes",
          "metadata",
          "created_at",
          "updated_at",
          "deleted_at",
          "client:clients(id,name,tax_id,national_id,phone,email,client_type)"
        ].join(",");
        const params = [
          `select=${select}`,
          "deleted_at=is.null",
          "order=is_primary.desc,created_at.asc"
        ];
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.clientId) params.push(`client_id=eq.${encodeURIComponent(filters.clientId)}`);
        if (typeof filters.representedByOffice === "boolean") params.push(`represented_by_office=eq.${filters.representedByOffice}`);
        const response = await fetch(`${restUrl("file_parties")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT file parties] Supabase SELECT failed.", {
            fileId: filters.fileId,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Taraflar okunamadı: ${response.status}`);
        }
        return response.json();
      },
      async getRepresentedClients() {
        const parties = await this.getFileParties({ representedByOffice: true });
        const byId = new Map();
        parties.forEach(party => {
          if (party.client?.id && !byId.has(party.client.id)) byId.set(party.client.id, party.client);
        });
        return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "tr"));
      },
      async findClientForParty(party = {}) {
        const name = normalizeTextValue(party.name);
        const nationalId = normalizeTaxIdentifier(party.nationalId || party.national_id);
        const taxId = normalizeTaxIdentifier(party.taxId || party.tax_id);
        const select = "id,legacy_id,name,tax_id,national_id,client_type,metadata,deleted_at";
        const identifierColumn = nationalId ? "national_id" : taxId ? "tax_id" : "";
        const identifier = nationalId || taxId;
        if (identifierColumn) {
          const taxResponse = await fetch(`${restUrl("clients")}?select=${select}&deleted_at=is.null&${identifierColumn}=eq.${encodeURIComponent(identifier)}&limit=2`, {
            headers: await authHeaders(repository)
          });
          if (!taxResponse.ok) throw new Error(`Müvekkil TC/VKN eşleşmesi okunamadı: ${taxResponse.status} ${await safeResponseText(taxResponse)}`);
          const taxRows = await taxResponse.json();
          if (taxRows.length === 1) return taxRows[0];
        }
        if (!name) return null;
        const nameResponse = await fetch(`${restUrl("clients")}?select=${select}&deleted_at=is.null&name=eq.${encodeURIComponent(name)}&limit=2`, {
          headers: await authHeaders(repository)
        });
        if (!nameResponse.ok) throw new Error(`Müvekkil isim eşleşmesi okunamadı: ${nameResponse.status} ${await safeResponseText(nameResponse)}`);
        const nameRows = await nameResponse.json();
        return nameRows.length === 1 ? nameRows[0] : null;
      },
      async createClient(row) {
        const response = await fetch(`${restUrl("clients")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Müvekkil oluşturulamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async updateClient(id, row) {
        const response = await fetch(`${restUrl("clients")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Müvekkil güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async createFileParty(row) {
        const response = await fetch(`${restUrl("file_parties")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Taraf oluşturulamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async updateFileParty(id, row) {
        const response = await fetch(`${restUrl("file_parties")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Taraf güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async syncFileParties(fileId, parties = []) {
        if (!isUuid(fileId)) throw new Error("Taraf senkronizasyonu için gerçek dosya UUID gerekli.");
        const cleanParties = (Array.isArray(parties) ? parties : [])
          .map(normalizeRepositoryParty)
          .filter(party => party.name || party.nationalId || party.taxId);
        if (!cleanParties.length) return [];

        const existingParties = typeof repository.getFileParties === "function"
          ? await repository.getFileParties({ fileId })
          : [];
        const existingByKey = new Map(existingParties.map(party => [filePartyIdentityKey(party), party]));
        const savedRows = [];

        for (const party of cleanParties) {
          let client = await repository.findClientForParty(party);
          if (!client) {
            client = await repository.createClient({
              name: party.name || "İsimsiz taraf",
              national_id: party.clientType === "person" ? party.nationalId || null : null,
              tax_id: party.clientType === "organization" ? party.taxId || null : null,
              phone: party.phone || null,
              email: party.email || null,
              client_type: party.clientType || "unknown",
              metadata: {
                source: "file-form",
                createdFromFileId: fileId
              }
            });
          } else {
            client = await repository.updateClient(client.id, {
              name: party.name || client.name,
              national_id: party.clientType === "person" ? party.nationalId || null : null,
              tax_id: party.clientType === "organization" ? party.taxId || null : null,
              phone: party.phone || client.phone || null,
              email: party.email || client.email || null,
              client_type: party.clientType || "unknown",
              metadata: {
                ...(client.metadata || {}),
                source: "file-form",
                updatedFromFileId: fileId
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
            phone: party.phone || client?.phone || null,
            email: party.email || client?.email || null,
            is_primary: Boolean(party.isPrimary),
            represented_by_office: typeof party.representedByOffice === "boolean" ? party.representedByOffice : null,
            notes: party.notes || null,
            metadata: {
              source: "file-form",
              clientMatch: client?.id ? "matched-or-created" : "none",
              clientType: party.clientType || "unknown"
            }
          };
          const key = filePartyIdentityKey(row);
          const existing = existingByKey.get(key);
          const saved = existing
            ? await repository.updateFileParty(existing.id, row)
            : await repository.createFileParty(row);
          if (saved) {
            existingByKey.set(filePartyIdentityKey(saved), saved);
            savedRows.push(saved);
          }
        }
        return savedRows;
      },
      async getCollections(filters = {}) {
        const params = [
          "select=id,legacy_id,file_id,payment_plan_id,payment_installment_id,amount,currency,collection_date,payment_kind,description,metadata,created_at,updated_at,deleted_at",
          "deleted_at=is.null",
          "order=collection_date.desc",
          "order=created_at.desc"
        ];
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.paymentPlanId) params.push(`payment_plan_id=eq.${encodeURIComponent(filters.paymentPlanId)}`);
        const response = await fetch(`${restUrl("collections")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT collections] Supabase SELECT failed.", {
            filters,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Tahsilatlar okunamadı: ${response.status}`);
        }
        return response.json();
      },
      async createCollection(row) {
        const response = await fetch(`${restUrl("collections")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT collections create] Supabase INSERT failed.", { status: response.status, statusText: response.statusText, body });
          throw new Error(`Tahsilat oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async updateCollection(id, row) {
        if (!id) throw new Error("Tahsilat seçilmedi.");
        const response = await fetch(`${restUrl("collections")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT collections update] Supabase UPDATE failed.", { id, status: response.status, statusText: response.statusText, body });
          throw new Error(`Tahsilat güncellenemedi: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async deleteCollection(id) {
        if (!id) throw new Error("Tahsilat seçilmedi.");
        const { data, error, status, statusText } = await authClient.rpc("soft_delete_collection", { p_collection_id: id });
        if (error) {
          console.error("[BKT collections delete] Supabase RPC soft delete failed.", {
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
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        if (!rows.length) {
          console.error("[BKT collections delete] Supabase RPC soft delete returned no rows.", { id, status, statusText });
          throw new Error("Collection was not found or was already deleted.");
        }
        return rows[0];
      },
      async getPaymentPlans(filters = {}) {
        const select = [
          "id",
          "legacy_id",
          "file_id",
          "client_id",
          "plan_type",
          "party_name",
          "agreement_amount",
          "initial_payment",
          "installment_count",
          "first_due_date",
          "currency",
          "status",
          "description",
          "metadata",
          "created_at",
          "updated_at",
          "deleted_at",
          "client:clients(id,name,tax_id,national_id,client_type)"
        ].join(",");
        const params = [
          `select=${select}`,
          "deleted_at=is.null",
          "order=updated_at.desc",
          "order=created_at.desc"
        ];
        if (filters.fileId) params.push(`file_id=eq.${encodeURIComponent(filters.fileId)}`);
        if (filters.clientId) params.push(`client_id=eq.${encodeURIComponent(filters.clientId)}`);
        const response = await fetch(`${restUrl("payment_plans")}?${params.join("&")}`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT payment plans] Supabase SELECT failed.", {
            filters,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Ödeme planları okunamadı: ${response.status}`);
        }
        const plans = await response.json();
        const planIds = plans.map(plan => plan.id).filter(Boolean);
        if (!planIds.length) return plans;
        const installmentsResponse = await fetch(
          `${restUrl("payment_installments")}?select=*&payment_plan_id=in.(${planIds.map(encodeURIComponent).join(",")})&deleted_at=is.null&order=sequence_no.asc`,
          { headers: await authHeaders(repository) }
        );
        if (!installmentsResponse.ok) {
          const body = await safeResponseText(installmentsResponse);
          console.error("[BKT payment installments] Supabase SELECT failed.", {
            planIds,
            status: installmentsResponse.status,
            statusText: installmentsResponse.statusText,
            body
          });
          throw new Error(`Ödeme taksitleri okunamadı: ${installmentsResponse.status}`);
        }
        const installments = await installmentsResponse.json();
        const installmentsByPlan = new Map();
        installments.forEach(row => {
          const list = installmentsByPlan.get(row.payment_plan_id) || [];
          list.push(row);
          installmentsByPlan.set(row.payment_plan_id, list);
        });
        return plans.map(plan => ({
          ...plan,
          installments: installmentsByPlan.get(plan.id) || []
        }));
      },
      async createPaymentPlan(row) {
        const response = await fetch(`${restUrl("payment_plans")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) throw new Error(`Ödeme planı oluşturulamadı: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async updatePaymentPlan(id, row) {
        if (!id) throw new Error("Ödeme planı seçilmedi.");
        const response = await fetch(`${restUrl("payment_plans")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error(`Ödeme planı güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async deletePaymentPlan(id) {
        if (!id) throw new Error("Ödeme planı seçilmedi.");
        const response = await fetch(`${restUrl("rpc/soft_delete_payment_plan")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ p_payment_plan_id: id })
        });
        if (!response.ok) throw new Error(`Ödeme planı silinemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error("Ödeme planı silinemedi: RPC boş sonuç döndürdü.");
        return true;
      },
      async replacePaymentInstallments(paymentPlanId, installments = []) {
        if (!paymentPlanId) return [];
        const now = new Date().toISOString();
        const deleteResponse = await fetch(`${restUrl("payment_installments")}?payment_plan_id=eq.${encodeURIComponent(paymentPlanId)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ deleted_at: now, updated_at: now })
        });
        if (!deleteResponse.ok) throw new Error(`Ödeme taksitleri temizlenemedi: ${deleteResponse.status} ${await safeResponseText(deleteResponse)}`);
        const rows = installments.map((installment, index) => ({
          payment_plan_id: paymentPlanId,
          sequence_no: installment.sequence || index + 1,
          due_date: installment.dueDate || installment.due_date || todayIso(),
          amount: installment.amount ?? 0,
          paid_amount: installment.paidAmount ?? 0,
          paid_date: installment.paidDate || null,
          status: installment.status || null,
          payments: Array.isArray(installment.payments) ? installment.payments : [],
          metadata: installment.metadata || {}
        }));
        if (!rows.length) return [];
        const response = await fetch(`${restUrl("payment_installments")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(rows)
        });
        if (!response.ok) throw new Error(`Ödeme taksitleri kaydedilemedi: ${response.status} ${await safeResponseText(response)}`);
        return response.json();
      },
      async updatePaymentInstallment(id, row) {
        if (!id) return null;
        const response = await fetch(`${restUrl("payment_installments")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ ...row, updated_at: new Date().toISOString() })
        });
        if (!response.ok) throw new Error(`Ödeme taksiti güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async getFileNotes(filters = {}) {
        if (!filters.fileId) return [];
        const select = [
          "id",
          "legacy_id",
          "file_id",
          "note_text",
          "author_profile_id",
          "author_name",
          "created_at",
          "updated_at",
          "deleted_at",
          "author_profile:profiles!file_notes_author_profile_id_fkey(id,display_name)"
        ].join(",");
        const response = await fetch(`${restUrl("file_notes")}?select=${select}&file_id=eq.${encodeURIComponent(filters.fileId)}&deleted_at=is.null&order=created_at.desc`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT file notes] Supabase SELECT failed.", {
            fileId: filters.fileId,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Dosya notları okunamadı: ${response.status}`);
        }
        return response.json();
      },
      async createFileNote(row) {
        const response = await fetch(`${restUrl("file_notes")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT file notes create] Supabase INSERT failed.", { status: response.status, statusText: response.statusText, body });
          throw new Error(`Dosya notu oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async updateFileNote(id, row) {
        if (!id) throw new Error("Dosya notu seçilmedi.");
        const response = await fetch(`${restUrl("file_notes")}?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            ...row,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error(`Dosya notu güncellenemedi: ${response.status} ${await safeResponseText(response)}`);
        const rows = await response.json();
        return rows[0] || null;
      },
      async deleteFileNote(id) {
        if (!id) throw new Error("Dosya notu seçilmedi.");
        const response = await fetch(`${restUrl("file_notes")}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error(`Dosya notu silinemedi: ${response.status} ${await safeResponseText(response)}`);
        return true;
      },
      async getTimelineEvents(filters = {}) {
        if (!filters.fileId) return [];
        const select = [
          "id",
          "legacy_id",
          "file_id",
          "event_type",
          "title",
          "description",
          "event_date",
          "actor_profile_id",
          "actor_name",
          "metadata",
          "created_at",
          "updated_at",
          "deleted_at",
          "actor_profile:profiles!timeline_events_actor_profile_id_fkey(id,display_name)"
        ].join(",");
        const response = await fetch(`${restUrl("timeline_events")}?select=${select}&file_id=eq.${encodeURIComponent(filters.fileId)}&deleted_at=is.null&order=event_date.desc&order=created_at.desc`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT timeline events] Supabase SELECT failed.", {
            fileId: filters.fileId,
            status: response.status,
            statusText: response.statusText,
            body
          });
          throw new Error(`Zaman çizelgesi okunamadı: ${response.status}`);
        }
        return response.json();
      },
      async createTimelineEvent(row) {
        const response = await fetch(`${restUrl("timeline_events")}`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(cleanInsertPayload(row))
        });
        if (!response.ok) {
          const body = await safeResponseText(response);
          console.error("[BKT timeline events create] Supabase INSERT failed.", { status: response.status, statusText: response.statusText, body });
          throw new Error(`Zaman çizelgesi kaydı oluşturulamadı: ${response.status}`);
        }
        const rows = await response.json();
        return rows[0] || null;
      },
      async getOfficeExpenseCategories() {
        return officeExpenseSelect(repository, "office_expense_categories", {
          select: "*",
          deleted_at: "is.null",
          active: "eq.true",
          order: "sort_order.asc,name.asc"
        });
      },
      async createOfficeExpenseCategory(row) {
        return officeExpenseWrite(repository, "office_expense_categories", "POST", row);
      },
      async updateOfficeExpenseCategory(id, row) {
        return officeExpenseWrite(repository, "office_expense_categories", "PATCH", row, id);
      },
      async deleteOfficeExpenseCategory(id) {
        return officeExpenseWrite(repository, "office_expense_categories", "PATCH", { deleted_at: new Date().toISOString() }, id);
      },
      async getOfficeExpenses(filters = {}) {
        const query = {
          select: "*,category:office_expense_categories!office_expenses_category_id_fkey(id,name,slug,color),subcategory:office_expense_categories!office_expenses_subcategory_id_fkey(id,name,slug,color),paid_by_profile:profiles!office_expenses_paid_by_profile_id_fkey(id,display_name),created_by_profile:profiles!office_expenses_created_by_profile_id_fkey(id,display_name)",
          deleted_at: "is.null",
          order: "expense_date.desc,created_at.desc"
        };
        if (filters.id) query.id = `eq.${filters.id}`;
        const rangeFilters = [];
        if (filters.dateFrom) rangeFilters.push(`expense_date.gte.${filters.dateFrom}`);
        if (filters.dateTo) rangeFilters.push(`expense_date.lte.${filters.dateTo}`);
        if (filters.categoryId) query.category_id = `eq.${filters.categoryId}`;
        if (filters.subcategoryId) query.subcategory_id = `eq.${filters.subcategoryId}`;
        if (filters.paidByProfileId) query.paid_by_profile_id = `eq.${filters.paidByProfileId}`;
        if (filters.paymentMethod) query.payment_method = `eq.${filters.paymentMethod}`;
        if (filters.status) query.status = `eq.${filters.status}`;
        if (filters.minAmount !== undefined && filters.minAmount !== "") rangeFilters.push(`amount.gte.${Number(filters.minAmount)}`);
        if (filters.maxAmount !== undefined && filters.maxAmount !== "") rangeFilters.push(`amount.lte.${Number(filters.maxAmount)}`);
        if (rangeFilters.length) query.and = `(${rangeFilters.join(",")})`;
        return officeExpenseSelect(repository, "office_expenses", query);
      },
      async getOfficeExpense(id) {
        const rows = await repository.getOfficeExpenses({ id });
        return rows[0] || null;
      },
      async createOfficeExpense(row) {
        return officeExpenseWrite(repository, "office_expenses", "POST", normalizeOfficeExpenseContribution(row));
      },
      async updateOfficeExpense(id, row) {
        return officeExpenseWrite(repository, "office_expenses", "PATCH", normalizeOfficeExpenseContribution(row), id);
      },
      async markOfficeExpensePaid(id, row = {}) {
        return repository.updateOfficeExpense(id, { ...row, status: "paid", paid_at: row.paid_at || new Date().toISOString() });
      },
      async reopenOfficeExpense(id) {
        return repository.updateOfficeExpense(id, { status: "pending", paid_at: null });
      },
      async deleteOfficeExpense(id) {
        return officeExpenseRpc(repository, "soft_delete_office_expense", { p_id: id });
      },
      async getRecurringOfficeExpenses(filters = {}) {
        const query = {
          select: "*,category:office_expense_categories!office_expense_recurring_templates_category_id_fkey(id,name,slug,color),subcategory:office_expense_categories!office_expense_recurring_templates_subcategory_id_fkey(id,name,slug,color)",
          deleted_at: "is.null",
          order: "next_due_date.asc.nullslast,created_at.desc"
        };
        if (filters.active !== undefined) query.active = `eq.${Boolean(filters.active)}`;
        if (filters.categoryId) query.category_id = `eq.${filters.categoryId}`;
        return officeExpenseSelect(repository, "office_expense_recurring_templates", query);
      },
      async createRecurringOfficeExpense(row) {
        return officeExpenseWrite(repository, "office_expense_recurring_templates", "POST", normalizeOfficeExpenseContribution(row, "default_paid_by_profile_id"));
      },
      async updateRecurringOfficeExpense(id, row) {
        return officeExpenseWrite(repository, "office_expense_recurring_templates", "PATCH", normalizeOfficeExpenseContribution(row, "default_paid_by_profile_id"), id);
      },
      async deleteRecurringOfficeExpense(id) {
        return officeExpenseRpc(repository, "soft_delete_office_expense_recurring_template", { p_id: id });
      },
      async generateDueOfficeExpenses(untilDate = localDateString()) {
        return Number(await officeExpenseRpc(repository, "generate_due_office_expenses", { p_until: untilDate }) || 0);
      },
      async getOfficeExpenseBudgets(filters = {}) {
        const query = {
          select: "*,category:office_expense_categories!office_expense_budgets_category_id_fkey(id,name,slug,color)",
          deleted_at: "is.null",
          order: "year.desc,month.desc.nullslast"
        };
        if (filters.year) query.year = `eq.${Number(filters.year)}`;
        if (filters.month !== undefined && filters.month !== "") query.month = `eq.${Number(filters.month)}`;
        if (filters.categoryId) query.category_id = `eq.${filters.categoryId}`;
        return officeExpenseSelect(repository, "office_expense_budgets", query);
      },
      async createOfficeExpenseBudget(row) {
        const budgets = await repository.getOfficeExpenseBudgets({ year: row.year });
        const existing = budgets.find(item =>
          (item.category_id || null) === (row.category_id || null)
          && (Number(item.month) || null) === (Number(row.month) || null)
        );
        if (existing) return repository.updateOfficeExpenseBudget(existing.id, row);
        return officeExpenseWrite(repository, "office_expense_budgets", "POST", row);
      },
      async updateOfficeExpenseBudget(id, row) {
        return officeExpenseWrite(repository, "office_expense_budgets", "PATCH", row, id);
      },
      async deleteOfficeExpenseBudget(id) {
        return officeExpenseRpc(repository, "soft_delete_office_expense_budget", { p_id: id });
      },
      async getOfficeExpensePartnerShares(filters = {}) {
        const query = {
          select: "*,profile:profiles!office_expense_partner_shares_profile_id_fkey(id,display_name)",
          deleted_at: "is.null",
          order: "effective_from.desc"
        };
        if (filters.active !== undefined) query.active = `eq.${Boolean(filters.active)}`;
        if (filters.date) {
          query.effective_from = `lte.${filters.date}`;
          query.or = `(effective_to.is.null,effective_to.gte.${filters.date})`;
        }
        return officeExpenseSelect(repository, "office_expense_partner_shares", query);
      },
      async saveOfficeExpensePartnerShares(rows = []) {
        const saved = [];
        for (const row of rows) {
          saved.push(row.id
            ? await officeExpenseWrite(repository, "office_expense_partner_shares", "PATCH", row, row.id)
            : await officeExpenseWrite(repository, "office_expense_partner_shares", "POST", row));
        }
        return saved;
      },
      async getOfficeExpenseDashboardData(filters = {}) {
        const [categories, expenses, recurring, budgets, shares] = await Promise.all([
          repository.getOfficeExpenseCategories(),
          repository.getOfficeExpenses(filters),
          repository.getRecurringOfficeExpenses(),
          repository.getOfficeExpenseBudgets(),
          repository.getOfficeExpensePartnerShares({ active: true, date: filters.dateTo || localDateString() })
        ]);
        return { categories, expenses, recurring, budgets, shares, generatedAt: new Date().toISOString() };
      },
      async getOfficeExpenseReportData(filters = {}) {
        return repository.getOfficeExpenseDashboardData(filters);
      },
      async globalSearch(query, options = {}) {
        const term = String(query || "").trim();
        if (term.length < 2) return { query: term, groups: [], total: 0 };
        const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 10);
        const pattern = `*${escapePostgrestValue(term)}*`;
        const select = (table, fields, searchFields, order = "created_at.desc") => officeExpenseSelect(repository, table, {
          select: fields,
          deleted_at: "is.null",
          or: `(${searchFields.map(field => `${field}.ilike.${pattern}`).join(",")})`,
          order,
          limit
        });
        const results = await Promise.all([
          select("files", "id,display_id,legacy_id,file_no,court_or_office,client_name,opponent_name,subject,file_type,status", ["display_id", "legacy_id", "file_no", "court_or_office", "client_name", "opponent_name", "subject"]),
          select("clients", "id,name,client_type,tax_id,national_id", ["name", "tax_id", "national_id"], "name.asc"),
          select("hearings", "id,file_id,hearing_date,hearing_time,court,case_file_no,participant_name,attendee_name,note", ["court", "case_file_no", "participant_name", "attendee_name", "note"], "hearing_date.desc"),
          select("deadlines", "id,file_id,title,description,due_date,responsible_name,status", ["title", "description", "responsible_name"], "due_date.asc"),
          select("tasks", "id,file_id,title,description,due_date,responsible_name,status", ["title", "description", "responsible_name"], "due_date.asc"),
          select("payment_plans", "id,file_id,client_id,party_name,plan_type,status,agreement_amount,currency", ["party_name", "plan_type", "description"]),
          select("collections", "id,file_id,payment_plan_id,description,payment_kind,amount,currency,collection_date", ["description", "payment_kind"], "collection_date.desc"),
          select("office_expenses", "id,title,description,vendor,expense_date,due_date,amount,status,payment_source", ["title", "description", "vendor"], "expense_date.desc")
        ]);
        const names = ["Dosyalar", "Müvekkiller", "Duruşmalar", "Süreli İşler", "Görevler", "Ödeme Planları", "Tahsilatlar", "Ofis Giderleri"];
        const sections = ["cases", "clients", "hearings", "deadlines", "tasks", "payments", "payments", "officeExpenses"];
        const types = ["file", "client", "hearing", "deadline", "task", "payment", "collection", "officeExpense"];
        const groups = results.map((items, index) => ({ name: names[index], section: sections[index], type: types[index], items: items || [] })).filter(group => group.items.length);
        return { query: term, groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) };
      },
      async getNotificationCenterData() {
        const current = await repository.getCurrentUser();
        const profileId = current?.id;
        if (!profileId) throw new Error("Aktif kullanıcı profili bulunamadı.");
        const today = localDateString();
        const addDays = days => {
          const date = new Date(`${today}T12:00:00`);
          date.setDate(date.getDate() + days);
          return localDateString(date);
        };
        const [hearings, deadlines, tasks, installments, plans, expenses, reads] = await Promise.all([
          repository.getHearings({ dateFrom: today, dateTo: addDays(3) }),
          repository.getDeadlines({ dateTo: addDays(3) }),
          repository.getTasks({ responsibleProfileId: profileId, dateTo: addDays(3) }),
          officeExpenseSelect(repository, "payment_installments", { select: "id,payment_plan_id,sequence_no,due_date,amount,paid_amount,status", deleted_at: "is.null", due_date: `lte.${addDays(7)}`, order: "due_date.asc" }),
          repository.getPaymentPlans(),
          repository.getOfficeExpenses({ dateTo: addDays(15) }),
          officeExpenseSelect(repository, "user_notification_reads", { select: "notification_key,read_at", profile_id: `eq.${profileId}` })
        ]);
        const completed = value => ["tamamlandı", "tamamlandi", "completed", "ödendi", "odendi", "paid", "cancelled"].includes(String(value || "").trim().toLocaleLowerCase("tr-TR"));
        const notifications = [];
        (hearings || []).forEach(item => notifications.push({ key: `hearing:${item.id}:${item.hearing_date}`, type: "hearing", section: "hearings", recordId: item.id, fileId: item.file_id, date: item.hearing_date, severity: item.hearing_date === today ? "urgent" : "info", title: item.hearing_date === today ? "Bugünkü duruşma" : "Yaklaşan duruşma", description: [item.hearing_time?.slice(0, 5), item.court, item.case_file_no].filter(Boolean).join(" · ") }));
        (deadlines || []).filter(item => !completed(item.status) && item.due_date <= addDays(3)).forEach(item => notifications.push({ key: `deadline:${item.id}:${item.due_date}`, type: "deadline", section: "deadlines", recordId: item.id, fileId: item.file_id, date: item.due_date, severity: item.due_date < today ? "urgent" : "warning", title: item.due_date < today ? "Süresi geçmiş iş" : "Yaklaşan süre", description: item.title || item.description || "Süreli iş" }));
        (tasks || []).filter(item => !completed(item.status) && item.due_date && item.due_date <= addDays(3)).forEach(item => notifications.push({ key: `task:${item.id}:${item.due_date}`, type: "task", section: "tasks", recordId: item.id, fileId: item.file_id, date: item.due_date, severity: item.due_date < today ? "urgent" : "warning", title: item.due_date < today ? "Gecikmiş görev" : "Yaklaşan görev", description: item.title || "Görev" }));
        const planMap = new Map((plans || []).map(plan => [plan.id, plan]));
        (installments || [])
          .filter(item => !completed(item.status) && Number(item.paid_amount || 0) < Number(item.amount || 0))
          .forEach(item => {
            const plan = planMap.get(item.payment_plan_id);
            notifications.push({
              key: `installment:${item.id}:${item.due_date}`,
              type: "payment",
              section: "payments",
              recordId: item.payment_plan_id,
              fileId: plan?.file_id,
              date: item.due_date,
              severity: item.due_date < today ? "urgent" : "warning",
              title: item.due_date < today ? "Gecikmiş taksit" : "Yaklaşan taksit",
              description: `${plan?.party_name || "Ödeme planı"} · ${Number(item.amount || 0).toLocaleString("tr-TR", { style: "currency", currency: plan?.currency || "TRY" })}`
            });
          });
        (expenses || []).filter(item => !completed(item.status) && item.due_date && item.due_date >= today && item.due_date <= addDays(15)).forEach(item => notifications.push({ key: `expense:${item.id}:${item.due_date}`, type: "expense", section: "officeExpenses", recordId: item.id, date: item.due_date, severity: item.due_date <= addDays(3) ? "warning" : "info", title: "Yaklaşan ofis ödemesi", description: `${item.title || "Gider"} · ${Number(item.amount || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}` }));
        const readKeys = new Set((reads || []).map(item => item.notification_key));
        notifications.forEach(item => { item.read = readKeys.has(item.key); });
        notifications.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.read === b.read ? 0 : a.read ? 1 : -1));
        return { notifications, unreadCount: notifications.filter(item => !item.read).length, generatedAt: new Date().toISOString() };
      },
      async markNotificationRead(notificationKey) {
        const current = await repository.getCurrentUser();
        if (!current?.id || !notificationKey) return null;
        const response = await fetch(`${restUrl("user_notification_reads")}?on_conflict=profile_id,notification_key`, { method: "POST", headers: { ...(await authHeaders(repository)), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ profile_id: current.id, notification_key: notificationKey, read_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
        if (!response.ok) throw new Error(`Bildirim okundu bilgisi kaydedilemedi: ${response.status}`);
        return (await response.json())[0] || null;
      },
      async markAllNotificationsRead(keys = []) {
        const uniqueKeys = [...new Set(keys.filter(Boolean))];
        return Promise.all(uniqueKeys.map(key => repository.markNotificationRead(key)));
      },
      async getUnreadNotificationCount() {
        return (await repository.getNotificationCenterData()).unreadCount;
      },
      async fetchRole(roleId) {
        if (!roleId) return null;
        const response = await fetch(`${restUrl("roles")}?select=id,name,metadata,is_system&id=eq.${encodeURIComponent(roleId)}&deleted_at=is.null&limit=1`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) return null;
        const rows = await response.json();
        return rows[0] ? { ...rows[0], name: canonicalRoleDisplayName(rows[0]) } : null;
      },
      async fetchPermissions({ roleId = "", profileId = "" }) {
        const filter = roleId
          ? `role_id=eq.${encodeURIComponent(roleId)}`
          : `profile_id=eq.${encodeURIComponent(profileId)}`;
        if (!roleId && !profileId) return [];
        const response = await fetch(`${restUrl("user_permissions")}?select=permission_key,allowed&${filter}&deleted_at=is.null&order=updated_at.asc.nullslast,created_at.asc.nullslast`, {
          headers: await authHeaders(repository)
        });
        if (!response.ok) return [];
        return response.json();
      },
      enqueueWrite(operation) {
        repository.writeQueue = repository.writeQueue
          .then(async () => {
            const session = await repository.getSession();
            if (!session) {
              throw new Error("Supabase oturumu bulunamadı.");
            }
            if (repository.offline) {
              throw new Error("Supabase bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.");
            }
            await operation();
            return true;
          })
          .catch(error => {
            repository.switchToOffline("Supabase bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.", error);
            return false;
          });
        return repository.writeQueue;
      },
      async flush() {
        return repository.writeQueue;
      },
      async writeSetting(key, value) {
        const response = await fetch(`${restUrl("settings")}?on_conflict=setting_key`, {
          method: "POST",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify({
            setting_key: key,
            setting_value: safeJson(value),
            deleted_at: null
          })
        });

        if (!response.ok) throw new Error(`settings yazılamadı: ${response.status}`);
      },
      async deleteSetting(key) {
        const response = await fetch(`${restUrl("settings")}?setting_key=eq.${encodeURIComponent(key)}`, {
          method: "PATCH",
          headers: {
            ...(await authHeaders(repository)),
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ deleted_at: new Date().toISOString() })
        });

        if (!response.ok) throw new Error(`settings silinemedi: ${response.status}`);
      },
      switchToOffline(message, error = null) {
        repository.available = false;
        repository.offline = true;
        repository.mode = "supabase-unavailable";
        if (error) console.warn(message, error);
        notifyStatus("offline", message);
        showConnectionWarning(message);
      }
    };

    if (authClient) {
      authClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          notifyStatus("unauthenticated", "Oturum kapatıldı.");
        }
      });
    }

    repository.ready = repository.preload();
    return repository;
  }

  function normalizePermissions(roleRows = [], profileRows = [], roleName = "") {
    const permissionKeys = ["view", "create", "edit", "delete", "reports", "manageUsers"];
    const permissions = Object.fromEntries(permissionKeys.map(key => [key, false]));
    roleRows.forEach(row => {
      if (row.allowed && row.permission_key in permissions) permissions[row.permission_key] = true;
    });
    if (roleName === "Yönetici / Partner") {
      permissionKeys.forEach(key => { permissions[key] = true; });
    }
    profileRows.forEach(row => {
      if (row.permission_key in permissions) permissions[row.permission_key] = Boolean(row.allowed);
    });
    return permissions;
  }

  function profileDisplayName(profile = {}) {
    return String(profile.display_name || "").trim();
  }

  function roleDisplayName(role = {}) {
    return String(role.name || "")
      .trim()
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\s*\/\s*/g, " / ")
      .replace(/\s+/g, " ");
  }

  function normalizedRoleName(role = {}) {
    return roleDisplayName(role).toLocaleLowerCase("tr-TR");
  }

  function canonicalRoleKey(role = {}) {
    const key = normalizedRoleName(role);
    if (["tam yetkili", "yönetici", "yonetici", "admin", "partner"].includes(key)) return "yönetici / partner";
    return key;
  }

  function standardRoleOrderIndex(role = {}) {
    const standardRoles = [
      "yönetici / partner",
      "avukat",
      "stajyer avukat",
      "sekreter / asistan",
      "muhasebe",
      "yalnızca görüntüleme"
    ];
    const index = standardRoleNames.map(name => normalizedRoleName({ name })).indexOf(canonicalRoleKey(role));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  function canonicalRoleDisplayName(role = {}) {
    const index = standardRoleOrderIndex(role);
    if (index !== Number.MAX_SAFE_INTEGER) return standardRoleNames[index];
    return roleDisplayName(role);
  }

  function isStandardRole(role = {}) {
    return standardRoleOrderIndex(role) !== Number.MAX_SAFE_INTEGER;
  }

  function uniqueRoles(roles = []) {
    const byName = new Map();
    roles.forEach(role => {
      if (!isStandardRole(role)) return;
      const key = canonicalRoleKey(role);
      if (!key || byName.has(key)) return;
      byName.set(key, { ...role, name: canonicalRoleDisplayName(role) });
    });
    return [...byName.values()].sort((a, b) => {
      const orderDiff = standardRoleOrderIndex(a) - standardRoleOrderIndex(b);
      return orderDiff || a.name.localeCompare(b.name, "tr");
    });
  }

  function uniqueProfiles(profiles = []) {
    const byId = new Map();
    const seenDisplayNames = new Set();
    profiles.forEach(profile => {
      if (!profile.id || byId.has(profile.id)) return;
      const displayNameKey = String(profile.displayName || "").trim().toLocaleLowerCase("tr-TR");
      if (displayNameKey && seenDisplayNames.has(displayNameKey)) return;
      byId.set(profile.id, profile);
      if (displayNameKey) seenDisplayNames.add(displayNameKey);
    });
    return [...byId.values()];
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
      return "organization";
    }
    if (normalizedTax.length === 10) return "organization";
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
    const clientType = ["person", "organization"].includes(party.clientType || party.client_type)
      ? (party.clientType || party.client_type)
      : inferRepositoryClientType(party.name, party.nationalId || party.taxId || party.tax_id);
    const rawIdentifier = normalizeTaxIdentifier(party.nationalId || party.national_id || party.taxId || party.tax_id);
    return {
      name: normalizeTextValue(party.name),
      nationalId: clientType === "person" ? rawIdentifier : "",
      taxId: clientType === "organization" ? rawIdentifier : "",
      clientType,
      roleLabel,
      partyType: repositoryPartyTypeFromRole(roleLabel, fallbackType),
      side: party.side || "other",
      phone: normalizeTextValue(party.phone),
      email: normalizeTextValue(party.email),
      representedByOffice: typeof party.representedByOffice === "boolean"
        ? party.representedByOffice
        : typeof party.represented_by_office === "boolean"
          ? party.represented_by_office
          : null,
      notes: normalizeTextValue(party.notes),
      isPrimary: Boolean(party.isPrimary)
    };
  }

  function filePartyIdentityKey(row = {}) {
    return [
      row.file_id || "",
      row.client_id || "",
      normalizeTextValue(row.name).toLocaleLowerCase("tr-TR"),
      normalizeTaxIdentifier(row.national_id || row.nationalId || row.tax_id || row.taxId),
      normalizeTextValue(row.party_type || row.partyType).toLocaleLowerCase("tr-TR"),
      normalizeTextValue(row.side).toLocaleLowerCase("tr-TR"),
      normalizeTextValue(row.role_label || row.role || row.roleLabel).toLocaleLowerCase("tr-TR")
    ].join("|");
  }

  function restUrl(table) {
    return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}`;
  }

  function escapePostgrestValue(value) {
    return String(value || "").replace(/[%,()*]/g, " ").replace(/\s+/g, " ").trim();
  }

  async function officeExpenseSelect(repository, table, query = {}) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const response = await fetch(`${restUrl(table)}?${params}`, {
      headers: await authHeaders(repository)
    });
    if (!response.ok) {
      const body = await safeResponseText(response);
      console.error("[BKT office expenses] Supabase SELECT failed.", { table, status: response.status, statusText: response.statusText, body });
      throw new Error(`Ofis giderleri verisi okunamadı: ${response.status}`);
    }
    return response.json();
  }

  function normalizeOfficeExpenseContribution(row = {}, profileKey = "paid_by_profile_id") {
    const contributionKeys = ["payment_source", "contributes_to_partner_share", "payment_method", profileKey];
    if (!contributionKeys.some(key => Object.prototype.hasOwnProperty.call(row, key))) return row;
    const normalized = { ...row };
    const source = normalized.payment_source
      || (normalized.payment_method === "office_account"
        ? "office_account"
        : normalized[profileKey]
          ? "partner_personal"
          : normalized.payment_method === "cash" ? "office_cash" : "office_account");
    normalized.payment_source = source;
    if (source === "office_account" || source === "office_cash") {
      normalized.contributes_to_partner_share = false;
      normalized[profileKey] = null;
      return normalized;
    }
    if (source !== "partner_personal" || !normalized[profileKey]) {
      throw new Error("Kişisel hesap ödemesinde ortak seçimi zorunludur.");
    }
    normalized.contributes_to_partner_share = true;
    return normalized;
  }

  async function officeExpenseWrite(repository, table, method, row, id = "") {
    const suffix = id ? `?id=eq.${encodeURIComponent(id)}&deleted_at=is.null` : "";
    const response = await fetch(`${restUrl(table)}${suffix}`, {
      method,
      headers: {
        ...(await authHeaders(repository)),
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(cleanInsertPayload(row))
    });
    if (!response.ok) {
      const body = await safeResponseText(response);
      console.error("[BKT office expenses] Supabase write failed.", { table, method, id, status: response.status, statusText: response.statusText, body });
      throw new Error(`Ofis gideri işlemi tamamlanamadı: ${response.status}`);
    }
    const rows = await response.json();
    return rows[0] || null;
  }

  async function officeExpenseRpc(repository, name, params = {}) {
    const response = await fetch(`${restUrl(`rpc/${name}`)}`, {
      method: "POST",
      headers: {
        ...(await authHeaders(repository)),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });
    if (!response.ok) {
      const body = await safeResponseText(response);
      console.error("[BKT office expenses] Supabase RPC failed.", { name, status: response.status, statusText: response.statusText, body });
      throw new Error(`Ofis gideri işlemi tamamlanamadı: ${response.status}`);
    }
    const payload = safeJson(await safeResponseText(response));
    if (Array.isArray(payload)) return payload[0] || null;
    return payload;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function safeResponseText(response) {
    try {
      return await response.text();
    } catch {
      return "";
    }
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

  function isDuplicateLegacyFileId(status, body) {
    return Number(status) === 409 && /files_legacy_id_key|duplicate key/i.test(String(body || ""));
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

  async function authHeaders(repository) {
    const session = await repository.getSession();
    const token = session?.access_token || supabaseAnonKey;
    return {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${token}`
    };
  }

  function mapAuthErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("invalid login credentials")) {
      return "E-posta adresi veya şifre hatalı.";
    }
    if (message.includes("email not confirmed")) {
      return "E-posta adresiniz henüz doğrulanmamış.";
    }
    if (
      message.includes("failed to fetch") ||
      message.includes("network") ||
      message.includes("load failed")
    ) {
      return "Supabase sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.";
    }
    return "Giriş sırasında bir hata oluştu.";
  }

  function normalizeEmail(value) {
    const email = String(value || "").trim().toLocaleLowerCase("tr-TR");
    if (!email.includes("@")) {
      const domain = config.defaultEmailDomain || window.BKT_DEFAULT_EMAIL_DOMAIN || "";
      if (domain) return `${email}@${domain}`;
      throw new Error("Supabase Auth için e-posta adresi girilmelidir.");
    }
    return email;
  }

  function safeJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function serializeSettingValue(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function notifyStatus(status, message) {
    window.BKT_SUPABASE_STATUS = { status, message, updatedAt: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent("bkt:supabase-status", { detail: window.BKT_SUPABASE_STATUS }));
  }

  function showConnectionWarning(message) {
    const existing = document.getElementById("supabaseConnectionWarning");
    if (existing) {
      existing.textContent = message;
      return;
    }

    const warning = document.createElement("div");
    warning.id = "supabaseConnectionWarning";
    warning.textContent = message;
    warning.setAttribute("role", "alert");
    Object.assign(warning.style, {
      position: "fixed",
      left: "24px",
      right: "24px",
      bottom: "18px",
      zIndex: "9999",
      padding: "12px 16px",
      borderRadius: "8px",
      border: "1px solid #f0c36d",
      background: "#fff8e5",
      color: "#6b4d00",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.14)",
      font: "600 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    });
    document.body.appendChild(warning);
  }

  window.BKTHukukRepository = {
    createBrowserRepository() {
      return createSupabaseRepository();
    }
  };
}());
