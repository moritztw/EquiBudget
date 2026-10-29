import {
  Account,
  BudgetCategory,
  DuplicateMatchKind,
  ImportStagingRow,
  MatchSource,
  MatchingRule,
  Person,
  PersonMonthlyIncome,
  PlannedPayment,
  RecurrenceInterval,
  SinkingFundLedgerEntry,
  SplitStrategy,
  Transaction,
  TransactionDirection,
} from './types';

export const INTERVAL_MONTHS: Record<RecurrenceInterval, number> = {
  [RecurrenceInterval.MONTHLY]: 1,
  [RecurrenceInterval.QUARTERLY]: 3,
  [RecurrenceInterval.SEMI_ANNUAL]: 6,
  [RecurrenceInterval.ANNUAL]: 12,
  [RecurrenceInterval.BIENNIAL]: 24,
  [RecurrenceInterval.ONE_TIME]: 0,
};

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function normalizeIban(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, '').toUpperCase();
}

function normalizePartyName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function daysBetweenIsoDates(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split('-').map(Number);
  const [yb, mb, db] = isoB.split('-').map(Number);
  const utcA = Date.UTC(ya, (ma || 1) - 1, da || 1);
  const utcB = Date.UTC(yb, (mb || 1) - 1, db || 1);
  return Math.abs(Math.round((utcA - utcB) / 86_400_000));
}

/**
 * Resolve the effective scheduled amount of a PlannedPayment on `targetDateIso` (`YYYY-MM-DD`).
 * Evaluates all `amountRevisions` with `validFrom <= targetDateIso` and returns the most recent one,
 * or falls back to `payment.amount`.
 */
export function resolveEffectivePaymentAmount(
  payment: PlannedPayment,
  targetDateIso: string
): number {
  if (!payment.amountRevisions || payment.amountRevisions.length === 0) {
    return payment.amount;
  }
  const applicable = payment.amountRevisions.filter(
    (rev) => rev.validFrom <= targetDateIso
  );
  if (applicable.length === 0) {
    return payment.amount;
  }
  applicable.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return applicable[applicable.length - 1].amount;
}

