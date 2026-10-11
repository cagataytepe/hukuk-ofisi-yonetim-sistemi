import assert from "node:assert/strict";
import test from "node:test";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const PARTY_ID = "33333333-3333-4333-8333-333333333333";
const NEW_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const NEW_PARTY_ID = "55555555-5555-4555-8555-555555555555";

globalThis.window = {
  BKT_SUPABASE_CONFIG: {
    url: "https://example.supabase.co",
    publishableKey: "test-anon-key"
  },
  location: { pathname: "/index.html" },
  dispatchEvent() {}
};
globalThis.document = {
  querySelector() { return null; },
  getElementById() { return null; },
  body: { appendChild() {} }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

await import("../../services/browserRepositoryBridge.js?stabilization-1-1");

let bridgeAuthClient = null;
test.after(async () => {
  bridgeAuthClient?.auth?.stopAutoRefresh?.();
  await bridgeAuthClient?.removeAllChannels?.();
});

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(data); },
    async text() { return JSON.stringify(data); }
  };
}

function createRepository(fetchImpl) {
  globalThis.fetch = fetchImpl;
  const repository = window.BKTHukukRepository.createBrowserRepository();
  bridgeAuthClient = repository.authClient;
  repository.getSession = async () => ({ access_token: "test-access-token" });
  return repository;
}

function representedParty(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    name: "SİNEM DİLEK",
    clientType: "person",
    roleLabel: "Davalı",
    partyType: "client",
    side: "party",
    representedByOffice: true,
    ...overrides
  };
}

function existingParty() {
  return {
    id: PARTY_ID,
    file_id: FILE_ID,
    client_id: CLIENT_ID,
    name: "SİNEM DİLEK",
    party_type: "client",
    side: "party",
    role_label: "Davalı",
    tax_id: "1234567890"
  };
}

test("browser bridge boş taraf payload'unda hiçbir REST isteği yapmaz", async () => {
  let requestCount = 0;
  const repository = createRepository(async () => {
    requestCount += 1;
    throw new Error("Boş payload REST çağrısı yapmamalı.");
  });

  assert.deepEqual(await repository.syncFileParties(FILE_ID, []), []);
  assert.equal(requestCount, 0);
});

