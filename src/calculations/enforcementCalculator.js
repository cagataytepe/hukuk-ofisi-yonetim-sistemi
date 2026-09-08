const DAY_MS = 86400000;

function numeric(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function moneyCents(value) {
  return Math.max(0, Math.round(numeric(value) * 100));
}

function moneyFromCents(value) {
  return Math.max(0, Math.round(Number(value) || 0)) / 100;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstStoredValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "") ?? "";
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "evet"].includes(String(value || "").trim().toLocaleLowerCase("tr-TR"));
}

function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function paymentDesignation(payment = {}, metadata = {}) {
  return firstStoredValue(
    payment.designation,
    payment.debtId,
    payment.debt_id,
    payment.allocationInstruction,
    payment.allocation_instruction,
    metadata.designation,
    metadata.debtId,
    metadata.debt_id,
    metadata.allocationInstruction,
    metadata.allocation_instruction
  );
}

export function normalizePayments(paymentEvents = []) {
  const normalized = (Array.isArray(paymentEvents) ? paymentEvents : [])
    .map((payment, index) => {
      const metadata = objectValue(payment?.metadata);
      const date = dateOnly(firstStoredValue(
        payment?.date,
        payment?.paymentDate,
        payment?.payment_date,
        payment?.collection_date,
        payment?.paidDate,
        payment?.paid_date
      ));
      const amountCents = moneyCents(payment?.amount);
      const id = String(firstStoredValue(payment?.id, payment?.repositoryId, payment?.legacy_id, `payment-${index}`));
      return {
        id,
        date,
        amount: moneyFromCents(amountCents),
        amountCents,
        type: firstStoredValue(payment?.type, payment?.paymentKind, payment?.payment_kind),
        source: firstStoredValue(payment?.source, metadata.source),
        description: firstStoredValue(payment?.description, metadata.description),
        designation: String(paymentDesignation(payment, metadata) || ""),
        metadata,
        sourceIds: [id],
        deleted: Boolean(payment?.deleted_at || payment?.deletedAt),
        cancelled: payment?.cancelled === true || payment?.voided === true
      };
    })
    .filter(payment => payment.date && Number.isFinite(dateSerial(payment.date)))
    .filter(payment => payment.amountCents > 0)
    .filter(payment => !payment.deleted && !payment.cancelled);

  const grouped = new Map();
  const designated = [];
  normalized.forEach(payment => {
    if (payment.designation) {
      designated.push(payment);
      return;
    }
    const existing = grouped.get(payment.date);
    if (!existing) {
      grouped.set(payment.date, { ...payment });
      return;
    }
    existing.amountCents += payment.amountCents;
    existing.amount = moneyFromCents(existing.amountCents);
    existing.sourceIds.push(...payment.sourceIds);
    existing.id = `same-day:${payment.date}:${existing.sourceIds.slice().sort().join("+")}`;
    existing.type = existing.type || payment.type;
    existing.source = existing.source || payment.source;
    existing.description = existing.description || payment.description;
    existing.metadata = { groupedSameDay: true };
  });

  return [...grouped.values(), ...designated]
    .map(({ deleted, cancelled, ...payment }) => ({
      ...payment,
      sourceIds: payment.sourceIds.slice().sort()
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

export function normalizeInterestType(value) {
  if (value === "Kanuni Faiz") return "Adi Kanuni Faiz";
  if (value === "Avans Faizi") return "Reeskont Avans";
  return value || "";
}

function dateSerial(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return NaN;
  return Date.parse(`${value}T00:00:00Z`);
}

export function addIsoDays(value, count) {
  const serial = dateSerial(value);
  if (!Number.isFinite(serial)) return "";
  return new Date(serial + (Number(count) || 0) * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetweenIso(start, end) {
  const startSerial = dateSerial(start);
  const endSerial = dateSerial(end);
  if (!Number.isFinite(startSerial) || !Number.isFinite(endSerial) || endSerial <= startSerial) return 0;
  return Math.round((endSerial - startSerial) / DAY_MS);
}

export function effectivePeriod(periods = [], dateValue) {
  return [...periods]
    .filter(period => period.active !== false)
    .filter(period => period.from <= dateValue && (!period.to || dateValue <= period.to))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)))[0] || null;
}

export function calculatePeriodInterest({
  principal,
  type,
  fallbackRate,
  start,
  end,
  interestRates = [],
  dayBasis = 365
} = {}) {
  const base = numeric(principal);
  const defaultRate = numeric(fallbackRate);
  const denominator = Math.max(1, numeric(dayBasis) || 365);
  if (base <= 0 || !type || !start || !end || end <= start) return { amount: 0, periods: [], dayBasis: denominator };

  const configured = interestRates
    .filter(period => period.type === type && period.active !== false)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const chargeStart = addIsoDays(start, 1);
  if (!chargeStart || chargeStart > end) return { amount: 0, periods: [], dayBasis: denominator };

  const boundaries = configured
    .map(period => period.from)
    .filter(date => date > chargeStart && date <= end);
  const starts = [...new Set([chargeStart, ...boundaries])].sort();
  const periods = starts.map((periodStart, index) => {
    const nextStart = starts[index + 1];
    const periodEnd = nextStart ? addIsoDays(nextStart, -1) : end;
    const tariff = effectivePeriod(configured, periodStart);
    const annualRate = tariff ? numeric(tariff.rate) : defaultRate;
    const days = daysBetweenIso(periodStart, addIsoDays(periodEnd, 1));
    const interest = base * (annualRate / 100) * (days / denominator);
    return {
      from: periodStart,
      to: periodEnd,
      days,
      rate: annualRate,
      principal: base,
      interest,
      tariffId: tariff?.id || null,
      source: tariff?.source || (tariff ? "Merkezi tarife" : "Dosya oranı"),
      usedFallback: !tariff
    };
  });

  return {
    amount: periods.reduce((sum, period) => sum + period.interest, 0),
    periods,
    dayBasis: denominator
  };
}

export function currentAttorneyTariff(tariffs = [], dateValue) {
  return [...tariffs]
    .filter(tariff => tariff.active !== false)
    .filter(tariff => tariff.from <= dateValue && (!tariff.to || dateValue <= tariff.to))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)))[0] || null;
}

