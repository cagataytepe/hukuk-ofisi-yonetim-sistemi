const DAY_MS = 86_400_000;
const RATE_SCALE = 1_000_000;

function decimalInteger(value, fractionDigits) {
  const text = String(value ?? "0").trim().replace(",", ".");
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return 0n;
  const negative = match[1] === "-";
  const whole = match[2];
  const fraction = (match[3] || "").padEnd(fractionDigits + 1, "0");
  const kept = fraction.slice(0, fractionDigits) || "0";
  let result = BigInt(whole) * (10n ** BigInt(fractionDigits)) + BigInt(kept);
  if (Number(fraction[fractionDigits] || 0) >= 5) result += 1n;
  return negative ? -result : result;
}

function cents(value) {
  const result = decimalInteger(value, 2);
  return result > 0n ? result : 0n;
}

function amount(value) {
  return Number(value) / 100;
}

function dateSerial(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoDate(serial) {
  return new Date(serial).toISOString().slice(0, 10);
}

function nextDate(value) {
  const serial = dateSerial(value);
  return Number.isFinite(serial) ? isoDate(serial + DAY_MS) : "";
}

function activeRate(rates, date, fallbackRate, interestType) {
  const match = [...rates]
    .filter(rate => rate.active !== false)
    .filter(rate => !rate.type || !interestType || rate.type === interestType)
    .filter(rate => rate.from <= date && (!rate.to || date <= rate.to))
    .sort((left, right) => String(right.from).localeCompare(String(left.from)))[0];
  return match ? Number(match.rate) : Number(fallbackRate || 0);
}

function roundRatio(numerator, denominator) {
  if (numerator <= 0n || denominator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

function accrueInterest(principalCents, startExclusive, endInclusive, rates, fallbackRate, dayBasis, interestType) {
  if (principalCents <= 0n || !startExclusive || !endInclusive || endInclusive <= startExclusive) {
    return { cents: 0n, periods: [] };
  }
  const denominator = BigInt(RATE_SCALE) * 100n * BigInt(dayBasis || 365);
  let cursor = nextDate(startExclusive);
  let numerator = 0n;
  const periods = [];
  while (cursor && cursor <= endInclusive) {
    const rate = activeRate(rates, cursor, fallbackRate, interestType);
    const rateInteger = decimalInteger(rate, 6);
    numerator += principalCents * rateInteger;
    const previous = periods.at(-1);
    if (previous && previous.rate === rate && nextDate(previous.to) === cursor) {
      previous.to = cursor;
      previous.days += 1;
      previous.numerator += principalCents * rateInteger;
    } else {
      periods.push({
        from: cursor,
        to: cursor,
        days: 1,
        rate,
        principal: amount(principalCents),
        numerator: principalCents * rateInteger
      });
    }
    cursor = nextDate(cursor);
  }
  return {
    cents: roundRatio(numerator, denominator),
    periods: periods.map(period => ({
      from: period.from,
      to: period.to,
      days: period.days,
      rate: period.rate,
      principal: period.principal,
      interest: Number(period.numerator) / Number(denominator) / 100
    }))
  };
}

function paymentDate(payment = {}) {
  return String(
    payment.date
      || payment.paymentDate
      || payment.payment_date
      || payment.collection_date
      || payment.paidDate
      || payment.paid_date
      || ""
  ).slice(0, 10);
}

function designation(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  return String(
    payment.designation
      || payment.debtId
      || payment.debt_id
      || payment.allocationInstruction
      || payment.allocation_instruction
      || metadata.designation
      || metadata.debtId
      || metadata.debt_id
      || metadata.allocationInstruction
      || metadata.allocation_instruction
      || ""
  );
}

export function normalizeReferencePayments(paymentEvents = []) {
  const rows = (Array.isArray(paymentEvents) ? paymentEvents : [])
    .map((payment, index) => ({
      id: String(payment.id || payment.repositoryId || payment.legacy_id || `reference-${index}`),
      date: paymentDate(payment),
      amountCents: cents(payment.amount),
      designation: designation(payment),
      sourceIds: [String(payment.id || payment.repositoryId || payment.legacy_id || `reference-${index}`)],
      deleted: Boolean(payment.deleted_at || payment.deletedAt),
      cancelled: payment.cancelled === true || payment.voided === true
    }))
    .filter(payment => Number.isFinite(dateSerial(payment.date)))
    .filter(payment => payment.amountCents > 0n)
    .filter(payment => !payment.deleted && !payment.cancelled);

  const grouped = new Map();
  const designated = [];
  const seenPaymentIds = new Set();
  for (const payment of rows) {
    if (seenPaymentIds.has(payment.id)) continue;
    seenPaymentIds.add(payment.id);
    if (payment.designation) {
      designated.push(payment);
      continue;
    }
    const current = grouped.get(payment.date);
    if (!current) {
      grouped.set(payment.date, { ...payment });
      continue;
    }
    current.amountCents += payment.amountCents;
    current.sourceIds.push(...payment.sourceIds);
    current.sourceIds.sort();
    current.id = `same-day:${payment.date}:${current.sourceIds.join("+")}`;
  }
  return [...grouped.values(), ...designated]
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

function applyPayment(state, payment, interestAccruedBeforePayment) {
  const principalBeforePayment = state.principal;
  const eligibleOutstandingBeforePayment = state.preInterest + state.postInterest + state.costs + state.attorneyFee;
  let remaining = payment.amountCents;
  const take = bucket => {
    const applied = state[bucket] < remaining ? state[bucket] : remaining;
    state[bucket] -= applied;
    remaining -= applied;
    return applied;
  };
  const appliedToPreInterest = take("preInterest");
  const appliedToPostInterest = take("postInterest");
  const appliedToCosts = take("costs");
  const appliedToAttorneyFee = take("attorneyFee");
  const appliedToPrincipal = take("principal");
  const appliedToOtherCharges = take("otherCharges");
  const appliedToCollectionFee = take("collectionFee");
  const appliedToInterest = appliedToPreInterest + appliedToPostInterest;
  const appliedToFeriler = appliedToInterest + appliedToCosts + appliedToAttorneyFee;
  state.appliedToFeriler += appliedToFeriler;
  state.appliedToPrincipal += appliedToPrincipal;
  state.appliedToOtherCharges += appliedToOtherCharges;
  state.appliedToCollectionFee += appliedToCollectionFee;
  state.unapplied += remaining;
  return {
    paymentDate: payment.date,
    paymentAmount: amount(payment.amountCents),
    principalBeforePayment: amount(principalBeforePayment),
    interestAccruedBeforePayment: amount(interestAccruedBeforePayment),
    eligibleOutstandingBeforePayment: amount(eligibleOutstandingBeforePayment),
    appliedToInterest: amount(appliedToInterest),
    appliedToCosts: amount(appliedToCosts),
    appliedToAttorneyFee: amount(appliedToAttorneyFee),
    appliedToFeriler: amount(appliedToFeriler),
    appliedToPrincipal: amount(appliedToPrincipal),
    appliedToOtherCharges: amount(appliedToOtherCharges),
    appliedToCollectionFee: amount(appliedToCollectionFee),
    unappliedAmount: amount(remaining),
    principalAfterPayment: amount(state.principal)
  };
}

export function calculateIndependentReference(input = {}) {
  const accountDate = String(input.accountDate || "").slice(0, 10);
  const interestStart = String(input.interestStart || "").slice(0, 10);
  const interestRates = (input.interestRates || [])
    .filter(rate => !input.interestType || rate.type === input.interestType);
  const state = {
    principal: cents(input.principal),
    preInterest: cents(input.preInterest),
    postInterest: 0n,
    postInterestAccrued: 0n,
    costs: cents(input.costs),
    attorneyFee: cents(input.attorneyFee),
    otherCharges: cents(input.otherCharges),
    collectionFee: cents(input.collectionFee),
    appliedToFeriler: 0n,
    appliedToPrincipal: 0n,
    appliedToOtherCharges: 0n,
    appliedToCollectionFee: 0n,
    unapplied: 0n
  };
  const normalized = normalizeReferencePayments(input.paymentEvents);
  const applicable = normalized.filter(payment => payment.date >= interestStart && payment.date <= accountDate);
  const ignoredFuture = normalized.filter(payment => payment.date > accountDate);
  const ignoredPreEnforcement = normalized.filter(payment => payment.date < interestStart);
  const paymentLedger = [];
  const interestPeriods = [];
  let boundary = interestStart;

  const accrueThrough = endDate => {
    const accrued = accrueInterest(
      state.principal,
      boundary,
      endDate,
      interestRates,
      input.interestRate,
      input.dayBasis || 365,
      input.interestType
    );
    state.postInterest += accrued.cents;
    state.postInterestAccrued += accrued.cents;
    interestPeriods.push(...accrued.periods);
    boundary = endDate || boundary;
    return accrued.cents;
  };

  for (const payment of applicable) {
    const interestAccruedBeforePayment = accrueThrough(payment.date);
    paymentLedger.push(applyPayment(state, payment, interestAccruedBeforePayment));
  }
  accrueThrough(accountDate);

  const currentDebt = state.principal
    + state.preInterest
    + state.postInterest
    + state.costs
    + state.attorneyFee
    + state.otherCharges
    + state.collectionFee;
  const totalPayments = normalized
    .filter(payment => payment.date <= accountDate)
    .reduce((sum, payment) => sum + payment.amountCents, 0n);
  return {
    principalOutstanding: amount(state.principal),
    preEnforcementInterestOutstanding: amount(state.preInterest),
    postEnforcementInterest: amount(state.postInterest),
    postEnforcementInterestAccrued: amount(state.postInterestAccrued),
    eligibleCostsOutstanding: amount(state.costs),
    enforcementAttorneyFeeOutstanding: amount(state.attorneyFee),
    otherChargesOutstanding: amount(state.otherCharges),
    collectionFeeOutstanding: amount(state.collectionFee),
    paymentsAppliedToFeriler: amount(state.appliedToFeriler),
    paymentsAppliedToPrincipal: amount(state.appliedToPrincipal),
    paymentsAppliedToOtherCharges: amount(state.appliedToOtherCharges),
    paymentsAppliedToCollectionFee: amount(state.appliedToCollectionFee),
    unappliedExcessPayment: amount(state.unapplied),
    totalPayments: amount(totalPayments),
    currentDebt: amount(currentDebt),
    paymentLedger,
    interestPeriods,
    ignoredFuturePaymentCount: ignoredFuture.length,
    ignoredPreEnforcementPaymentCount: ignoredPreEnforcement.length
  };
}

export function calculateLegacyEndDeduction(input = {}) {
  const rates = (input.interestRates || []).filter(rate => !input.interestType || rate.type === input.interestType);
  const interest = accrueInterest(
    cents(input.principal),
    input.interestStart,
    input.accountDate,
    rates,
    input.interestRate,
    input.dayBasis || 365,
    input.interestType
  ).cents;
  const payments = normalizeReferencePayments(input.paymentEvents)
    .filter(payment => payment.date >= input.interestStart && payment.date <= input.accountDate)
    .reduce((sum, payment) => sum + payment.amountCents, 0n);
  const gross = cents(input.principal)
    + cents(input.preInterest)
    + interest
    + cents(input.costs)
    + cents(input.attorneyFee)
    + cents(input.otherCharges)
    + cents(input.collectionFee);
  return {
    postEnforcementInterest: amount(interest),
    payments: amount(payments),
    currentDebt: amount(gross > payments ? gross - payments : 0n)
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "") ?? "";
}

function truthy(value) {
  return value === true || ["true", "1", "yes", "evet"].includes(String(value || "").toLocaleLowerCase("tr-TR"));
}

function normalizeInterestType(value) {
  if (value === "Kanuni Faiz") return "Adi Kanuni Faiz";
  if (value === "Avans Faizi") return "Reeskont Avans";
  return value || "";
}

function parameterValue(parameters, key, fallback, accountDate) {
  return [...(parameters || [])]
    .filter(parameter => parameter.key === key && parameter.active !== false)
    .filter(parameter => !parameter.from || parameter.from <= accountDate)
    .filter(parameter => !parameter.to || accountDate <= parameter.to)
    .sort((left, right) => String(right.from || "").localeCompare(String(left.from || "")))[0]?.value ?? fallback;
}

function attorneyFee(baseAmount, principal, followUpType, accountDate, tariffs) {
  const tariff = [...(tariffs || [])]
    .filter(item => item.active !== false && item.from <= accountDate && (!item.to || accountDate <= item.to))
    .sort((left, right) => String(right.from).localeCompare(String(left.from)))[0];
  if (!tariff || baseAmount <= 0) return 0;
  let remaining = baseAmount;
  let relative = 0;
  for (const bracket of tariff.brackets || []) {
    if (remaining <= 0) break;
    const bracketAmount = bracket.limit === null ? remaining : Math.min(remaining, Number(bracket.limit || 0));
    relative += bracketAmount * (Number(bracket.rate || 0) / 100);
    remaining -= bracketAmount;
  }
  const minimum = /Tahliye/i.test(String(followUpType || ""))
    ? Number(tariff.evictionMinimum || 0)
    : Number(tariff.regularMinimum || 0);
  const maximum = tariff.maximumAmount === null || tariff.maximumAmount === undefined
    ? principal
    : Math.min(principal, Number(tariff.maximumAmount || 0));
  return Math.min(maximum, Math.max(relative, minimum));
}

export function independentInputFromFile(file = {}, tools = {}, accountDate = "", paymentEvents = []) {
  const account = object(file.account_info || file.accountInfo);
  const metadata = object(file.metadata);
  const legacy = object(metadata.legacyFlatFields);
  const instrument = object(file.instrument_info || file.instrumentInfo);
  const principal = Number(first(account.principal, file.principal, metadata.principal) || 0);
  const preInterest = Number(first(account.preInterest, account.pre_interest, file.preInterest, metadata.preInterest) || 0);
  const followUpType = first(file.follow_type, file.followType, file.followUpType, legacy.followUpType, metadata.followType);
  const interestType = normalizeInterestType(first(account.interestType, account.interest_type, file.interestType, metadata.interestType));
  const isNegotiable = String(followUpType).toLocaleLowerCase("tr-TR").includes("kambiyo");
  let otherCharges = 0;
  if (truthy(first(metadata.includeInstrumentCharge, legacy.includeInstrumentCharge, file.includeInstrumentCharge)) && isNegotiable) {
    if (first(instrument.type, file.negotiableInstrumentType, legacy.negotiableInstrumentType, metadata.negotiableInstrumentType) === "Çek") {
      otherCharges = principal * (Number(parameterValue(tools.parameters, "cheque_compensation_rate", 10, accountDate)) / 100);
    } else if (first(instrument.type, file.negotiableInstrumentType, legacy.negotiableInstrumentType, metadata.negotiableInstrumentType) === "Bono") {
      otherCharges = principal * (Number(parameterValue(tools.parameters, "promissory_note_commission_rate", 0.3, accountDate)) / 100);
    }
  }
  const finalizedAmount = principal + preInterest + (otherCharges > 0 && first(instrument.type, file.negotiableInstrumentType, legacy.negotiableInstrumentType, metadata.negotiableInstrumentType) === "Çek" ? otherCharges : 0);
  const feeRate = Number(first(account.feeRate, account.fee_rate, file.feeRate, metadata.feeRate) || 0);
  return {
    principal,
    preInterest,
    costs: Number(first(account.expenses, file.expenses, metadata.expenses) || 0),
    attorneyFee: attorneyFee(finalizedAmount, principal, followUpType, accountDate, tools.attorneyFeeTariffs),
    otherCharges,
    collectionFee: feeRate > 0
      ? finalizedAmount * (feeRate / 100)
      : Number(first(account.fees, file.fees, metadata.fees) || 0),
    interestType,
    interestRate: Number(first(account.interestRate, account.interest_rate, file.interestRate, metadata.interestRate) || 0),
    interestStart: String(first(account.interestStart, account.interest_start, file.interestStart, file.followUpDate, file.opening_date, file.openingDate, metadata.interestStart) || "").slice(0, 10),
    accountDate,
    interestRates: tools.interestRates || [],
    dayBasis: Number(parameterValue(tools.parameters, "interest_day_basis", 365, accountDate)) || 365,
    paymentEvents
  };
}
