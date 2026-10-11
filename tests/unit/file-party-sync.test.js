import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SupabaseRepository } from "../../repositories/SupabaseRepository.js";
import {
  loadFilePartiesForEdit,
  replaceFilePartyCache,
  verifyFilePartiesUnchanged
} from "../../src/shared/filePartyConcurrency.mjs";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_PARTY_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_PARTY_ID = "44444444-4444-4444-8444-444444444444";

function duplicateParty(id) {
  return {
    id,
    file_id: FILE_ID,
    client_id: CLIENT_ID,
    name: "SİNEM DİLEK",
    party_type: "client",
    side: "party",
    role_label: "Davalı"
  };
}

function repositoryWithParties(existing = [duplicateParty(FIRST_PARTY_ID), duplicateParty(SECOND_PARTY_ID)]) {
  const repository = new SupabaseRepository({});
  const updated = [];
  const clientUpdates = [];
  const deleted = [];
  let reads = 0;

  repository.getFileParties = async () => {
    reads += 1;
    return existing;
  };
  repository.findClientForParty = async () => ({ id: CLIENT_ID, name: "SİNEM DİLEK", client_type: "person" });
  repository.updateClient = async (id, row) => {
    clientUpdates.push(row);
    return { id, ...row };
  };
  repository.createClient = async () => assert.fail("Mevcut müvekkil yeniden oluşturulmamalı.");
  repository.createFileParty = async () => assert.fail("Aynı taraf için yeni kayıt oluşturulmamalı.");
  repository.updateFileParty = async (id, row) => {
    updated.push(id);
    return { id, ...row };
  };
  repository.deleteFileParty = async id => {
    deleted.push(id);
    return { id };
  };

  return { repository, updated, clientUpdates, deleted, get reads() { return reads; } };
}

function representedParty() {
  return {
    clientId: CLIENT_ID,
    name: "SİNEM DİLEK",
    clientType: "person",
    roleLabel: "Davalı",
    partyType: "client",
    side: "party",
    representedByOffice: true
  };
}

function repositoryForClientLookups(resolveRows) {
  const requests = [];
  const supabase = {
    from(table) {
      assert.equal(table, "clients");
      const filters = {};
      const query = {
        select() { return query; },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        is() { return query; },
        limit() {
          requests.push({ ...filters });
          return Promise.resolve({ data: resolveRows(filters), error: null });
        }
      };
      return query;
    }
  };
  return { repository: new SupabaseRepository(supabase), requests };
}

test("Supabase senkronizasyonu boş kimlik payload'unda mevcut TCKN/VKN'yi korur", async () => {
  const state = repositoryWithParties([duplicateParty(FIRST_PARTY_ID)]);
  state.repository.findClientForParty = async () => ({
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "12345678901",
    tax_id: null,
    client_type: "person",
    metadata: {}
  });

  await state.repository.syncFileParties(FILE_ID, [representedParty()]);

  assert.equal(state.clientUpdates[0].national_id, "12345678901");
  assert.equal(state.clientUpdates[0].tax_id, null);
});

test("Supabase senkronizasyonu boş vergi numarası payload'unda mevcut VKN'yi korur", async () => {
  const state = repositoryWithParties([{ ...duplicateParty(FIRST_PARTY_ID), name: "ÖRNEK ŞİRKET", tax_id: "1234567890" }]);
  state.repository.findClientForParty = async () => ({
    id: CLIENT_ID,
    name: "ÖRNEK ŞİRKET",
    national_id: null,
    tax_id: "1234567890",
    client_type: "organization",
    metadata: {}
  });

  await state.repository.syncFileParties(FILE_ID, [{
    ...representedParty(),
    name: "ÖRNEK ŞİRKET",
    clientType: "organization"
  }]);

  assert.equal(state.clientUpdates[0].national_id, null);
  assert.equal(state.clientUpdates[0].tax_id, "1234567890");
});

test("Supabase repository farklı TCKN için eski clientId kaydını döndürmez", async () => {
  const oldClient = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    client_type: "person"
  };
  const state = repositoryForClientLookups(filters => {
    if (filters.id === CLIENT_ID) return [oldClient];
    if (filters.national_id === "22222222222") return [];
    return [];
  });

  const result = await state.repository.findClientForParty({
    clientId: CLIENT_ID,
    name: "MEHMET KAYA",
    nationalId: "22222222222",
    clientType: "person"
  });

  assert.equal(result, null);
  assert.deepEqual(state.requests, [{ id: CLIENT_ID }, { national_id: "22222222222" }]);
});