export function occurrenceDateInMonth(monthKey: string, dayOfMonth: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const maxDay = new Date(y, m, 0).getDate();
  const clampedDay = Math.max(1, Math.min(maxDay, dayOfMonth || 1));
  return `${y}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Determine whether a PlannedPayment has expired with respect to `monthKey` (`YYYY-MM`).
 */
export function isPaymentExpiredForMonth(
  payment: PlannedPayment,
  monthKey: string
): boolean {
  if (!payment.isActive) return true;
  if (!payment.endDate) return false;

  if (payment.interval === RecurrenceInterval.MONTHLY) {
    const occDate = occurrenceDateInMonth(monthKey, payment.dayOfMonth);
    return occDate > payment.endDate;
  }

  if (payment.nextDueDate > payment.endDate) {
    return true;
  }
  if (monthKey > payment.endDate.slice(0, 7)) {
    return true;
  }
  return false;
}

/**
 * Largest-Remainder (Hare-Niemeyer) distribution in integer cents.
 * Guarantees sum(shares) === totalCents with zero rounding drift.
 */
export function distributeCentsByWeights(
  totalCents: number,
  weights: Record<string, number>
): Record<string, number> {
  const keys = Object.keys(weights);
  if (keys.length === 0) return {};

  const sign = totalCents < 0 ? -1 : 1;
  const absTotal = Math.abs(totalCents);
  const weightSum = keys.reduce((acc, k) => acc + Math.max(0, weights[k] ?? 0), 0);

  if (absTotal === 0 || weightSum <= 0) {
    return Object.fromEntries(keys.map((k) => [k, 0]));
  }

  const floors: Record<string, number> = {};
  const remainders: Array<{key: string; rem: number; weight: number}> = [];
  let allocated = 0;

  for (const key of keys) {
    const w = Math.max(0, weights[key] ?? 0);
    const exact = (absTotal * w) / weightSum;
    const fl = Math.floor(exact);
    floors[key] = fl;
    allocated += fl;
    remainders.push({key, rem: exact - fl, weight: w});
  }

  const leftover = absTotal - allocated;
  remainders.sort((a, b) => {
    if (Math.abs(b.rem - a.rem) > 1e-9) return b.rem - a.rem;
    if (Math.abs(b.weight - a.weight) > 1e-9) return b.weight - a.weight;
    return a.key.localeCompare(b.key);
  });

  for (let i = 0; i < leftover; i += 1) {
    const target = remainders[i % remainders.length];
    floors[target.key] += 1;
  }

  return Object.fromEntries(keys.map((k) => [k, floors[k] * sign]));
}

export interface PersonAllocationShare {
  personId: string;
  displayName: string;
  roleLabel: string;
  isEmployed: boolean;
  incomeRecordedForMonth: boolean;
  incomeNote: string;
  monthlyNetIncome: number;
  personalFixedAllowance: number;
  disposableBeforeSplit: number;
  directFixedShare: number;
  accrualProvisionShare: number;
  totalJointContribution: number;
  shareRatio: number;
  remainingPocketMoney: number;
}

export interface AllocationSummary {
  monthKey: string;
  strategy: SplitStrategy;
  allowNegativeTransferCompensation: boolean;
  totalHouseholdNetIncome: number;
  totalDisposableBeforeSplit: number;
  totalDirectFixedExpenses: number;
  totalAccrualProvisions: number;
  totalJointRequirement: number;
  householdRemainingPocketMoney: number;
  unenteredEmployedCount: number;
  shares: PersonAllocationShare[];
}

export function calculateMonthlyIncomeSplit(
  persons: Person[],
  monthlyIncomes: PersonMonthlyIncome[],
  monthKey: string,
  directFixedExpenses: number,
  accrualProvisions: number,
  strategy: SplitStrategy,
  allowNegativeTransferCompensation = false
): AllocationSummary {
  const activePersons = persons.filter((p) => p.participatesInHouseholdSplit);
  const incomeMap = new Map<string, PersonMonthlyIncome>();
  for (const rec of monthlyIncomes) {
    if (rec.monthKey === monthKey) {
      incomeMap.set(rec.personId, rec);
    }
  }

  const totalFixedCents = toCents(directFixedExpenses);
  const totalAccrualCents = toCents(accrualProvisions);
  const totalJointCents = totalFixedCents + totalAccrualCents;

  const netCentsByPerson: Record<string, number> = {};
  const dedCentsByPerson: Record<string, number> = {};
  const disposableMapCents: Record<string, number> = {};
  let unenteredEmployedCount = 0;

  for (const p of activePersons) {
    const rec = incomeMap.get(p.id);
    if (!rec && p.isEmployed) {
      unenteredEmployedCount += 1;
    }
    const netCents = rec ? toCents(rec.actualNetIncome) : 0;
    const dedCents = rec
      ? toCents(rec.personalFixedAllowance)
      : toCents(p.defaultPersonalAllowance);
    netCentsByPerson[p.id] = netCents;
    dedCentsByPerson[p.id] = dedCents;
    disposableMapCents[p.id] = Math.max(0, netCents - dedCents);
  }

  let totalContribCentsByPerson: Record<string, number> = {};

  if (strategy === SplitStrategy.FIFTY_FIFTY) {
    const weights: Record<string, number> = {};
    for (const p of activePersons) weights[p.id] = p.isEmployed ? 1 : 0;
    if (Object.values(weights).every((w) => w === 0)) {
      for (const p of activePersons) weights[p.id] = 1;
    }
    totalContribCentsByPerson = distributeCentsByWeights(totalJointCents, weights);
  } else if (strategy === SplitStrategy.PROPORTIONAL) {
    const weights: Record<string, number> = {};
    for (const p of activePersons) {
      weights[p.id] = p.isEmployed ? disposableMapCents[p.id] : 0;
    }
    const sumW = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sumW === 0) {
      for (const p of activePersons) weights[p.id] = p.isEmployed ? 1 : 0;
    }
    totalContribCentsByPerson = distributeCentsByWeights(totalJointCents, weights);
  } else if (strategy === SplitStrategy.CUSTOM_WEIGHT) {
    const weights: Record<string, number> = {};
    for (const p of activePersons) {
      weights[p.id] = p.customSplitWeight > 0 ? p.customSplitWeight : 0;
    }
    if (Object.values(weights).every((w) => w === 0)) {
      for (const p of activePersons) weights[p.id] = 1;
    }
    totalContribCentsByPerson = distributeCentsByWeights(totalJointCents, weights);
  } else {
    const earners = activePersons.filter((p) => p.isEmployed);
    const nonEarners = activePersons.filter((p) => !p.isEmployed);
    for (const p of nonEarners) {
      totalContribCentsByPerson[p.id] = 0;
    }

    if (earners.length === 0) {
      const fallbackWeights = Object.fromEntries(activePersons.map((p) => [p.id, 1]));
      totalContribCentsByPerson = distributeCentsByWeights(totalJointCents, fallbackWeights);
    } else if (allowNegativeTransferCompensation) {
      const sumDisp = earners.reduce((acc, p) => acc + disposableMapCents[p.id], 0);
      const targetRemainingExact = (sumDisp - totalJointCents) / earners.length;
      const baseContribs: Record<string, number> = {};
      let sumFloor = 0;
      const remainders: Array<{id: string; rem: number}> = [];

      for (const p of earners) {
        const exactContrib = disposableMapCents[p.id] - targetRemainingExact;
        const fl = Math.floor(exactContrib);
        baseContribs[p.id] = fl;
        sumFloor += fl;
        remainders.push({id: p.id, rem: exactContrib - fl});
      }
      const diff = totalJointCents - sumFloor;
      remainders.sort((a, b) => b.rem - a.rem || a.id.localeCompare(b.id));
      for (let i = 0; i < diff; i += 1) {
        baseContribs[remainders[i % remainders.length].id] += 1;
      }
      for (const p of earners) {
        totalContribCentsByPerson[p.id] = baseContribs[p.id];
      }
    } else {
      let pool = [...earners];
      const lockedZero = new Set<string>();

      while (pool.length > 0) {
        const sumPoolDisp = pool.reduce((acc, p) => acc + disposableMapCents[p.id], 0);
        const targetRem = (sumPoolDisp - totalJointCents) / pool.length;
        const negativeEarners = pool.filter((p) => disposableMapCents[p.id] < targetRem);
        if (negativeEarners.length === 0 || pool.length === 1) {
          break;
        }
        for (const neg of negativeEarners) {
          lockedZero.add(neg.id);
          totalContribCentsByPerson[neg.id] = 0;
        }
        pool = pool.filter((p) => !lockedZero.has(p.id));
      }

      const sumPoolDisp = pool.reduce((acc, p) => acc + disposableMapCents[p.id], 0);
      const targetRem = (sumPoolDisp - totalJointCents) / Math.max(1, pool.length);
      const exactPositiveWeights: Record<string, number> = {};

      if (totalJointCents >= sumPoolDisp) {
        const deficit = totalJointCents - sumPoolDisp;
        const weights = Object.fromEntries(
          pool.map((p) => [p.id, Math.max(1, disposableMapCents[p.id])])
        );
        const extra = distributeCentsByWeights(deficit, weights);
        for (const p of pool) {
          totalContribCentsByPerson[p.id] = disposableMapCents[p.id] + (extra[p.id] ?? 0);
        }
      } else {
        for (const p of pool) {
          exactPositiveWeights[p.id] = Math.max(0, disposableMapCents[p.id] - targetRem);
        }
        const splitPool = distributeCentsByWeights(totalJointCents, exactPositiveWeights);
        for (const p of pool) {
          totalContribCentsByPerson[p.id] = splitPool[p.id] ?? 0;
        }
      }
    }
  }

  const fixedRatioWeights: Record<string, number> = {};
  for (const p of activePersons) {
    fixedRatioWeights[p.id] = Math.max(0, totalContribCentsByPerson[p.id] ?? 0);
  }
  const hasPositiveWeights = Object.values(fixedRatioWeights).some((v) => v > 0);
  const directFixedByPerson = hasPositiveWeights
    ? distributeCentsByWeights(totalFixedCents, fixedRatioWeights)
    : Object.fromEntries(activePersons.map((p) => [p.id, 0]));

  const shares: PersonAllocationShare[] = activePersons.map((p) => {
    const rec = incomeMap.get(p.id);
    const totalContribCents = totalContribCentsByPerson[p.id] ?? 0;
    const fixedPartCents = hasPositiveWeights
      ? directFixedByPerson[p.id] ?? 0
      : Math.round((totalContribCents * totalFixedCents) / Math.max(1, totalJointCents));
    const accrualPartCents = totalContribCents - fixedPartCents;
    const dispCents = disposableMapCents[p.id] ?? 0;
    const remCents = dispCents - totalContribCents;

    return {
      personId: p.id,
      displayName: p.displayName,
      roleLabel: p.roleLabel,
      isEmployed: p.isEmployed,
      incomeRecordedForMonth: Boolean(rec) || !p.isEmployed,
      incomeNote: rec?.note ?? '',
      monthlyNetIncome: fromCents(netCentsByPerson[p.id] ?? 0),
      personalFixedAllowance: fromCents(dedCentsByPerson[p.id] ?? 0),
      disposableBeforeSplit: fromCents(dispCents),
      directFixedShare: fromCents(fixedPartCents),
      accrualProvisionShare: fromCents(accrualPartCents),
      totalJointContribution: fromCents(totalContribCents),
      shareRatio: totalJointCents > 0 ? totalContribCents / totalJointCents : 0,
      remainingPocketMoney: fromCents(remCents),
    };
  });

  const totalNet = shares.reduce((acc, s) => acc + s.monthlyNetIncome, 0);
  const totalDisp = shares.reduce((acc, s) => acc + s.disposableBeforeSplit, 0);
  const totalRem = shares.reduce((acc, s) => acc + s.remainingPocketMoney, 0);

  return {
    monthKey,
    strategy,
    allowNegativeTransferCompensation,
    totalHouseholdNetIncome: totalNet,
    totalDisposableBeforeSplit: totalDisp,
    totalDirectFixedExpenses: fromCents(totalFixedCents),
    totalAccrualProvisions: fromCents(totalAccrualCents),
    totalJointRequirement: fromCents(totalJointCents),
    householdRemainingPocketMoney: totalRem,
    unenteredEmployedCount,
    shares,
  };
}

export interface MonthSlot {
  key: string; // YYYY-MM
  year: number;
  monthIndex: number; // 0..11
}

export function buildMonthSlots(
  startMonthKey: string,
  count: number,
  startOffset = 0
): MonthSlot[] {
  const [yStr, mStr] = startMonthKey.split('-');
  const startYear = Number(yStr);
  const startMonthIdx = Number(mStr) - 1;
  const slots: MonthSlot[] = [];

  for (let i = 0; i < count; i += 1) {
    const dt = new Date(startYear, startMonthIdx + startOffset + i, 1);
    const y = dt.getFullYear();
    const m = dt.getMonth();
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    slots.push({key, year: y, monthIndex: m});
  }
  return slots;
}

export function monthsBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface EvaluatedPlannedPayment {
  payment: PlannedPayment;
  categoryName: string;
  accountName: string;
  isSinkingFund: boolean;
  isExpiredOrArchived: boolean;
  hasResidualPotBalance: boolean;
  isOverdrawnPot: boolean;
  potOverdraftAmount: number;
  effectiveInvoiceAmount: number;
  hasFutureRateRevisions: boolean;
  standardMonthlyRate: number;
  effectiveMonthlyRate: number;
  potBalance: number;
  fillRatio: number;
  monthsUntilNextDue: number;
  status: 'PAID' | 'DUE_NOW' | 'CATCH_UP' | 'ACCRUING' | 'EXPIRED';
  cashOutByMonth: Record<string, number>;
  monthlyLoadByMonth: Record<string, number>;
}

export interface TwelveMonthScheduleMatrix {
  slots: MonthSlot[];
  rows: EvaluatedPlannedPayment[];
  archivedRows: EvaluatedPlannedPayment[];
  allEvaluatedRows: EvaluatedPlannedPayment[];
  monthlyDirectFixedSum: number;
  monthlyAccrualProvisionSum: number;
  smoothedMonthlyTotal: number;
  twelveMonthTotalCashOut: number;
  peakMonthKey: string;
  peakMonthAmount: number;
  actualCashOutTotalsByMonth: Record<string, number>;
  smoothedLoadTotalsByMonth: Record<string, number>;
  directFixedTotalsByMonth: Record<string, number>;
  accrualProvisionTotalsByMonth: Record<string, number>;
  netLiquidityDeltaByMonth: Record<string, number>;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    monthlyTotal: number;
    shareRatio: number;
  }>;
}

function computePaymentMonthlyLoadCentsForSlot(
  payment: PlannedPayment,
  slotMonthKey: string,
  referenceMonthKey: string,
  signedPotCents: number
): {directCents: number; accrualCents: number} {
  if (isPaymentExpiredForMonth(payment, slotMonthKey)) {
    return {directCents: 0, accrualCents: 0};
  }

  const intervalMonths = INTERVAL_MONTHS[payment.interval];
  if (payment.interval === RecurrenceInterval.MONTHLY) {
    const occDate = occurrenceDateInMonth(slotMonthKey, payment.dayOfMonth);
    const effAmt = resolveEffectivePaymentAmount(payment, occDate);
    return {directCents: toCents(effAmt), accrualCents: 0};
  }

  if (!payment.autoAccrual) {
    return {directCents: 0, accrualCents: 0};
  }

  let upcomingDueIso = payment.nextDueDate;
  if (intervalMonths > 0) {
    const [dy, dm, dd] = payment.nextDueDate.split('-').map(Number);
    let stepOffset = 0;
    while (upcomingDueIso.slice(0, 7) < slotMonthKey) {
      stepOffset += intervalMonths;
      const dt = new Date(dy, dm - 1 + stepOffset, Math.min(28, dd));
      upcomingDueIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(dt.getDate()).padStart(2, '0')}`;
    }
  } else if (upcomingDueIso.slice(0, 7) < slotMonthKey) {
    return {directCents: 0, accrualCents: 0};
  }

  if (payment.endDate && upcomingDueIso > payment.endDate) {
    return {directCents: 0, accrualCents: 0};
  }

  const targetAmtCents = toCents(resolveEffectivePaymentAmount(payment, upcomingDueIso));

  if (upcomingDueIso === payment.nextDueDate) {
    const dueMonthKey = payment.nextDueDate.slice(0, 7);
    const totalStepsFromRef = Math.max(
      1,
      monthsBetweenKeys(referenceMonthKey, dueMonthKey) <= 0
        ? 1
        : monthsBetweenKeys(referenceMonthKey, dueMonthKey)
    );
    // Note: when signedPotCents < 0 (uncovered pot overdraft), shortfallCents includes the negative balance!
    const shortfallCents = Math.max(0, targetAmtCents - signedPotCents);
    const catchUpCents =
      shortfallCents === 0 && monthsBetweenKeys(referenceMonthKey, dueMonthKey) === 0
        ? 0
        : Math.ceil(shortfallCents / totalStepsFromRef);

    if (payment.interval === RecurrenceInterval.ONE_TIME) {
      return {directCents: 0, accrualCents: catchUpCents};
    }
    const standardCents = Math.round(targetAmtCents / intervalMonths);
    return {
      directCents: 0,
      accrualCents: shortfallCents === 0 ? 0 : Math.max(standardCents, catchUpCents),
    };
  }

  if (payment.interval === RecurrenceInterval.ONE_TIME) {
    return {directCents: 0, accrualCents: 0};
  }
  return {directCents: 0, accrualCents: Math.round(targetAmtCents / intervalMonths)};
}

