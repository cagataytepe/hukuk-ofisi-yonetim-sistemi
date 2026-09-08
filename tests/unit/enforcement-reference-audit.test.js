import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  calculateEnforcementAccount,
  normalizePayments
} from "../../src/calculations/enforcementCalculator.js";
import {
  calculateIndependentReference,
  calculateLegacyEndDeduction,
  normalizeReferencePayments
} from "../support/independentEnforcementReference.js";

const STATUTORY_RATES = [
  { id: "rate-24", type: "Adi Kanuni Faiz", from: "2024-06-01", to: "2026-07-30", rate: 24, active: true },
  { id: "rate-31", type: "Adi Kanuni Faiz", from: "2026-07-31", to: null, rate: 31, active: true }
];

function toolsFor({ type = "Test Faizi", rate = 24, attorneyFee = 0, rates } = {}) {
  return {
    interestRates: rates || [{ id: "fixed-rate", type, from: "2000-01-01", to: null, rate, active: true }],
    attorneyFeeTariffs: attorneyFee > 0 ? [{
      id: "test-tariff",
      from: "2000-01-01",
      to: null,
      active: true,
      regularMinimum: attorneyFee,
      evictionMinimum: attorneyFee,
      maximumAmount: null,
      brackets: []
    }] : [],
    parameters: []
  };
}

function productionValues(input) {
  return {
    principal: input.principal,
    preInterest: input.preInterest,
    expenses: input.costs,
    fees: input.collectionFee,
    interestType: input.interestType,
    interestRate: input.interestRate,
    interestStart: input.interestStart,
    accountDate: input.accountDate,
    paymentEvents: input.paymentEvents
  };
}

function assertMoneyParity(reference, production, fields = [
  "principalOutstanding",
  "postEnforcementInterest",
  "postEnforcementInterestAccrued",
  "eligibleCostsOutstanding",
  "enforcementAttorneyFeeOutstanding",
  "collectionFeeOutstanding",
  "paymentsAppliedToFeriler",
  "paymentsAppliedToPrincipal",
  "currentDebt"
]) {
  for (const field of fields) {
    assert.equal(TO_CENTS(production[field]), TO_CENTS(reference[field]), `${field} bağımsız hesapla eşleşmiyor`);
  }
}

const TO_CENTS = value => Math.round(Number(value || 0) * 100);

const SINGLE_PAYMENT = {
  principal: 100_000,
  preInterest: 1_000,
  costs: 500,
  attorneyFee: 2_000,
  collectionFee: 0,
  interestType: "Test Faizi",
  interestRate: 24,
  interestRates: toolsFor().interestRates,
  interestStart: "2026-01-01",
  accountDate: "2026-01-21",
  paymentEvents: [{ id: "single", date: "2026-01-11", amount: 5_000 }]
};

