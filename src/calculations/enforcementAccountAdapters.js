import {
  calculateEnforcementAccount,
  calculateEnforcementFileAccount,
  hasEnforcementAccountData,
  normalizeInterestType
} from "./enforcementCalculator.js";

export const ENFORCEMENT_ACCOUNT_TIME_ZONE = "Europe/Istanbul";

function requireAccountDate(accountDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(accountDate || ""))) {
    throw new Error("İcra hesabı için YYYY-MM-DD biçiminde accountDate zorunludur.");
  }
  return accountDate;
}

export function accountDateInTimeZone(date = new Date(), timeZone = ENFORCEMENT_ACCOUNT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function groupActiveCollectionsByFile(collections = []) {
  const collectionsByFile = new Map();
  for (const collection of Array.isArray(collections) ? collections : []) {
    if (collection?.deleted_at || collection?.deletedAt) continue;
    const fileId = collection?.file_id || collection?.fileId;
    if (!fileId) continue;
    if (!collectionsByFile.has(fileId)) collectionsByFile.set(fileId, []);
    collectionsByFile.get(fileId).push(collection);
  }
  return collectionsByFile;
}

export function buildEnforcementAccountFile(file = {}, collections) {
  if (!Array.isArray(collections)) {
    throw new Error("İcra hesabı için tahsilat verisi yüklenmelidir.");
  }
  const fileId = file.id || file.file_id || file.fileId;
  const paymentEvents = collections.filter(collection => {
    if (collection?.deleted_at || collection?.deletedAt) return false;
    const collectionFileId = collection?.file_id || collection?.fileId;
    return !fileId || !collectionFileId || collectionFileId === fileId;
  });
  return {
    ...file,
    payment_events: paymentEvents,
    enforcement_collections_hydrated: true
  };
}

export function calculateDesktopEnforcementAccount(values = {}, tools = {}, accountDate = "") {
  const calculationDate = requireAccountDate(accountDate || values.accountDate);
  return calculateEnforcementAccount({
    ...values,
    interestType: normalizeInterestType(values.interestType),
    accountDate: calculationDate
  }, tools);
}

export function calculateMobileEnforcementAccount(file = {}, tools = {}, accountDate = "") {
  const calculationDate = requireAccountDate(accountDate);
  if (!hasEnforcementAccountData(file)) return null;
  return calculateEnforcementFileAccount(file, tools, calculationDate);
}

export function toMoneyCents(value) {
  return Math.round((Number(value) || 0) * 100);
}
