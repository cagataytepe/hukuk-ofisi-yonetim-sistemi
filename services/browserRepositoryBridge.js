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

  function createLocalStorageRepository(storage) {
    return {
      mode: "localStorage",
      getItem(key) {
        return storage.getItem(key);
      },
      setItem(key, value) {
        storage.setItem(key, value);
      },
      removeItem(key) {
        storage.removeItem(key);
      }
    };
  }

  function createSupabaseRepository(storage) {
    const offlineRepository = createLocalStorageRepository(storage);
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
        return repository.offline ? offlineRepository.getItem(key) : null;
      },
      async getItemAsync(key) {
        await repository.ready;
        return repository.getItem(key);
      },
      setItem(key, value) {
        cache.set(key, value);
        return repository.enqueueWrite(async () => {
          await repository.writeSetting(key, value);
          offlineRepository.setItem(key, value);
        }, () => offlineRepository.setItem(key, value));
      },
      async setItemAsync(key, value) {
        await repository.setItem(key, value);
      },
      removeItem(key) {
        cache.delete(key);
        return repository.enqueueWrite(async () => {
          await repository.deleteSetting(key);
          offlineRepository.removeItem(key);
        }, () => offlineRepository.removeItem(key));
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
            offlineRepository.setItem(row.setting_key, value);
          });

          repository.available = true;
          repository.offline = false;
          repository.mode = "supabase";
          notifyStatus("online", "Supabase bağlantısı kuruldu.");
          return true;
        } catch (error) {
          repository.switchToOffline("Supabase bağlantısı kurulamadı. Çevrimdışı yedek veri kullanılıyor.", error);
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
      enqueueWrite(operation, offlineOperation) {
        repository.writeQueue = repository.writeQueue
          .then(async () => {
            const session = await repository.getSession();
            if (!session) {
              offlineOperation();
              return false;
            }
            if (repository.offline) {
              offlineOperation();
              return false;
            }
            await operation();
            return true;
          })
          .catch(error => {
            repository.switchToOffline("Supabase bağlantısı kesildi. Değişiklikler çevrimdışı yedeğe alındı.", error);
            offlineOperation();
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
        repository.mode = "localStorage";
        if (error) console.warn(message, error);
        hydrateCacheFromOffline(offlineRepository, cache);
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

  function hydrateCacheFromOffline(offlineRepository, cache) {
    [
      "hukukBurosuTakipDemo.v2",
      "hukukBurosuKullanicilar.v1",
      "hukukBurosuTakipDemo.backup.preFiles.20260611"
    ].forEach(key => {
      const value = offlineRepository.getItem(key);
      if (value !== null) cache.set(key, value);
    });
  }

  function restUrl(table) {
    return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}`;
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
      return createSupabaseRepository(window.localStorage);
    }
  };
}());
