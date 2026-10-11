import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SupabaseRepository } from "../../repositories/SupabaseRepository.js";

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
