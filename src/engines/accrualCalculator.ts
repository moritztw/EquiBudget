import { Frequency, RecurringExpense, VirtualSinkingFund } from '../types/household';

export interface AccrualProjection {
  fundId: string;
  fundName: string;
  currentBalance: number;
  monthlyAccrualRate: number;
  targetAmount: number;
  targetDate: string;
  monthsUntilDue: number;
  projectedBalanceAtDueDate: number;
  isFullyFundedOnTime: boolean;
  surplusOrDeficit: number;
  percentageFunded: number;
}

export class AccrualCalculator {
  /**
   * Converts any frequency to its exact monthly equivalent provision.
   * e.g.
   * - Annual €1,200 => €100.00 / month
   * - Semi-annual €600 => €100.00 / month
   * - Quarterly €450 => €150.00 / month
   * - Bi-monthly €300 => €150.00 / month
   * - Weekly €70 => €303.33 / month (70 * 52 / 12)
   */
  public static calculateMonthlyEquivalent(amount: number, frequency: Frequency): number {
    switch (frequency) {
      case 'weekly':
        return Number(((amount * 52) / 12).toFixed(2));
      case 'monthly':
        return Number(amount.toFixed(2));
      case 'bi_monthly':
        return Number((amount / 2).toFixed(2));
      case 'quarterly':
        return Number((amount / 3).toFixed(2));
      case 'semi_annually':
        return Number((amount / 6).toFixed(2));
      case 'annually':
        return Number((amount / 12).toFixed(2));
      default:
        return amount;
    }
  }

  /**
   * Projects future balance and determines if the sinking fund will meet the target before the debit date.
   */
  public static projectFund(
    fund: VirtualSinkingFund,
    currentDate: Date = new Date()
  ): AccrualProjection {
    const target = new Date(fund.targetDate);
    const diffTime = target.getTime() - currentDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const monthsUntilDue = Math.max(0, Math.ceil(diffDays / 30.4375));

    // Projected balance = currentBalance + (monthlyAccrualRate * monthsUntilDue)
    const projectedBalance = Number(
      (fund.currentBalance + fund.monthlyAccrualRate * monthsUntilDue).toFixed(2)
    );
    const surplusOrDeficit = Number(
      (projectedBalance - fund.targetAmount).toFixed(2)
    );
    const isFullyFundedOnTime = surplusOrDeficit >= -0.01;
    const percentageFunded =
      fund.targetAmount > 0
        ? Math.min(100, Math.round((fund.currentBalance / fund.targetAmount) * 100))
        : 100;

    return {
      fundId: fund.id,
      fundName: fund.name,
      currentBalance: fund.currentBalance,
      monthlyAccrualRate: fund.monthlyAccrualRate,
      targetAmount: fund.targetAmount,
      targetDate: fund.targetDate,
      monthsUntilDue,
      projectedBalanceAtDueDate: projectedBalance,
      isFullyFundedOnTime,
      surplusOrDeficit,
      percentageFunded,
    };
  }

  /**
   * Handles the actual bank debit when a periodic bill hits the checking account.
   * Offsets the accumulated virtual fund balance instead of impacting that month's operational budget!
   */
  public static offsetDebit(
    fund: VirtualSinkingFund,
    actualDebitAmount: number,
    nextTargetDate: string
  ): {
    updatedFund: VirtualSinkingFund;
    remainingBalance: number;
    wasCovered: boolean;
  } {
    const remainingBalance = Number((fund.currentBalance - actualDebitAmount).toFixed(2));
    const wasCovered = remainingBalance >= 0;

    const updatedFund: VirtualSinkingFund = {
      ...fund,
      currentBalance: remainingBalance,
      targetDate: nextTargetDate,
      lastAccruedAt: new Date().toISOString(),
      status: remainingBalance >= 0 ? 'accruing' : 'depleted',
    };

    return {
      updatedFund,
      remainingBalance,
      wasCovered,
    };
  }

  /**
   * Reallocates funds between virtual sinking buckets (e.g. surplus from Vacation fund to Car Repair).
   */
  public static reallocate(
    sourceFund: VirtualSinkingFund,
    targetFund: VirtualSinkingFund,
    amount: number
  ): { source: VirtualSinkingFund; target: VirtualSinkingFund } {
    if (amount <= 0 || sourceFund.currentBalance < amount) {
      throw new Error('Insufficient fund balance for reallocation');
    }

    return {
      source: {
        ...sourceFund,
        currentBalance: Number((sourceFund.currentBalance - amount).toFixed(2)),
      },
      target: {
        ...targetFund,
        currentBalance: Number((targetFund.currentBalance + amount).toFixed(2)),
      },
    };
  }
}