test("Supabase repository eşleşen kimlikte farklı kişi-kurum türünü güvenli biçimde reddeder", async () => {
  const mismatched = {
    id: "55555555-5555-4555-8555-555555555555",
    name: "HATALI TÜR",
    national_id: "22222222222",
    client_type: "organization"
  };
  const state = repositoryForClientLookups(filters => filters.national_id === "22222222222" ? [mismatched] : []);

  await assert.rejects(
    state.repository.findClientForParty({
      name: "MEHMET KAYA",
      nationalId: "22222222222",
      clientType: "person"
    }),
    /kişi\/kurum türü farklı/
  );
});

test("Supabase repository aynı kimlikle güvenli müvekkil düzeltmesini korur", async () => {
  const client = {
    id: CLIENT_ID,
    name: "SİNEM DİLEK",
    national_id: "11111111111",
    client_type: "person"
  };
  const state = repositoryForClientLookups(filters => {
    if (filters.id === CLIENT_ID || filters.national_id === "11111111111") return [client];
    return [];
  });

  const result = await state.repository.findClientForParty({
    clientId: CLIENT_ID,
    name: "SİNEM DİLEK TURAN",
    nationalId: "11111111111",
    clientType: "person"
  });

  assert.equal(result.id, CLIENT_ID);
});

test("dosya taraf senkronizasyonu formdan kaldırılan yinelenen kaydı soft-delete eder", async () => {
  const { repository, updated, deleted } = repositoryWithParties();

  await repository.syncFileParties(FILE_ID, [representedParty()]);

  assert.deepEqual(updated, [SECOND_PARTY_ID]);
  assert.deepEqual(deleted, [FIRST_PARTY_ID]);
});

for (const [label, payload] of [["undefined", undefined], ["null", null], ["boş dizi", []]]) {
  test(`${label} taraf payload'u mevcut tarafları silmez`, async () => {
    const state = repositoryWithParties();

    await state.repository.syncFileParties(FILE_ID, payload);

    assert.equal(state.reads, 0);
    assert.deepEqual(state.updated, []);
    assert.deepEqual(state.deleted, []);
  });
}

test("aynı taraf korunur", async () => {
  const state = repositoryWithParties([duplicateParty(FIRST_PARTY_ID)]);

  await state.repository.syncFileParties(FILE_ID, [representedParty()]);

  assert.deepEqual(state.updated, [FIRST_PARTY_ID]);
  assert.deepEqual(state.deleted, []);
});

test("en az bir geçerli taraf kalınca listeden çıkarılan eski taraf soft-delete edilir", async () => {
  const retained = duplicateParty(FIRST_PARTY_ID);
  const removed = {
    ...duplicateParty(SECOND_PARTY_ID),
    client_id: "55555555-5555-4555-8555-555555555555",
    name: "KALDIRILAN TARAF"
  };
  const state = repositoryWithParties([retained, removed]);

  await state.repository.syncFileParties(FILE_ID, [representedParty()]);

  assert.deepEqual(state.updated, [FIRST_PARTY_ID]);
  assert.deepEqual(state.deleted, [SECOND_PARTY_ID]);
});

test("browser bridge ve uygulama katmanı boş taraf guard'ını korur", () => {
  const bridge = fs.readFileSync(new URL("../../services/browserRepositoryBridge.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../../outputs/hukuk-burosu-takip-sistemi.html", import.meta.url), "utf8");

  assert.match(bridge, /if \(!cleanParties\.length\) return \[\];/);
  assert.match(app, /const parties = repositoryPartyRowsFromFile\(sourceFile\);\s+if \(!parties\.length\) return \[\];/);
});