export function buildTwelveMonthScheduleMatrix(
  payments: PlannedPayment[],
  ledgerEntries: SinkingFundLedgerEntry[],
  categories: BudgetCategory[],
  accounts: Account[],
  referenceMonthKey: string
): TwelveMonthScheduleMatrix {
  const slots = buildMonthSlots(referenceMonthKey, 12, 0);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const potBalanceCentsByPayment = new Map<string, number>();
  for (const entry of ledgerEntries) {
    const prev = potBalanceCentsByPayment.get(entry.plannedPaymentId) ?? 0;
    potBalanceCentsByPayment.set(entry.plannedPaymentId, prev + toCents(entry.amount));
  }

  const actualCashOutCentsByMonth: Record<string, number> = Object.fromEntries(
    slots.map((s) => [s.key, 0])
  );
  const directFixedCentsByMonth: Record<string, number> = Object.fromEntries(
    slots.map((s) => [s.key, 0])
  );
  const accrualProvisionCentsByMonth: Record<string, number> = Object.fromEntries(
    slots.map((s) => [s.key, 0])
  );

  const catMonthlyCents = new Map<string, number>();

  const allEvaluatedRows: EvaluatedPlannedPayment[] = payments.map((p) => {
    const intervalMonths = INTERVAL_MONTHS[p.interval];
    const isSinkingFund = p.interval !== RecurrenceInterval.MONTHLY && p.autoAccrual;
    // Signed virtual pot balance: can be negative if an uncovered payment was debited!
    const signedPotCents = potBalanceCentsByPayment.get(p.id) ?? 0;
    const isOverdrawnPot = signedPotCents < 0;
    const potOverdraftAmount = isOverdrawnPot ? fromCents(-signedPotCents) : 0;
    const isExpired = isPaymentExpiredForMonth(p, referenceMonthKey);

    const refTargetDate =
      p.interval === RecurrenceInterval.MONTHLY
        ? occurrenceDateInMonth(referenceMonthKey, p.dayOfMonth)
        : p.nextDueDate;

    const effectiveInvoiceAmount = resolveEffectivePaymentAmount(p, refTargetDate);
    const amountCents = toCents(effectiveInvoiceAmount);
    const hasFutureRateRevisions = (p.amountRevisions ?? []).some(
      (rev) => rev.validFrom > refTargetDate
    );

    const dueMonthKey = p.nextDueDate.slice(0, 7);
    const monthsUntilDue = monthsBetweenKeys(referenceMonthKey, dueMonthKey);

    const refLoad = computePaymentMonthlyLoadCentsForSlot(
      p,
      referenceMonthKey,
      referenceMonthKey,
      signedPotCents
    );
    const effectiveRateCents = refLoad.directCents + refLoad.accrualCents;
    const standardRateCents = isExpired
      ? 0
      : p.interval === RecurrenceInterval.MONTHLY
        ? amountCents
        : p.interval === RecurrenceInterval.ONE_TIME
          ? Math.ceil(amountCents / Math.max(1, monthsUntilDue))
          : Math.round(amountCents / intervalMonths);

    const cashOutByMonth: Record<string, number> = {};
    const monthlyLoadByMonth: Record<string, number> = {};

    for (const slot of slots) {
      const slotLoad = computePaymentMonthlyLoadCentsForSlot(
        p,
        slot.key,
        referenceMonthKey,
        signedPotCents
      );
      monthlyLoadByMonth[slot.key] = fromCents(
        slotLoad.directCents + slotLoad.accrualCents
      );
      directFixedCentsByMonth[slot.key] += slotLoad.directCents;
      accrualProvisionCentsByMonth[slot.key] += slotLoad.accrualCents;

      if (!p.isActive) {
        cashOutByMonth[slot.key] = 0;
        continue;
      }

      let dueInSlot = false;
      const occDate = occurrenceDateInMonth(slot.key, p.dayOfMonth);

      if (p.interval === RecurrenceInterval.MONTHLY) {
        dueInSlot = !p.endDate || occDate <= p.endDate;
      } else if (p.interval === RecurrenceInterval.ONE_TIME) {
        dueInSlot =
          slot.key === dueMonthKey && (!p.endDate || p.nextDueDate <= p.endDate);
      } else {
        const diff = monthsBetweenKeys(dueMonthKey, slot.key);
        if (diff >= 0 && diff % intervalMonths === 0) {
          dueInSlot = !p.endDate || occDate <= p.endDate;
        }
      }

      const slotCashAmt = dueInSlot
        ? resolveEffectivePaymentAmount(p, occDate)
        : 0;
      const cashCents = toCents(slotCashAmt);
      cashOutByMonth[slot.key] = fromCents(cashCents);
      actualCashOutCentsByMonth[slot.key] += cashCents;
    }

    let status: EvaluatedPlannedPayment['status'] = 'ACCRUING';
    if (isExpired) {
      status = 'EXPIRED';
    } else if (monthsUntilDue === 0 && p.interval !== RecurrenceInterval.MONTHLY) {
      status = 'DUE_NOW';
    } else if (p.interval === RecurrenceInterval.MONTHLY) {
      status = 'PAID';
    } else if (effectiveRateCents > standardRateCents + 1 || isOverdrawnPot) {
      status = 'CATCH_UP';
    }

    if (!isExpired && effectiveRateCents > 0) {
      const prevCat = catMonthlyCents.get(p.categoryId) ?? 0;
      catMonthlyCents.set(p.categoryId, prevCat + effectiveRateCents);
    }

    const positivePotCents = Math.max(0, signedPotCents);

    return {
      payment: p,
      categoryName: categoryMap.get(p.categoryId)?.name ?? 'Sonstiges',
      accountName: accountMap.get(p.accountId)?.name ?? 'Konto',
      isSinkingFund,
      isExpiredOrArchived: isExpired,
      hasResidualPotBalance: isExpired && signedPotCents > 0,
      isOverdrawnPot,
      potOverdraftAmount,
      effectiveInvoiceAmount,
      hasFutureRateRevisions,
      standardMonthlyRate: fromCents(standardRateCents),
      effectiveMonthlyRate: fromCents(effectiveRateCents),
      potBalance: fromCents(signedPotCents),
      fillRatio:
        amountCents > 0
          ? Math.min(1, positivePotCents / amountCents)
          : positivePotCents > 0
            ? 1
            : 0,
      monthsUntilNextDue: isExpired ? 0 : monthsUntilDue,
      status,
      cashOutByMonth,
      monthlyLoadByMonth,
    };
  });

  const rows = allEvaluatedRows.filter((r) => !r.isExpiredOrArchived);
  const archivedRows = allEvaluatedRows.filter((r) => r.isExpiredOrArchived);

  const refDirectCents = directFixedCentsByMonth[referenceMonthKey] ?? 0;
  const refAccrualCents = accrualProvisionCentsByMonth[referenceMonthKey] ?? 0;
  const smoothedMonthlyCents = refDirectCents + refAccrualCents;

  let twelveMonthTotalCents = 0;
  let peakMonthKey = slots[0]?.key ?? referenceMonthKey;
  let peakMonthCents = -1;

  const actualCashOutTotalsByMonth: Record<string, number> = {};
  const smoothedLoadTotalsByMonth: Record<string, number> = {};
  const directFixedTotalsByMonth: Record<string, number> = {};
  const accrualProvisionTotalsByMonth: Record<string, number> = {};
  const netLiquidityDeltaByMonth: Record<string, number> = {};

  for (const slot of slots) {
    const actualCents = actualCashOutCentsByMonth[slot.key] ?? 0;
    const slotDirect = directFixedCentsByMonth[slot.key] ?? 0;
    const slotAccrual = accrualProvisionCentsByMonth[slot.key] ?? 0;
    const slotSmoothed = slotDirect + slotAccrual;

    twelveMonthTotalCents += actualCents;
    actualCashOutTotalsByMonth[slot.key] = fromCents(actualCents);
    directFixedTotalsByMonth[slot.key] = fromCents(slotDirect);
    accrualProvisionTotalsByMonth[slot.key] = fromCents(slotAccrual);
    smoothedLoadTotalsByMonth[slot.key] = fromCents(slotSmoothed);
    netLiquidityDeltaByMonth[slot.key] = fromCents(slotSmoothed - actualCents);

    if (actualCents > peakMonthCents) {
      peakMonthCents = actualCents;
      peakMonthKey = slot.key;
    }
  }

  const categoryBreakdown = Array.from(catMonthlyCents.entries())
    .map(([categoryId, cents]) => ({
      categoryId,
      categoryName: categoryMap.get(categoryId)?.name ?? 'Sonstiges',
      monthlyTotal: fromCents(cents),
      shareRatio: smoothedMonthlyCents > 0 ? cents / smoothedMonthlyCents : 0,
    }))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);

  return {
    slots,
    rows,
    archivedRows,
    allEvaluatedRows,
    monthlyDirectFixedSum: fromCents(refDirectCents),
    monthlyAccrualProvisionSum: fromCents(refAccrualCents),
    smoothedMonthlyTotal: fromCents(smoothedMonthlyCents),
    twelveMonthTotalCashOut: fromCents(twelveMonthTotalCents),
    peakMonthKey,
    peakMonthAmount: fromCents(Math.max(0, peakMonthCents)),
    actualCashOutTotalsByMonth,
    smoothedLoadTotalsByMonth,
    directFixedTotalsByMonth,
    accrualProvisionTotalsByMonth,
    netLiquidityDeltaByMonth,
    categoryBreakdown,
  };
}