test("browser bridge açık clientId ile eşleşir ve boş payload mevcut TCKN/VKN'yi silmez", async () => {
  const clientUpdates = [];
  const requestedUrls = [];
  const client = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "12345678901",
    tax_id: "1234567890",
    phone: "5551112233",
    email: "sin@example.test",
    client_type: "person",
    metadata: {}
  };
  const repository = createRepository(async (url, options = {}) => {
    requestedUrls.push(String(url));
    const method = options.method || "GET";
    if (String(url).includes("/clients?") && method === "GET") return response([client]);
    if (String(url).includes("/clients?") && method === "PATCH") {
      const body = JSON.parse(options.body);
      clientUpdates.push(body);
      return response([{ ...client, ...body }]);
    }
    if (String(url).includes("/file_parties?") && method === "PATCH") {
      return response([{ ...existingParty(), ...JSON.parse(options.body) }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [existingParty()];

  await repository.syncFileParties(FILE_ID, [representedParty({ nationalId: "", taxId: "" })]);

  assert.equal(clientUpdates.length, 1);
  assert.equal(clientUpdates[0].national_id, "12345678901");
  assert.equal(clientUpdates[0].tax_id, "1234567890");
  assert.equal(requestedUrls.some(url => url.includes(`id=eq.${CLIENT_ID}`)), true);
  assert.equal(requestedUrls.some(url => url.includes("name=eq.")), false);
});

test("browser bridge yalnız isim taşıyan yeni tarafı mevcut müvekkille sessizce birleştirmez", async () => {
  const methods = [];
  const repository = createRepository(async (url, options = {}) => {
    const method = options.method || "GET";
    methods.push([method, String(url)]);
    if (String(url).endsWith("/clients") && method === "POST") {
      return response([{ id: CLIENT_ID, ...JSON.parse(options.body) }]);
    }
    if (String(url).endsWith("/file_parties") && method === "POST") {
      return response([{ id: PARTY_ID, ...JSON.parse(options.body) }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [];

  await repository.syncFileParties(FILE_ID, [representedParty({ clientId: "" })]);

  assert.equal(methods.some(([method, url]) => method === "GET" && url.includes("name=eq.")), false);
  assert.equal(methods.some(([method, url]) => method === "POST" && url.endsWith("/clients")), true);
});

test("browser bridge belirsiz TCKN/VKN eşleşmesinde yazma yapmadan durur", async () => {
  let writes = 0;
  const repository = createRepository(async (url, options = {}) => {
    const method = options.method || "GET";
    if (method !== "GET") writes += 1;
    if (String(url).includes("national_id=eq.12345678901")) {
      return response([{ id: CLIENT_ID }, { id: "44444444-4444-4444-8444-444444444444" }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [];

  await assert.rejects(
    repository.syncFileParties(FILE_ID, [representedParty({ clientId: "", nationalId: "12345678901" })]),
    /Belirsiz TCKN\/VKN eşleşmesi/
  );
  assert.equal(writes, 0);
});

test("browser bridge farklı TCKN girildiğinde bağlı eski müvekkili değiştirmez", async () => {
  const oldClient = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    tax_id: null,
    client_type: "person",
    metadata: {}
  };
  const clientPatches = [];
  const createdClients = [];
  const repository = createRepository(async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "GET") return response([oldClient]);
    if (target.includes("national_id=eq.22222222222") && method === "GET") return response([]);
    if (target.endsWith("/clients") && method === "POST") {
      const body = JSON.parse(options.body);
      createdClients.push(body);
      return response([{ id: NEW_CLIENT_ID, ...body }]);
    }
    if (target.includes("/clients?") && method === "PATCH") {
      clientPatches.push(JSON.parse(options.body));
      return response([]);
    }
    if (target.endsWith("/file_parties") && method === "POST") {
      return response([{ id: NEW_PARTY_ID, ...JSON.parse(options.body) }]);
    }
    if (target.includes(`/file_parties?id=eq.${PARTY_ID}`) && method === "PATCH") {
      return response([{ ...existingParty(), deleted_at: new Date().toISOString() }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [{ ...existingParty(), client: oldClient }];

  await repository.syncFileParties(FILE_ID, [representedParty({
    name: "MEHMET KAYA",
    nationalId: "22222222222"
  })]);

  assert.equal(clientPatches.length, 0);
  assert.equal(createdClients.length, 1);
  assert.equal(createdClients[0].name, "MEHMET KAYA");
  assert.equal(createdClients[0].national_id, "22222222222");
});

test("browser bridge yeni TCKN tek bir müvekkille eşleşirse eski kayıt yerine ona bağlanır", async () => {
  const oldClient = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    client_type: "person",
    metadata: {}
  };
  const matchedClient = {
    id: NEW_CLIENT_ID,
    name: "MEHMET KAYA",
    national_id: "22222222222",
    client_type: "person",
    metadata: {}
  };
  const patchedClientIds = [];
  let clientCreated = false;
  const repository = createRepository(async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "GET") return response([oldClient]);
    if (target.includes("national_id=eq.22222222222") && method === "GET") return response([matchedClient]);
    if (target.endsWith("/clients") && method === "POST") {
      clientCreated = true;
      return response([]);
    }
    if (target.includes(`/clients?id=eq.${NEW_CLIENT_ID}`) && method === "PATCH") {
      patchedClientIds.push(NEW_CLIENT_ID);
      return response([{ ...matchedClient, ...JSON.parse(options.body) }]);
    }
    if (target.endsWith("/file_parties") && method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.client_id, NEW_CLIENT_ID);
      return response([{ id: NEW_PARTY_ID, ...body }]);
    }
    if (target.includes(`/file_parties?id=eq.${PARTY_ID}`) && method === "PATCH") {
      return response([{ ...existingParty(), deleted_at: new Date().toISOString() }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [{ ...existingParty(), client: oldClient }];

  await repository.syncFileParties(FILE_ID, [representedParty({
    name: "MEHMET KAYA",
    nationalId: "22222222222"
  })]);

  assert.equal(clientCreated, false);
  assert.deepEqual(patchedClientIds, [NEW_CLIENT_ID]);
});

test("browser bridge kişi-kurum türü değiştiğinde eski müvekkili dönüştürmez", async () => {
  const oldClient = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    tax_id: null,
    client_type: "person",
    metadata: {}
  };
  let oldClientPatched = false;
  let createdType = "";
  const repository = createRepository(async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "GET") return response([oldClient]);
    if (target.includes("tax_id=eq.1234567890") && method === "GET") return response([]);
    if (target.endsWith("/clients") && method === "POST") {
      const body = JSON.parse(options.body);
      createdType = body.client_type;
      return response([{ id: NEW_CLIENT_ID, ...body }]);
    }
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "PATCH") {
      oldClientPatched = true;
      return response([]);
    }
    if (target.endsWith("/file_parties") && method === "POST") {
      return response([{ id: NEW_PARTY_ID, ...JSON.parse(options.body) }]);
    }
    if (target.includes(`/file_parties?id=eq.${PARTY_ID}`) && method === "PATCH") {
      return response([{ ...existingParty(), deleted_at: new Date().toISOString() }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [{ ...existingParty(), client: oldClient }];

  await repository.syncFileParties(FILE_ID, [representedParty({
    name: "SİNEM DİLEK LTD. ŞTİ.",
    clientType: "organization",
    taxId: "1234567890"
  })]);

  assert.equal(oldClientPatched, false);
  assert.equal(createdType, "organization");
});

test("browser bridge aynı TCKN ile güvenli ad düzeltmesine izin verir", async () => {
  const client = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    tax_id: null,
    client_type: "person",
    metadata: {}
  };
  const clientPatches = [];
  const repository = createRepository(async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "GET") return response([client]);
    if (target.includes("national_id=eq.11111111111") && method === "GET") return response([client]);
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "PATCH" && target.includes("/clients?")) {
      const body = JSON.parse(options.body);
      clientPatches.push(body);
      return response([{ ...client, ...body }]);
    }
    if (target.endsWith("/file_parties") && method === "POST") {
      return response([{ id: NEW_PARTY_ID, ...JSON.parse(options.body) }]);
    }
    if (target.includes(`/file_parties?id=eq.${PARTY_ID}`) && method === "PATCH") {
      return response([{ ...existingParty(), deleted_at: new Date().toISOString() }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [{ ...existingParty(), client }];

  await repository.syncFileParties(FILE_ID, [representedParty({
    name: "SİNEM DİLEK TURAN",
    nationalId: "11111111111"
  })]);

  assert.equal(clientPatches.length, 1);
  assert.equal(clientPatches[0].name, "SİNEM DİLEK TURAN");
  assert.equal(clientPatches[0].national_id, "11111111111");
});

test("browser bridge kimliksiz ad değişikliğinde eski müvekkili sessizce yeniden adlandırmaz", async () => {
  const oldClient = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: null,
    tax_id: null,
    client_type: "person",
    metadata: {}
  };
  let oldClientPatched = false;
  let createdName = "";
  const repository = createRepository(async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "GET") return response([oldClient]);
    if (target.endsWith("/clients") && method === "POST") {
      const body = JSON.parse(options.body);
      createdName = body.name;
      return response([{ id: NEW_CLIENT_ID, ...body }]);
    }
    if (target.includes(`id=eq.${CLIENT_ID}`) && method === "PATCH") {
      oldClientPatched = true;
      return response([]);
    }
    if (target.endsWith("/file_parties") && method === "POST") {
      return response([{ id: NEW_PARTY_ID, ...JSON.parse(options.body) }]);
    }
    if (target.includes(`/file_parties?id=eq.${PARTY_ID}`) && method === "PATCH") {
      return response([{ ...existingParty(), deleted_at: new Date().toISOString() }]);
    }
    throw new Error(`Beklenmeyen REST çağrısı: ${method} ${url}`);
  });
  repository.getFileParties = async () => [{ ...existingParty(), client: oldClient }];

  await repository.syncFileParties(FILE_ID, [representedParty({ name: "MEHMET KAYA" })]);

  assert.equal(oldClientPatched, false);
  assert.equal(createdName, "MEHMET KAYA");
});