export function calculateAttorneyFee({ baseAmount, upperLimit, followUpType, accountDate, tariffs = [] } = {}) {
  const base = numeric(baseAmount);
  const cap = Math.max(0, numeric(upperLimit));
  const tariff = currentAttorneyTariff(tariffs, accountDate);
  if (!tariff || base <= 0) return { amount: 0, tariff, relativeAmount: 0, minimum: 0, bracketDetails: [] };

  let remaining = base;
  const bracketDetails = [];
  for (const bracket of tariff.brackets || []) {
    if (remaining <= 0) break;
    const bracketAmount = bracket.limit === null ? remaining : Math.min(remaining, numeric(bracket.limit));
    const rate = numeric(bracket.rate);
    const fee = bracketAmount * (rate / 100);
    bracketDetails.push({ amount: bracketAmount, rate, fee, limit: bracket.limit });
    remaining -= bracketAmount;
  }
  const relativeAmount = bracketDetails.reduce((sum, bracket) => sum + bracket.fee, 0);
  const minimum = /Tahliye/i.test(String(followUpType || ""))
    ? numeric(tariff.evictionMinimum)
    : numeric(tariff.regularMinimum);
  const tariffMaximum = tariff.maximumAmount === null || tariff.maximumAmount === undefined
    ? cap
    : Math.min(cap, numeric(tariff.maximumAmount));
  const amount = Math.min(tariffMaximum, Math.max(relativeAmount, minimum));
  return { amount, tariff, relativeAmount, minimum, bracketDetails };
}

function applyAmountToBucket(state, bucket, availableCents) {
  const applied = Math.min(state[bucket], availableCents);
  state[bucket] -= applied;
  return applied;
}