export interface AccountLiquidityRow {
  account: Account;
  physicalBalance: number;
  reservedInVirtualPots: number;
  overdrawnInVirtualPots: number;
  freeDisposableLiquidity: number;
  isFullyBacked: boolean;
}

export function reconcileAccountLiquidity(
  accounts: Account[],
  payments: PlannedPayment[],
  ledgerEntries: SinkingFundLedgerEntry[]
): AccountLiquidityRow[] {
  const paymentMap = new Map(payments.map((p) => [p.id, p]));
  const potBalanceCentsByPayment = new Map<string, number>();

  for (const entry of ledgerEntries) {
    const prev = potBalanceCentsByPayment.get(entry.plannedPaymentId) ?? 0;
    potBalanceCentsByPayment.set(entry.plannedPaymentId, prev + toCents(entry.amount));
  }

  const positiveReservedByAccount = new Map<string, number>();
  const negativeOverdrawnByAccount = new Map<string, number>();

  for (const [paymentId, signedPotCents] of potBalanceCentsByPayment.entries()) {
    const payment = paymentMap.get(paymentId);
    if (!payment) continue;
    if (signedPotCents > 0) {
      positiveReservedByAccount.set(
        payment.accountId,
        (positiveReservedByAccount.get(payment.accountId) ?? 0) + signedPotCents
      );
    } else if (signedPotCents < 0) {
      negativeOverdrawnByAccount.set(
        payment.accountId,
        (negativeOverdrawnByAccount.get(payment.accountId) ?? 0) + Math.abs(signedPotCents)
      );
    }
  }

  return accounts.map((account) => {
    const physCents = toCents(account.currentBalance);
    const resCents = positiveReservedByAccount.get(account.id) ?? 0;
    const overdrawnCents = negativeOverdrawnByAccount.get(account.id) ?? 0;
    const freeCents = physCents - resCents;
    return {
      account,
      physicalBalance: fromCents(physCents),
      reservedInVirtualPots: fromCents(resCents),
      overdrawnInVirtualPots: fromCents(overdrawnCents),
      freeDisposableLiquidity: fromCents(freeCents),
      isFullyBacked: freeCents >= 0,
    };
  });
}

