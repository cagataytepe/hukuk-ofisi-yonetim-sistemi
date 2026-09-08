export const I1004_ACCOUNT_DATES = ["2026-07-15", "2026-08-04", "2026-09-08"];

export const I1004_SAVED_SNAPSHOT_DEBT = 1_533_711.39;

export const I1004_CALCULATION_TOOLS = {
  interestRates: [
    {
      id: "legal-24",
      type: "Adi Kanuni Faiz",
      from: "2024-06-01",
      to: "2026-06-30",
      rate: 24,
      source: "Merkezi tarife",
      active: true
    },
    {
      id: "legal-31",
      type: "Adi Kanuni Faiz",
      from: "2026-07-01",
      to: "",
      rate: 31,
      source: "Merkezi tarife",
      active: true
    }
  ],
  attorneyFeeTariffs: [
    {
      id: "aaut-2026",
      name: "AAÜT 2026",
      year: 2026,
      scope: "İcra",
      from: "2025-11-04",
      to: "",
      regularMinimum: 9_000,
      evictionMinimum: 20_000,
      maximumAmount: null,
      active: true,
      brackets: [
        { limit: 600_000, rate: 16 },
        { limit: 600_000, rate: 15 },
        { limit: 1_200_000, rate: 14 },
        { limit: 1_200_000, rate: 13 },
        { limit: 1_800_000, rate: 11 },
        { limit: 2_400_000, rate: 8 },
        { limit: 3_000_000, rate: 5 },
        { limit: 3_600_000, rate: 3 },
        { limit: 4_200_000, rate: 2 },
        { limit: null, rate: 1 }
      ]
    }
  ],
  parameters: [
    { key: "interest_day_basis", value: 365, active: true },
    { key: "cheque_compensation_rate", value: 10, active: true },
    { key: "promissory_note_commission_rate", value: 0.3, active: true }
  ]
};

export const I1004_DESKTOP_VALUES = {
  principal: 1_000_000,
  preInterest: 177_500,
  followUpType: "İlamsız Takip",
  interestType: "Kanuni Faiz",
  interestRate: 24,
  interestStart: "2026-04-07",
  feeRate: 9.10,
  expenses: 1_338,
  payments: 0
};

export const I1004_MOBILE_FILE = {
  id: "fixture-i-1004",
  display_id: "İ-1004",
  file_type: "İcra Dosyası",
  follow_type: "İlamsız Takip",
  opening_date: "2026-04-07",
  account_info: {
    principal: 1_000_000,
    preInterest: 177_500,
    interestType: "Kanuni Faiz",
    interestRate: 24,
    interestStart: "2026-04-07",
    feeRate: 9.10,
    expenses: 1_338,
    payments: 0,
    currentDebt: I1004_SAVED_SNAPSHOT_DEBT,
    accountDate: "2026-07-15",
    currency: "TRY"
  }
};

export const I1004_EXPECTED_CENTS = {
  "2026-07-15": {
    principal: 100_000_000,
    postInterest: 6_797_260,
    attorneyFee: 18_262_500,
    collectionFee: 10_715_250,
    expenses: 133_800,
    payments: 0,
    currentDebt: 153_658_810
  },
  "2026-08-04": {
    principal: 100_000_000,
    postInterest: 8_495_890,
    attorneyFee: 18_262_500,
    collectionFee: 10_715_250,
    expenses: 133_800,
    payments: 0,
    currentDebt: 155_357_440
  },
  "2026-09-08": {
    principal: 100_000_000,
    postInterest: 11_468_493,
    attorneyFee: 18_262_500,
    collectionFee: 10_715_250,
    expenses: 133_800,
    payments: 0,
    currentDebt: 158_330_043
  }
};