export function applyPaymentEvent(state, payment, { interestBeforePaymentCents = 0 } = {}) {
  let remaining = payment.amountCents;
  const appliedToPreEnforcementInterest = applyAmountToBucket(state, "preEnforcementInterestOutstandingCents", remaining);
  remaining -= appliedToPreEnforcementInterest;
  const appliedToPostEnforcementInterest = applyAmountToBucket(state, "postEnforcementInterestOutstandingCents", remaining);
  remaining -= appliedToPostEnforcementInterest;
  const appliedToCosts = applyAmountToBucket(state, "eligibleCostsOutstandingCents", remaining);
  remaining -= appliedToCosts;
  const appliedToAttorneyFee = applyAmountToBucket(state, "enforcementAttorneyFeeOutstandingCents", remaining);
  remaining -= appliedToAttorneyFee;
  const appliedToPrincipal = applyAmountToBucket(state, "principalOutstandingCents", remaining);
  remaining -= appliedToPrincipal;
  const appliedToOtherCharges = applyAmountToBucket(state, "otherChargesOutstandingCents", remaining);
  remaining -= appliedToOtherCharges;
  const appliedToCollectionFee = applyAmountToBucket(state, "collectionFeeOutstandingCents", remaining);
  remaining -= appliedToCollectionFee;
  const appliedToFeriler = appliedToPreEnforcementInterest
    + appliedToPostEnforcementInterest
    + appliedToCosts
    + appliedToAttorneyFee;

  state.paymentsAppliedToFerilerCents += appliedToFeriler;
  state.paymentsAppliedToPrincipalCents += appliedToPrincipal;
  state.paymentsAppliedToOtherChargesCents += appliedToOtherCharges;
  state.paymentsAppliedToCollectionFeeCents += appliedToCollectionFee;
  state.unappliedExcessPaymentCents += remaining;

  return {
    paymentId: payment.id,
    sourceIds: payment.sourceIds,
    paymentDate: payment.date,
    paymentAmount: moneyFromCents(payment.amountCents),
    interestBeforePayment: moneyFromCents(interestBeforePaymentCents),
    appliedToPreEnforcementInterest: moneyFromCents(appliedToPreEnforcementInterest),
    appliedToPostEnforcementInterest: moneyFromCents(appliedToPostEnforcementInterest),
    appliedToInterest: moneyFromCents(appliedToPreEnforcementInterest + appliedToPostEnforcementInterest),
    appliedToCosts: moneyFromCents(appliedToCosts),
    appliedToAttorneyFee: moneyFromCents(appliedToAttorneyFee),
    appliedToFeriler: moneyFromCents(appliedToFeriler),
    appliedToPrincipal: moneyFromCents(appliedToPrincipal),
    appliedToOtherCharges: moneyFromCents(appliedToOtherCharges),
    appliedToCollectionFee: moneyFromCents(appliedToCollectionFee),
    unappliedExcessPayment: moneyFromCents(remaining),
    principalAfterPayment: moneyFromCents(state.principalOutstandingCents)
  };
}

function parameterValue(parameters, key, fallback, accountDate) {
  const candidates = (parameters || [])
    .filter(parameter => parameter.key === key && parameter.active !== false)
    .filter(parameter => !parameter.from || parameter.from <= accountDate)
    .filter(parameter => !parameter.to || accountDate <= parameter.to)
    .sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")));
  return candidates[0]?.value ?? fallback;
}