test("bağımsız reference calculator production motorundan kod veya import paylaşmaz", () => {
  const source = fs.readFileSync(new URL("../support/independentEnforcementReference.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /enforcementCalculator|enforcementAccountAdapters|src\/calculations/);
});

test("elle doğrulanabilir tek ödeme hesabı kuruş düzeyinde eşleşir", () => {
  const reference = calculateIndependentReference(SINGLE_PAYMENT);
  const production = calculateEnforcementAccount(productionValues(SINGLE_PAYMENT), toolsFor({ attorneyFee: 2_000 }));

  assert.deepEqual({
    principalOutstanding: reference.principalOutstanding,
    postEnforcementInterest: reference.postEnforcementInterest,
    paymentsAppliedToFeriler: reference.paymentsAppliedToFeriler,
    paymentsAppliedToPrincipal: reference.paymentsAppliedToPrincipal,
    currentDebt: reference.currentDebt
  }, {
    principalOutstanding: 99_157.53,
    postEnforcementInterest: 651.99,
    paymentsAppliedToFeriler: 4_157.53,
    paymentsAppliedToPrincipal: 842.47,
    currentDebt: 99_809.52
  });
  assert.deepEqual(reference.interestPeriods.map(period => [period.from, period.to, period.days, period.rate]), [
    ["2026-01-02", "2026-01-11", 10, 24],
    ["2026-01-12", "2026-01-21", 10, 24]
  ]);
  assertMoneyParity(reference, production);
});

test("üç ödeme ve faiz değişimi kronolojik olarak azaltılmış ana parayı kullanır", () => {
  const input = {
    principal: 100_000,
    preInterest: 1_000,
    costs: 500,
    attorneyFee: 2_000,
    interestType: "Adi Kanuni Faiz",
    interestRates: STATUTORY_RATES,
    interestStart: "2026-07-20",
    accountDate: "2026-08-10",
    paymentEvents: [
      { id: "payment-a", date: "2026-07-25", amount: 5_000 },
      { id: "payment-b", date: "2026-07-30", amount: 10_000 },
      { id: "payment-c", date: "2026-08-05", amount: 15_000 }
    ]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount(productionValues(input), toolsFor({
    attorneyFee: 2_000,
    rates: STATUTORY_RATES
  }));

  assert.deepEqual({
    principalOutstanding: reference.principalOutstanding,
    postEnforcementInterest: reference.postEnforcementInterest,
    paymentsAppliedToFeriler: reference.paymentsAppliedToFeriler,
    paymentsAppliedToPrincipal: reference.paymentsAppliedToPrincipal,
    currentDebt: reference.currentDebt
  }, {
    principalOutstanding: 74_608.01,
    postEnforcementInterest: 316.83,
    paymentsAppliedToFeriler: 4_608.01,
    paymentsAppliedToPrincipal: 25_391.99,
    currentDebt: 74_924.84
  });
  assert.deepEqual(reference.paymentLedger.map(entry => entry.principalAfterPayment), [98_828.77, 89_153.69, 74_608.01]);
  assert.equal(reference.interestPeriods.at(-1).principal, 74_608.01);
  assertMoneyParity(reference, production);
});

test("31.07.2026 sınırındaki ödeme günleri iki kez faizlendirmez", () => {
  const input = {
    principal: 100_000,
    interestType: "Adi Kanuni Faiz",
    interestRates: STATUTORY_RATES,
    interestStart: "2026-07-29",
    accountDate: "2026-08-01",
    paymentEvents: [{ id: "boundary", date: "2026-07-31", amount: 1_000 }]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount(productionValues(input), toolsFor({ rates: STATUTORY_RATES }));

  assert.deepEqual(reference.interestPeriods.map(period => [period.from, period.to, period.days, period.rate]), [
    ["2026-07-30", "2026-07-30", 1, 24],
    ["2026-07-31", "2026-07-31", 1, 31],
    ["2026-08-01", "2026-08-01", 1, 31]
  ]);
  assert.equal(reference.postEnforcementInterestAccrued, 234.89);
  assert.equal(reference.currentDebt, 99_234.89);
  assertMoneyParity(reference, production);
});

test("ferilere yetmeyen ödeme ana parayı azaltmaz", () => {
  const input = {
    ...SINGLE_PAYMENT,
    paymentEvents: [{ id: "insufficient", date: "2026-01-11", amount: 1_000 }]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount(productionValues(input), toolsFor({ attorneyFee: 2_000 }));

  assert.equal(reference.principalOutstanding, 100_000);
  assert.equal(reference.paymentsAppliedToPrincipal, 0);
  assert.equal(reference.currentDebt, 103_815.06);
  assertMoneyParity(reference, production);
});

test("ana paraya ulaşan ödeme legacy hesap-sonu indirim hatasını görünür kılar", () => {
  const reference = calculateIndependentReference(SINGLE_PAYMENT);
  const legacy = calculateLegacyEndDeduction(SINGLE_PAYMENT);

  assert.equal(reference.paymentLedger[0].principalAfterPayment, 99_157.53);
  assert.equal(reference.currentDebt, 99_809.52);
  assert.equal(legacy.currentDebt, 99_815.07);
  assert.equal(TO_CENTS(legacy.currentDebt - reference.currentDebt), 555);
});

test("bir günlük ödeme sınırı bağımsız formülle 0,01 TL fark üretmez", () => {
  const input = {
    principal: 100_000,
    interestType: "Adi Kanuni Faiz",
    interestRate: 24,
    interestRates: STATUTORY_RATES,
    interestStart: "2026-07-30",
    accountDate: "2026-08-01",
    paymentEvents: [{ id: "one-day", date: "2026-07-31", amount: 10_000 }]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount(productionValues(input), toolsFor({ rates: STATUTORY_RATES }));

  assert.deepEqual(reference.interestPeriods.map(period => period.from), ["2026-07-31", "2026-08-01"]);
  assert.equal(reference.postEnforcementInterestAccrued, 161.44);
  assert.equal(reference.currentDebt, 90_161.44);
  assertMoneyParity(reference, production);
});

test("aynı gün talimatsız ödemeler birleşir, açık talimatlı ödemeler birleşmez", () => {
  const plain = [
    { id: "b", date: "2026-01-11", amount: 2_000 },
    { id: "a", date: "2026-01-11", amount: 3_000 }
  ];
  const designated = plain.map((payment, index) => ({
    ...payment,
    metadata: { designation: `borc-${index + 1}` }
  }));
  const groupedReference = calculateIndependentReference({ ...SINGLE_PAYMENT, paymentEvents: plain });
  const singleReference = calculateIndependentReference({
    ...SINGLE_PAYMENT,
    paymentEvents: [{ id: "single", date: "2026-01-11", amount: 5_000 }]
  });

  assert.equal(normalizeReferencePayments(plain).length, 1);
  assert.equal(normalizePayments(plain).length, 1);
  assert.equal(normalizeReferencePayments(designated).length, 2);
  assert.equal(normalizePayments(designated).length, 2);
  assert.equal(TO_CENTS(groupedReference.currentDebt), TO_CENTS(singleReference.currentDebt));
});

test("aynı collection kimliği motora iki kez ulaşsa bile ödeme yalnız bir kez uygulanır", () => {
  const payment = { id: "same-collection-id", date: "2026-01-11", amount: 5_000 };
  const duplicatedInput = { ...SINGLE_PAYMENT, paymentEvents: [payment, { ...payment }] };
  const reference = calculateIndependentReference(duplicatedInput);
  const production = calculateEnforcementAccount(productionValues(duplicatedInput), toolsFor({ attorneyFee: 2_000 }));

  assert.equal(normalizeReferencePayments(duplicatedInput.paymentEvents).length, 1);
  assert.equal(normalizePayments(duplicatedInput.paymentEvents).length, 1);
  assert.equal(production.paymentLedger.length, 1);
  assert.equal(production.totalPayments, 5_000);
  assert.equal(production.currentDebt, 99_809.52);
  assertMoneyParity(reference, production);
});

test("tahsil harcı TBK 100 feri sepetine girmez ve event başına yeniden tahakkuk etmez", () => {
  const input = {
    principal: 100_000,
    collectionFee: 10_000,
    interestStart: "2026-01-01",
    accountDate: "2026-01-01",
    paymentEvents: [
      { id: "fee-a", date: "2026-01-01", amount: 5_000 },
      { id: "fee-b", date: "2026-01-01", amount: 5_000 }
    ]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount({
    principal: 100_000,
    feeRate: 10,
    interestStart: "2026-01-01",
    accountDate: "2026-01-01",
    paymentEvents: input.paymentEvents
  }, toolsFor());

  assert.equal(reference.paymentLedger.length, 1);
  assert.equal(reference.paymentsAppliedToFeriler, 0);
  assert.equal(reference.paymentsAppliedToCollectionFee, 0);
  assert.equal(reference.principalOutstanding, 90_000);
  assert.equal(reference.collectionFeeOutstanding, 10_000);
  assert.equal(reference.currentDebt, 100_000);
  assertMoneyParity(reference, production);
});

test("uzun çok ödemeli fixture kuruş drift, negatif sıfır veya floating sapma üretmez", () => {
  const rates = [
    { type: "Rounding", from: "2025-01-01", to: "2025-05-31", rate: 17.75, active: true },
    { type: "Rounding", from: "2025-06-01", to: "2026-07-30", rate: 23.125, active: true },
    { type: "Rounding", from: "2026-07-31", to: null, rate: 31.005, active: true }
  ];
  const input = {
    principal: 98_765.43,
    preInterest: 123.45,
    costs: 456.78,
    attorneyFee: 2_345.67,
    interestType: "Rounding",
    interestRates: rates,
    interestStart: "2025-01-01",
    accountDate: "2026-09-08",
    paymentEvents: [
      { id: "round-1", date: "2025-02-03", amount: 10_000.009 },
      { id: "round-2", date: "2025-06-15", amount: 15_000.005 },
      { id: "round-3", date: "2026-01-17", amount: 20_000.007 },
      { id: "round-4", date: "2026-07-31", amount: 25_000.009 },
      { id: "round-5", date: "2026-08-19", amount: 30_000.001 }
    ]
  };
  const reference = calculateIndependentReference(input);
  const production = calculateEnforcementAccount(productionValues(input), toolsFor({
    type: "Rounding",
    attorneyFee: 2_345.67,
    rates
  }));

  assert.equal(reference.principalOutstanding, 31_414.44);
  assert.equal(reference.postEnforcementInterest, 533.70);
  assert.equal(reference.currentDebt, 31_948.14);
  assert.equal(Object.is(reference.currentDebt, -0), false);
  assertMoneyParity(reference, production);
});

test("production payment ledger bağımsız audit için gerekli önce/sonra alanlarını taşır", () => {
  const production = calculateEnforcementAccount(productionValues(SINGLE_PAYMENT), toolsFor({ attorneyFee: 2_000 }));
  const entry = production.paymentLedger[0];
  const required = [
    "paymentDate",
    "paymentAmount",
    "principalBeforePayment",
    "interestAccruedBeforePayment",
    "eligibleOutstandingBeforePayment",
    "appliedToInterest",
    "appliedToCosts",
    "appliedToAttorneyFee",
    "appliedToPrincipal",
    "unappliedAmount",
    "principalAfterPayment"
  ];
  for (const field of required) assert.ok(Object.hasOwn(entry, field), `${field} ledger alanı eksik`);
  assert.equal(entry.principalBeforePayment, 100_000);
  assert.equal(entry.eligibleOutstandingBeforePayment, 4_157.53);
});
