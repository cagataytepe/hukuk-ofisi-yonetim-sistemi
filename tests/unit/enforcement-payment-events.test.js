import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEnforcementAccount,
  normalizePayments
} from "../../src/calculations/enforcementCalculator.js";
import {
  calculateDesktopEnforcementAccount,
  calculateMobileEnforcementAccount,
  toMoneyCents
} from "../../src/calculations/enforcementAccountAdapters.js";

const SIMPLE_TOOLS = {
  interestRates: [{
    id: "fixed-36-5",
    type: "Sabit Test Faizi",
    from: "2020-01-01",
    to: null,
    rate: 36.5,
    active: true,
    source: "Bağımsız test tarifesi"
  }],
  attorneyFeeTariffs: [{
    id: "simple-attorney",
    name: "Basit Test Tarifesi",
    scope: "İcra",
    from: "2020-01-01",
    to: null,
    active: true,
    regularMinimum: 2_000,
    evictionMinimum: 2_000,
    maximumAmount: null,
    brackets: [{ limit: null, rate: 1 }]
  }],
  parameters: [{ key: "interest_day_basis", value: 365, from: "2020-01-01", to: null, active: true }]
};

const SIMPLE_VALUES = {
  principal: 100_000,
  preInterest: 1_000,
  followUpType: "İlamsız Takip",
  interestType: "Sabit Test Faizi",
  interestRate: 36.5,
  interestStart: "2026-01-01",
  accountDate: "2026-01-21",
  expenses: 500,
  feeRate: 0,
  fees: 0,
  payments: 0
};

const cents = toMoneyCents;

test("A: ödeme yoksa merkezi hesabın elle doğrulanan sonucu korunur", () => {
  const result = calculateEnforcementAccount(SIMPLE_VALUES, SIMPLE_TOOLS);

  // 100.000 x %36,5 / 365 = günlük tam 100 TL; 20 gün = 2.000 TL.
  const expectedInterest = 100_000 * 0.365 * (20 / 365);
  const expectedDebt = 100_000 + 1_000 + expectedInterest + 500 + 2_000;
  assert.equal(cents(expectedInterest), 200_000);
  assert.equal(cents(result.postInterest), cents(expectedInterest));
  assert.equal(cents(result.currentDebt), cents(expectedDebt));
});

test("B/F: tek kısmi ödeme önce ferileri, sonra ana parayı azaltır", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "p1", date: "2026-01-11", amount: 5_000 }]
  }, SIMPLE_TOOLS);

  // İlk 10 gün faizi 1.000; ödeme günündeki feriler 1.000 + 1.000 + 500 + 2.000 = 4.500.
  // Ana para 500 azalır. Son 10 gün faizi 99.500 x %36,5 x 10 / 365 = 995.
  assert.equal(cents(result.paymentsAppliedToFeriler), 450_000);
  assert.equal(cents(result.paymentsAppliedToPrincipal), 50_000);
  assert.equal(cents(result.principalOutstanding), 9_950_000);
  assert.equal(cents(result.postInterest), 99_500);
  assert.equal(cents(result.currentDebt), 10_049_500);
  assert.deepEqual(result.interestPeriods.map(period => [period.from, period.to, period.days]), [
    ["2026-01-02", "2026-01-11", 10],
    ["2026-01-12", "2026-01-21", 10]
  ]);
});

test("C: iki farklı tarihli ödeme kalan ana para üzerinden sırayla uygulanır", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [
      { id: "p2", date: "2026-01-11", amount: 10_000 },
      { id: "p1", date: "2026-01-06", amount: 5_000 }
    ]
  }, SIMPLE_TOOLS);

  // 5 gün: 500 faiz; ilk ödeme 4.000 feri + 1.000 ana para.
  // Sonraki 5 gün: 99.000 üzerinden 495 faiz; ikinci ödeme 495 feri + 9.505 ana para.
  // Son 10 gün: 89.495 üzerinden 894,95 faiz.
  assert.equal(cents(result.paymentsAppliedToFeriler), 449_500);
  assert.equal(cents(result.paymentsAppliedToPrincipal), 1_050_500);
  assert.equal(cents(result.principalOutstanding), 8_949_500);
  assert.equal(cents(result.postInterest), 89_495);
  assert.equal(cents(result.currentDebt), 9_038_995);
  assert.deepEqual(result.paymentLedger.map(entry => entry.paymentDate), ["2026-01-06", "2026-01-11"]);
});

test("D: faiz oranı sınırındaki ödeme her günü yalnız kendi tarifesiyle hesaplar", () => {
  const tools = {
    interestRates: [
      { id: "r24", type: "Adi Kanuni Faiz", from: "2024-06-01", to: "2026-07-30", rate: 24, active: true },
      { id: "r31", type: "Adi Kanuni Faiz", from: "2026-07-31", to: null, rate: 31, active: true }
    ],
    attorneyFeeTariffs: [],
    parameters: []
  };
  const result = calculateEnforcementAccount({
    principal: 100_000,
    interestType: "Adi Kanuni Faiz",
    interestStart: "2026-07-29",
    accountDate: "2026-08-01",
    paymentEvents: [{ id: "boundary", date: "2026-07-31", amount: 1_000 }]
  }, tools);

  // 30 Temmuz: 65,75; 31 Temmuz: 84,93. Ödeme 150,68 faizi ve 849,32 ana parayı kapatır.
  // 1 Ağustos: kalan 99.150,68 üzerinden 84,21 faiz.
  assert.equal(cents(result.postEnforcementInterestAccrued), 23_489);
  assert.equal(cents(result.paymentsAppliedToFeriler), 15_068);
  assert.equal(cents(result.paymentsAppliedToPrincipal), 84_932);
  assert.equal(cents(result.principalOutstanding), 9_915_068);
  assert.equal(cents(result.postInterest), 8_421);
  assert.equal(cents(result.currentDebt), 9_923_489);
  assert.deepEqual(result.interestPeriods.map(period => [period.from, period.to, period.rate]), [
    ["2026-07-30", "2026-07-30", 24],
    ["2026-07-31", "2026-07-31", 31],
    ["2026-08-01", "2026-08-01", 31]
  ]);
});