export function calculateEnforcementAccount(values = {}, tools = {}) {
  const principal = numeric(values.principal);
  const preInterest = numeric(values.preInterest);
  const expenses = numeric(values.expenses);
  const accountDate = values.accountDate || "";
  const parameters = tools.parameters || [];
  const isNegotiable = String(values.followUpType || "").toLocaleLowerCase("tr-TR").includes("kambiyo");
  const chequeRate = parameterValue(parameters, "cheque_compensation_rate", 10, accountDate);
  const noteRate = parameterValue(parameters, "promissory_note_commission_rate", 0.3, accountDate);
  const dayBasis = parameterValue(parameters, "interest_day_basis", 365, accountDate);
  let instrumentCharge = 0;
  let instrumentChargeRate = 0;
  let instrumentChargeLabel = "";
  if (values.includeInstrumentCharge && isNegotiable && principal > 0) {
    if (values.negotiableInstrumentType === "Çek") {
      instrumentChargeRate = chequeRate;
      instrumentChargeLabel = "Çek Tazminatı";
    } else if (values.negotiableInstrumentType === "Bono") {
      instrumentChargeRate = noteRate;
      instrumentChargeLabel = "Bono Komisyonu";
    }
    instrumentCharge = principal * (numeric(instrumentChargeRate) / 100);
  }
  const instrumentChargeIncludedInFinalized = instrumentChargeLabel === "Çek Tazminatı" && instrumentCharge > 0;
  const finalizedAmount = principal + preInterest + (instrumentChargeIncludedInFinalized ? instrumentCharge : 0);
  const attorney = calculateAttorneyFee({
    baseAmount: finalizedAmount,
    upperLimit: principal,
    followUpType: values.followUpType,
    accountDate,
    tariffs: tools.attorneyFeeTariffs || []
  });
  const feeRate = numeric(values.feeRate);
  const fees = feeRate > 0 ? finalizedAmount * (feeRate / 100) : numeric(values.fees);
  const interest = { amount: 0, periods: [], dayBasis };
  const state = {
    principalOutstandingCents: moneyCents(principal),
    preEnforcementInterestOutstandingCents: moneyCents(preInterest),
    postEnforcementInterestOutstandingCents: 0,
    postEnforcementInterestAccruedCents: 0,
    enforcementAttorneyFeeOutstandingCents: moneyCents(attorney.amount),
    eligibleCostsOutstandingCents: moneyCents(expenses),
    otherChargesOutstandingCents: moneyCents(instrumentCharge),
    collectionFeeOutstandingCents: moneyCents(fees),
    paymentsAppliedToFerilerCents: 0,
    paymentsAppliedToPrincipalCents: 0,
    paymentsAppliedToOtherChargesCents: 0,
    paymentsAppliedToCollectionFeeCents: 0,
    unappliedExcessPaymentCents: 0
  };
  const normalizedPayments = normalizePayments(values.paymentEvents || values.payment_events || []);
  const enforcementStart = dateOnly(values.interestStart);
  const calculationDate = dateOnly(accountDate);
  const futurePayments = normalizedPayments.filter(payment => calculationDate && payment.date > calculationDate);
  const preEnforcementPayments = normalizedPayments.filter(payment => enforcementStart && payment.date < enforcementStart);
  const applicablePayments = normalizedPayments.filter(payment => {
    if (calculationDate && payment.date > calculationDate) return false;
    if (enforcementStart && payment.date < enforcementStart) return false;
    return true;
  });
  const paymentLedger = [];
  const interestPeriods = [];
  let lastInterestBoundary = enforcementStart;

  const accrueInterestThrough = endDate => {
    if (!lastInterestBoundary || !endDate || endDate <= lastInterestBoundary || state.principalOutstandingCents <= 0) {
      lastInterestBoundary = endDate || lastInterestBoundary;
      return 0;
    }
    const accrued = calculatePeriodInterest({
      principal: moneyFromCents(state.principalOutstandingCents),
      type: normalizeInterestType(values.interestType),
      fallbackRate: values.interestRate,
      start: lastInterestBoundary,
      end: endDate,
      interestRates: tools.interestRates || [],
      dayBasis
    });
    const accruedCents = moneyCents(accrued.amount);
    state.postEnforcementInterestOutstandingCents += accruedCents;
    state.postEnforcementInterestAccruedCents += accruedCents;
    interestPeriods.push(...accrued.periods);
    lastInterestBoundary = endDate;
    return accruedCents;
  };

  applicablePayments.forEach(payment => {
    const interestBeforePaymentCents = accrueInterestThrough(payment.date);
    paymentLedger.push(applyPaymentEvent(state, payment, { interestBeforePaymentCents }));
  });
  accrueInterestThrough(calculationDate);

  const totalPaymentsCents = normalizedPayments
    .filter(payment => !calculationDate || payment.date <= calculationDate)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const appliedPaymentsCents = applicablePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const currentDebtCents = state.principalOutstandingCents
    + state.preEnforcementInterestOutstandingCents
    + state.postEnforcementInterestOutstandingCents
    + state.enforcementAttorneyFeeOutstandingCents
    + state.eligibleCostsOutstandingCents
    + state.otherChargesOutstandingCents
    + state.collectionFeeOutstandingCents;
  interest.amount = moneyFromCents(state.postEnforcementInterestOutstandingCents);
  interest.periods = interestPeriods;
  interest.dayBasis = dayBasis;
  const payments = moneyFromCents(totalPaymentsCents);
  const currentDebt = moneyFromCents(currentDebtCents);
  return {
    principalOriginal: moneyFromCents(moneyCents(principal)),
    principal,
    preInterest,
    finalizedAmount,
    postInterest: interest.amount,
    preEnforcementInterest: moneyFromCents(state.preEnforcementInterestOutstandingCents),
    preEnforcementInterestOutstanding: moneyFromCents(state.preEnforcementInterestOutstandingCents),
    postEnforcementInterest: moneyFromCents(state.postEnforcementInterestOutstandingCents),
    postEnforcementInterestOutstanding: moneyFromCents(state.postEnforcementInterestOutstandingCents),
    postEnforcementInterestAccrued: moneyFromCents(state.postEnforcementInterestAccruedCents),
    principalOutstanding: moneyFromCents(state.principalOutstandingCents),
    interestPeriods: interest.periods,
    dayBasis: interest.dayBasis,
    feeRate,
    fees,
    collectionFee: fees,
    expenses,
    eligibleCosts: moneyFromCents(state.eligibleCostsOutstandingCents),
    eligibleCostsOutstanding: moneyFromCents(state.eligibleCostsOutstandingCents),
    eligibleEnforcementCostsOutstanding: moneyFromCents(state.eligibleCostsOutstandingCents),
    payments,
    totalPayments: payments,
    appliedPayments: moneyFromCents(appliedPaymentsCents),
    legacyPaymentTotal: numeric(values.payments),
    paymentsAppliedToFeriler: moneyFromCents(state.paymentsAppliedToFerilerCents),
    paymentsAppliedToPrincipal: moneyFromCents(state.paymentsAppliedToPrincipalCents),
    paymentsAppliedToOtherCharges: moneyFromCents(state.paymentsAppliedToOtherChargesCents),
    paymentsAppliedToCollectionFee: moneyFromCents(state.paymentsAppliedToCollectionFeeCents),
    unappliedExcessPayment: moneyFromCents(state.unappliedExcessPaymentCents),
    normalizedPayments,
    ignoredFuturePayments: futurePayments,
    ignoredPreEnforcementPayments: preEnforcementPayments,
    paymentLedger,
    attorneyFee: attorney.amount,
    enforcementAttorneyFeeOutstanding: moneyFromCents(state.enforcementAttorneyFeeOutstandingCents),
    attorneyFeeTariff: attorney.tariff,
    attorneyFeeDetails: attorney,
    instrumentCharge,
    instrumentChargeRate,
    instrumentChargeLabel,
    instrumentChargeIncludedInFinalized,
    otherChargesOutstanding: moneyFromCents(state.otherChargesOutstandingCents),
    collectionFeeOutstanding: moneyFromCents(state.collectionFeeOutstandingCents),
    currentDebt
  };
}