function parseGermanDecimal(raw: string): number {
  const cleaned = raw
    .replace(/["'\s€EUR]/gi, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseGermanDate(raw: string): string {
  const trimmed = raw.replace(/["']/g, '').trim();
  const dotMatch = /^(\d{2})\.(\d{2})\.(\d{2,4})$/.exec(trimmed);
  if (dotMatch) {
    const day = dotMatch[1];
    const month = dotMatch[2];
    const year = dotMatch[3].length === 2 ? `20${dotMatch[3]}` : dotMatch[3];
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return '2026-04-01';
}

function splitSemicolonCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

export function computeCanonicalImportHash(
  targetAccountId: string,
  bookingDate: string,
  signedAmount: number,
  counterpartyName: string,
  normCounterpartyIban: string,
  remittanceInfo: string,
  occurrenceIndex = 1
): string {
  const payload = [
    targetAccountId,
    bookingDate,
    signedAmount.toFixed(2),
    normalizePartyName(counterpartyName),
    normCounterpartyIban,
    remittanceInfo.trim().toLowerCase().replace(/\s+/g, ' '),
    String(occurrenceIndex),
  ].join('|');

  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i += 1) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

const SEMANTIC_DUPLICATE_WINDOW_DAYS = 4;

/**
 * Parse a DKB CSV statement and run both:
 * 1. Matching pipeline (Own-IBAN physical transfer detector + prioritized Regex rules)
 * 2. Two-stage duplicate check against `existingTransactions` on `targetAccountId`:
 *    - `EXACT_HASH`: Exact canonical CSV fingerprint already imported -> locked (`isDuplicate=true`)
 *    - `SEMANTIC_MATCH`: Same signed amount within ±4 days with matching IBAN / counterparty /
 *      plannedPaymentId (e.g. a previously recorded manual pot settlement) -> deselected by default
 *      with clear explanation, preventing double bookings while allowing intentional override.
 */
export function parseAndMatchDkbCsv(
  csvText: string,
  targetAccountId: string,
  householdAccounts: Account[],
  rules: MatchingRule[],
  existingTransactions: Transaction[]
): {parserVariant: string; rows: ImportStagingRow[]} {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let headerIdx = -1;
  let parserVariant = 'DKB_MODERN_CSV';

  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (
      (lower.includes('buchungsdatum') || lower.includes('buchungstag')) &&
      lower.includes('betrag')
    ) {
      headerIdx = i;
      parserVariant = lower.includes('zahlungspflichtige')
        ? 'DKB_MODERN_CSV'
        : 'DKB_LEGACY_CSV';
      break;
    }
  }

  if (headerIdx === -1) {
    return {parserVariant: 'UNRECOGNIZED', rows: []};
  }

  const headers = splitSemicolonCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
  const findCol = (pred: (h: string) => boolean): number => headers.findIndex(pred);

  const idxBooking = findCol((h) => h.includes('buchungsdatum') || h.includes('buchungstag'));
  const idxValue = findCol((h) => h.includes('wertstellung'));
  const idxStatus = findCol((h) => h === 'status');
  const idxPayer = findCol((h) => h.includes('zahlungspflichtige'));
  const idxPayee = findCol(
    (h) => h.includes('zahlungsempf') || h.includes('auftraggeber') || h.includes('begünstigter')
  );
  const idxRemittance = findCol((h) => h.includes('verwendungszweck'));
  const idxAmount = findCol((h) => h.includes('betrag'));
  const idxIban = findCol((h) => h === 'iban' || h.includes('kontonummer'));

  const ownAccountsByIban = new Map<string, Account>();
  for (const acc of householdAccounts) {
    const norm = normalizeIban(acc.iban);
    if (norm && acc.id !== targetAccountId) {
      ownAccountsByIban.set(norm, acc);
    }
  }

  const accountExistingTxs = existingTransactions.filter(
    (tx) => tx.accountId === targetAccountId
  );
  const existingByHash = new Map<string, Transaction>();
  for (const tx of accountExistingTxs) {
    if (tx.importHash) {
      existingByHash.set(tx.importHash, tx);
    }
  }
  const consumedSemanticTxIds = new Set<string>();
  const occurrenceCounter = new Map<string, number>();

  const sortedRules = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);

  const stagingRows: ImportStagingRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = splitSemicolonCsvLine(lines[i]);
    if (cols.length < 4) continue;

    if (idxStatus >= 0) {
      const statusText = (cols[idxStatus] ?? '').toLowerCase();
      if (statusText.includes('vorgemerkt') || statusText === 'offen') continue;
    }

    const bookingDate = parseGermanDate(cols[idxBooking] ?? '');
    const valueDate = idxValue >= 0 ? parseGermanDate(cols[idxValue] ?? '') : bookingDate;
    const signedAmount = parseGermanDecimal(cols[idxAmount] ?? '0');
    if (Math.abs(signedAmount) < 0.005) continue;

    const absAmount = Math.abs(signedAmount);
    const payer = idxPayer >= 0 ? cols[idxPayer] ?? '' : '';
    const payee = idxPayee >= 0 ? cols[idxPayee] ?? '' : '';
    const counterpartyName =
      signedAmount < 0 ? payee || payer || 'Unbekannt' : payer || payee || 'Unbekannt';
    const remittanceInfo = idxRemittance >= 0 ? cols[idxRemittance] ?? '' : '';
    const rawIban = idxIban >= 0 ? cols[idxIban] ?? '' : '';
    const normCounterpartyIban = normalizeIban(rawIban);

    const occurrenceSig = `${bookingDate}|${signedAmount.toFixed(2)}|${normalizePartyName(
      counterpartyName
    )}|${normCounterpartyIban}|${remittanceInfo.trim().toLowerCase()}`;
    const nextOccIdx = (occurrenceCounter.get(occurrenceSig) ?? 0) + 1;
    occurrenceCounter.set(occurrenceSig, nextOccIdx);

    const importHash = computeCanonicalImportHash(
      targetAccountId,
      bookingDate,
      signedAmount,
      counterpartyName,
      normCounterpartyIban,
      remittanceInfo,
      nextOccIdx
    );

    const matchedOwnAccount = normCounterpartyIban
      ? ownAccountsByIban.get(normCounterpartyIban) ?? null
      : null;

    let detectedDirection =
      signedAmount < 0 ? TransactionDirection.OUTFLOW : TransactionDirection.INFLOW;
    let counterpartyAccountId: string | null = null;
    let suggestedCategoryId: string | null = null;
    let suggestedPlannedPaymentId: string | null = null;
    let matchSource = MatchSource.UNMATCHED;
    let matchConfidence = 0;
    let matchedRuleName: string | null = null;

    if (matchedOwnAccount) {
      detectedDirection = TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER;
      counterpartyAccountId = matchedOwnAccount.id;
      matchSource = MatchSource.OWN_IBAN_TRANSFER;
      matchConfidence = 1.0;
      matchedRuleName = `Eigene IBAN (${matchedOwnAccount.name})`;
    } else {
      for (const rule of sortedRules) {
        let cpOk = true;
        let remOk = true;
        try {
          if (rule.counterpartyPattern) {
            cpOk = new RegExp(rule.counterpartyPattern, 'i').test(counterpartyName);
          }
          if (rule.remittancePattern) {
            remOk = new RegExp(rule.remittancePattern, 'i').test(remittanceInfo);
          }
        } catch {
          cpOk = false;
          remOk = false;
        }
        if (cpOk && remOk) {
          suggestedCategoryId = rule.targetCategoryId;
          suggestedPlannedPaymentId = rule.targetPlannedPaymentId;
          matchSource = MatchSource.REGEX_RULE;
          matchConfidence = 0.95;
          matchedRuleName = rule.name;
          break;
        }
      }
    }

    // --- Two-Layer Deduplication Check ---
    let duplicateKind = DuplicateMatchKind.NONE;
    let duplicateOfTransactionId: string | null = null;
    let duplicateReason: string | null = null;

    const exactHit = existingByHash.get(importHash);
    if (exactHit) {
      duplicateKind = DuplicateMatchKind.EXACT_HASH;
      duplicateOfTransactionId = exactHit.id;
      duplicateReason = `Exakter CSV-Hash bereits verbucht (${exactHit.bookingDate})`;
    } else {
      const rowCents = toCents(signedAmount);
      const normRowParty = normalizePartyName(counterpartyName);

      for (const cand of accountExistingTxs) {
        if (consumedSemanticTxIds.has(cand.id)) continue;
        if (toCents(cand.amount) !== rowCents) continue;
        if (daysBetweenIsoDates(cand.bookingDate, bookingDate) > SEMANTIC_DUPLICATE_WINDOW_DAYS) {
          continue;
        }
        const candIban = normalizeIban(cand.counterpartyIban);
        const candParty = normalizePartyName(cand.counterpartyName);

        const ibanSame = Boolean(
          normCounterpartyIban && candIban && normCounterpartyIban === candIban
        );
        const partySame = Boolean(
          normRowParty &&
            candParty &&
            (normRowParty.includes(candParty) || candParty.includes(normRowParty))
        );
        const samePot = Boolean(
          suggestedPlannedPaymentId && cand.plannedPaymentId === suggestedPlannedPaymentId
        );

        if (ibanSame || partySame || samePot) {
          consumedSemanticTxIds.add(cand.id);
          duplicateKind = DuplicateMatchKind.SEMANTIC_MATCH;
          duplicateOfTransactionId = cand.id;
          duplicateReason = `Bereits am ${cand.bookingDate} gebucht (${cand.counterpartyName})`;
          break;
        }
      }
    }

    const isExactDuplicate = duplicateKind === DuplicateMatchKind.EXACT_HASH;
    const isAnyDuplicate = duplicateKind !== DuplicateMatchKind.NONE;

    stagingRows.push({
      rowNumber: stagingRows.length + 1,
      bookingDate,
      valueDate,
      amount: signedAmount,
      currency: 'EUR',
      counterpartyName,
      counterpartyIban: normCounterpartyIban || null,
      remittanceInfo,
      detectedDirection,
      counterpartyAccountId,
      suggestedCategoryId,
      suggestedPlannedPaymentId,
      matchSource,
      matchConfidence,
      matchedRuleName,
      isDuplicate: isExactDuplicate,
      duplicateKind,
      duplicateOfTransactionId,
      duplicateReason,
      selectedForCommit: !isAnyDuplicate && absAmount > 0,
      importHash,
    });
  }

  return {parserVariant, rows: stagingRows};
}

export function buildSampleDkbCsv(personalIban: string): string {
  return [
    '"Kontonummer:";"DE84 1203 0000 1020 3040 50 / Gemeinschaftskonto DKB"',
    '"Kontostand vom 28.04.2026:";"6.420,50 EUR"',
    '',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    '"03.04.2026";"03.04.2026";"Gebucht";"Gemeinschaftskonto DKB";"Hausverwaltung Süd GmbH";"Warmmiete April 2026 Whg 14";"Ausgang";"DE44500105175407324931";"-1.480,00";"DE98ZZZ09999999999";"MIETE-14";""',
    '"11.04.2026";"10.04.2026";"Gebucht";"Gemeinschaftskonto DKB";"HUK-COBURG Versicherung";"Jahresbeitrag Wohngebäude + Hausrat Police 99412";"Ausgang";"DE62763500000000019283";"-780,00";"DE45HUK00000054321";"HUK-99412";""',
    `"15.04.2026";"15.04.2026";"Gebucht";"Markus Weber";"Gemeinschaftskonto DKB";"Nachschuss Sonderumlage April";"Eingang";"${personalIban}";"350,00";"";"";""`,
    '"16.04.2026";"16.04.2026";"Gebucht";"Gemeinschaftskonto DKB";"REWE Markt GmbH";"Wocheneinkauf KW 16 Kartenzahlung";"Ausgang";"DE91370400440532013000";"-142,85";"";"";""',
    '"18.04.2026";"18.04.2026";"Gebucht";"Gemeinschaftskonto DKB";"ARD ZDF Deutschlandradio";"Rundfunkbeitrag Q2/2026 Beitragsnr 418291029";"Ausgang";"DE26370501980000001850";"-55,08";"DE09ZZZ00000009607";"GEZ-418";""',
    '"24.04.2026";"24.04.2026";"Gebucht";"Gemeinschaftskonto DKB";"Autohaus Hofmann";"TÜV-Nachprüfung & Wischerblätter";"Ausgang";"DE51700202700015829100";"-118,50";"";"";""',
    '"28.04.2026";"28.04.2026";"Vorgemerkt";"Gemeinschaftskonto DKB";"Bäckerei Schmidt";"Kartenzahlung vorgemerkt";"Ausgang";"";"-8,90";"";"";""',
  ].join('\n');
}