for (const scenario of [
  {
    label: "dava",
    initial: { ...duplicateParty(FIRST_PARTY_ID), side: "party", role_label: "Davalı" },
    added: { ...duplicateParty(SECOND_PARTY_ID), client_id: "55555555-5555-4555-8555-555555555555", name: "YENİ KARŞI TARAF", side: "other_party", role_label: "Davacı" }
  },
  {
    label: "icra",
    initial: { ...duplicateParty(FIRST_PARTY_ID), side: "creditor", role_label: "Alacaklı" },
    added: { ...duplicateParty(SECOND_PARTY_ID), client_id: "55555555-5555-4555-8555-555555555555", name: "YENİ BORÇLU", side: "debtor", role_label: "Borçlu" }
  }
]) {
  test(`${scenario.label} taraf düzenlemesinde eklenen taraf ikinci açılışta güncel listeden gelir`, async () => {
    let remoteRows = [scenario.initial];
    const repository = {
      async getFileParties({ fileId }) {
        assert.equal(fileId, FILE_ID);
        return structuredClone(remoteRows);
      }
    };

    const firstOpen = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
    assert.equal(firstOpen.rows.length, 1);
    remoteRows = [scenario.initial, scenario.added];
    const secondOpen = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
    const cache = replaceFilePartyCache([{ file_id: "99999999-9999-4999-8999-999999999999" }], FILE_ID, secondOpen.rows);

    assert.equal(secondOpen.rows.length, 2);
    assert.equal(secondOpen.rows.some(row => row.side === scenario.added.side), true);
    assert.equal(cache.length, 3);
  });
}

test("kaydetme öncesi uzak taraf değişikliği stale form yazmasını engeller", async () => {
  let remoteRows = [duplicateParty(FIRST_PARTY_ID)];
  let writes = 0;
  const repository = {
    async getFileParties() {
      return structuredClone(remoteRows);
    },
    async syncFileParties() {
      writes += 1;
    }
  };
  const baseline = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
  remoteRows = [...remoteRows, { ...duplicateParty(SECOND_PARTY_ID), side: "debtor", name: "SONRADAN EKLENEN" }];

  const verification = await verifyFilePartiesUnchanged({ repository, baseline });
  if (verification.unchanged) await repository.syncFileParties();

  assert.equal(verification.unchanged, false);
  assert.equal(writes, 0);
});

test("borçlu ekleme, yeniden açma ve yalnız durum değiştirme akışı tarafı korur", async () => {
  const creditor = { ...duplicateParty(FIRST_PARTY_ID), side: "creditor", role_label: "Alacaklı" };
  const debtor = {
    ...duplicateParty(SECOND_PARTY_ID),
    client_id: "55555555-5555-4555-8555-555555555555",
    name: "MEHMET KAYA",
    side: "debtor",
    role_label: "Borçlu"
  };
  let remoteRows = [creditor];
  const repository = {
    async getFileParties() {
      return structuredClone(remoteRows);
    },
    async syncFileParties(fileId, parties) {
      assert.equal(fileId, FILE_ID);
      remoteRows = structuredClone(parties);
      return structuredClone(remoteRows);
    }
  };

  const firstOpen = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
  const firstVerification = await verifyFilePartiesUnchanged({ repository, baseline: firstOpen });
  assert.equal(firstVerification.unchanged, true);
  await repository.syncFileParties(FILE_ID, [creditor, debtor]);

  const secondOpen = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
  assert.equal(secondOpen.rows.some(row => row.name === "MEHMET KAYA"), true);
  const statusOnlyVerification = await verifyFilePartiesUnchanged({ repository, baseline: secondOpen });
  assert.equal(statusOnlyVerification.unchanged, true);
  await repository.syncFileParties(FILE_ID, secondOpen.rows);

  const thirdOpen = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
  assert.equal(thirdOpen.rows.length, 2);
  assert.equal(thirdOpen.rows.some(row => row.name === "MEHMET KAYA"), true);
});

test("taraf okuma hatası düzenleme başlangıcını ve kaydı bloke edecek şekilde iletilir", async () => {
  const repository = {
    async getFileParties() {
      throw new Error("network unavailable");
    }
  };

  await assert.rejects(loadFilePartiesForEdit({ repository, fileId: FILE_ID }), /network unavailable/);
  await assert.rejects(
    verifyFilePartiesUnchanged({ repository, baseline: { fileId: FILE_ID, revision: "[]" } }),
    /network unavailable/
  );
});

test("boş uzak taraf listesi geçerli revizyon üretir ve başka dosyanın önbelleğini silmez", async () => {
  const otherFileId = "99999999-9999-4999-8999-999999999999";
  const repository = { async getFileParties() { return []; } };
  const baseline = await loadFilePartiesForEdit({ repository, fileId: FILE_ID });
  const verification = await verifyFilePartiesUnchanged({ repository, baseline });
  const cache = replaceFilePartyCache([{ file_id: otherFileId, id: "other" }, duplicateParty(FIRST_PARTY_ID)], FILE_ID, []);

  assert.equal(verification.unchanged, true);
  assert.deepEqual(cache, [{ file_id: otherFileId, id: "other" }]);
});