export function enforcementAccountValuesFromFile(file = {}, accountDate = "") {
  const account = objectValue(file.account_info || file.accountInfo);
  const metadata = objectValue(file.metadata);
  const legacy = objectValue(metadata.legacyFlatFields);
  const instrument = objectValue(file.instrument_info || file.instrumentInfo);
  const interestType = firstStoredValue(account.interestType, account.interest_type, file.interestType, metadata.interestType);
  const paymentEventSources = [
    file.paymentEvents,
    file.payment_events,
    file.collections,
    account.paymentEvents,
    account.payment_events,
    metadata.paymentEvents,
    metadata.payment_events
  ];
  const paymentEvents = paymentEventSources.find(Array.isArray) || [];

  return {
    principal: firstStoredValue(account.principal, file.principal, metadata.principal),
    preInterest: firstStoredValue(account.preInterest, account.pre_interest, file.preInterest, metadata.preInterest),
    followUpType: firstStoredValue(file.follow_type, file.followType, file.followUpType, legacy.followUpType, metadata.followType),
    negotiableInstrumentType: firstStoredValue(instrument.type, file.negotiableInstrumentType, legacy.negotiableInstrumentType, metadata.negotiableInstrumentType),
    includeInstrumentCharge: booleanValue(firstStoredValue(metadata.includeInstrumentCharge, legacy.includeInstrumentCharge, file.includeInstrumentCharge)),
    interestType: normalizeInterestType(interestType),
    interestRate: firstStoredValue(account.interestRate, account.interest_rate, file.interestRate, metadata.interestRate),
    interestStart: firstStoredValue(account.interestStart, account.interest_start, file.interestStart, file.followUpDate, file.opening_date, file.openingDate, metadata.interestStart),
    accountDate,
    feeRate: firstStoredValue(account.feeRate, account.fee_rate, file.feeRate, metadata.feeRate),
    fees: firstStoredValue(account.fees, file.fees, metadata.fees),
    expenses: firstStoredValue(account.expenses, file.expenses, metadata.expenses),
    payments: firstStoredValue(account.payments, file.payments, metadata.payments),
    paymentEvents,
    paymentEventsProvided: paymentEventSources.some(Array.isArray)
  };
}

export function hasEnforcementAccountData(file = {}) {
  const values = enforcementAccountValuesFromFile(file);
  return [values.principal, values.preInterest, values.interestType, values.feeRate, values.expenses, values.payments]
    .some(value => String(value ?? "").trim() !== "");
}

export function calculateEnforcementFileAccount(file = {}, tools = {}, accountDate = "") {
  return calculateEnforcementAccount(enforcementAccountValuesFromFile(file, accountDate), tools);
}