test("E: ödeme ferileri karşılamıyorsa ana para azalmaz", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "small", date: "2026-01-11", amount: 1_000 }]
  }, SIMPLE_TOOLS);

  assert.equal(cents(result.paymentsAppliedToFeriler), 100_000);
  assert.equal(cents(result.paymentsAppliedToPrincipal), 0);
  assert.equal(cents(result.principalOutstanding), 10_000_000);
  assert.equal(cents(result.currentDebt), 10_450_000);
});

test("G: borcu ödeme tarihinde tamamen kapatan ödeme sonrasında faiz işlemez", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "full", date: "2026-01-11", amount: 104_500 }]
  }, SIMPLE_TOOLS);

  assert.equal(cents(result.principalOutstanding), 0);
  assert.equal(cents(result.currentDebt), 0);
  assert.equal(cents(result.unappliedExcessPayment), 0);
  assert.equal(result.interestPeriods.at(-1)?.to, "2026-01-11");
});

test("H: borcu aşan ödeme negatif bakiye üretmez", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "excess", date: "2026-01-11", amount: 105_000 }]
  }, SIMPLE_TOOLS);

  assert.equal(cents(result.currentDebt), 0);
  assert.equal(cents(result.unappliedExcessPayment), 50_000);
});

test("I: aynı gün talimatsız ödemeler tek ve deterministik olaya dönüşür", () => {
  const events = [
    { id: "z", date: "2026-01-11", amount: 2_500 },
    { id: "a", collection_date: "2026-01-11", amount: 2_500 }
  ];
  const normalized = normalizePayments(events);
  const grouped = calculateEnforcementAccount({ ...SIMPLE_VALUES, paymentEvents: events }, SIMPLE_TOOLS);
  const single = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "single", date: "2026-01-11", amount: 5_000 }]
  }, SIMPLE_TOOLS);

  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0].sourceIds, ["a", "z"]);
  assert.equal(cents(grouped.currentDebt), cents(single.currentDebt));
  assert.equal(cents(grouped.principalOutstanding), cents(single.principalOutstanding));
});

test("J: hesap tarihinden sonraki ödeme canlı bakiyeyi düşürmez", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [{ id: "future", date: "2026-01-22", amount: 50_000 }]
  }, SIMPLE_TOOLS);

  assert.equal(cents(result.totalPayments), 0);
  assert.equal(cents(result.appliedPayments), 0);
  assert.equal(cents(result.currentDebt), 10_550_000);
  assert.deepEqual(result.ignoredFuturePayments.map(payment => payment.id), ["future"]);
});

test("K: canlı ödeme olayları legacy snapshot bakiyesini ezer", () => {
  const file = {
    file_type: "İcra Dosyası",
    follow_type: SIMPLE_VALUES.followUpType,
    opening_date: SIMPLE_VALUES.interestStart,
    account_info: {
      principal: SIMPLE_VALUES.principal,
      preInterest: SIMPLE_VALUES.preInterest,
      interestType: SIMPLE_VALUES.interestType,
      interestRate: SIMPLE_VALUES.interestRate,
      expenses: SIMPLE_VALUES.expenses,
      currentDebt: 1
    },
    payment_events: [{ id: "live", date: "2026-01-11", amount: 5_000 }]
  };
  const desktop = calculateDesktopEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: file.payment_events
  }, SIMPLE_TOOLS, SIMPLE_VALUES.accountDate);
  const mobile = calculateMobileEnforcementAccount(file, SIMPLE_TOOLS, SIMPLE_VALUES.accountDate);

  assert.notEqual(cents(mobile.currentDebt), 100);
  assert.equal(cents(mobile.currentDebt), cents(desktop.currentDebt));
});

test("tahsil harcı TBK 100 feri sepetine alınmaz", () => {
  const result = calculateEnforcementAccount({
    principal: 100_000,
    followUpType: "İlamsız Takip",
    interestStart: "2026-01-01",
    accountDate: "2026-01-01",
    feeRate: 10,
    paymentEvents: [{ id: "fee-separation", date: "2026-01-01", amount: 10_000 }]
  }, { interestRates: [], attorneyFeeTariffs: [], parameters: [] });

  assert.equal(cents(result.paymentsAppliedToCollectionFee), 0);
  assert.equal(cents(result.paymentsAppliedToPrincipal), 1_000_000);
  assert.equal(cents(result.collectionFeeOutstanding), 1_000_000);
  assert.equal(cents(result.currentDebt), 10_000_000);
});

test("takip tarihinden önceki ve soft-delete edilmiş ödeme tekrar mahsup edilmez", () => {
  const result = calculateEnforcementAccount({
    ...SIMPLE_VALUES,
    paymentEvents: [
      { id: "before", date: "2025-12-31", amount: 5_000 },
      { id: "deleted", date: "2026-01-11", amount: 5_000, deleted_at: "2026-01-12T00:00:00Z" }
    ]
  }, SIMPLE_TOOLS);

  assert.equal(cents(result.totalPayments), 500_000);
  assert.equal(cents(result.appliedPayments), 0);
  assert.deepEqual(result.ignoredPreEnforcementPayments.map(payment => payment.id), ["before"]);
  assert.equal(cents(result.currentDebt), 10_550_000);
});
