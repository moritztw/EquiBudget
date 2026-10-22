import {
  AllocationCalculationResult,
  AllocationStrategyType,
  EarnerSplitBreakdown,
  IncomeSource,
  Person,
} from '../types/household';

export class AllocationEngine {
  /**
   * Calculates equitable spending split across household earners.
   *
   * Core Strategy: "Equal Remaining Amount" ("Gleiches Taschengeld")
   * Formula:
   *  Total Discretionary Pool = (Sum of Earners Net Income + Global Household Income) - Shared Expenses
   *  Target Discretionary Per Earner = Total Discretionary Pool / N_earners
   *  Contribution(Person_i) = NetIncome(Person_i) - Target Discretionary Per Earner
   *
   * This guarantees that every earning partner retains the EXACT SAME amount of discretionary
   * pocket money for personal leisure, personal investments, or hobbies, irrespective of wage disparity.
   */
  public static calculate(params: {
    strategy: AllocationStrategyType;
    persons: Person[];
    incomes: IncomeSource[];
    totalSharedExpenses: number;
    fixedRatioShares?: Record<string, number>; // personId -> percentage (0-100)
  }): AllocationCalculationResult {
    const { strategy, persons, incomes, totalSharedExpenses, fixedRatioShares } = params;

    // Filter active earners
    const earners = persons.filter((p) => p.isEarner);
    const earnerCount = earners.length;

    // Calculate Person Net Incomes (monthly normalized)
    const personIncomes: Record<string, number> = {};
    earners.forEach((p) => {
      personIncomes[p.id] = 0;
    });

    let totalGlobalHouseholdIncome = 0;

    incomes.forEach((inc) => {
      if (!inc.isActive) return;

      // Normalize to monthly
      let monthlyNet = inc.netAmount;
      if (inc.frequency === 'weekly') monthlyNet = (inc.netAmount * 52) / 12;
      else if (inc.frequency === 'quarterly') monthlyNet = inc.netAmount / 3;
      else if (inc.frequency === 'annually') monthlyNet = inc.netAmount / 12;

      if (inc.personId === null) {
        // Global household income (e.g., Kindergeld / Child allowance)
        totalGlobalHouseholdIncome += monthlyNet;
      } else if (personIncomes[inc.personId] !== undefined) {
        personIncomes[inc.personId] += monthlyNet;
      }
    });

    const totalEarnersNetIncome = Object.values(personIncomes).reduce(
      (sum, val) => sum + val,
      0
    );
    const totalNetIncome = totalEarnersNetIncome + totalGlobalHouseholdIncome;

    // Global income offsets shared expenses first
    const netExpensesToCover = Math.max(0, totalSharedExpenses - totalGlobalHouseholdIncome);
    const totalDiscretionaryPool = totalNetIncome - totalSharedExpenses;

    const explanation: string[] = [];

    let earnerSplits: EarnerSplitBreakdown[] = [];

    if (earnerCount === 0) {
      return {
        strategy,
        totalEarnersNetIncome: 0,
        totalGlobalHouseholdIncome,
        totalNetIncome,
        totalSharedExpenses,
        netExpensesToCover,
        totalDiscretionaryPool,
        perEarnerDiscretionaryTarget: 0,
        earnerSplits: [],
        mathematicalExplanation: ['No active earners registered in this household.'],
      };
    }

    if (strategy === 'EQUAL_REMAINING_AMOUNT') {
      const perEarnerDiscretionaryTarget = totalDiscretionaryPool / earnerCount;

      explanation.push(
        `Total Household Net Income = €${totalEarnersNetIncome.toFixed(2)} (Earners) + €${totalGlobalHouseholdIncome.toFixed(2)} (Global) = €${totalNetIncome.toFixed(2)}`
      );
      explanation.push(
        `Total Shared Expenses = €${totalSharedExpenses.toFixed(2)} (Net to cover after global income: €${netExpensesToCover.toFixed(2)})`
      );
      explanation.push(
        `Total Available Discretionary Pool = €${totalDiscretionaryPool.toFixed(2)} distributed equally among ${earnerCount} earner(s).`
      );
      explanation.push(
        `Target Equal Discretionary ("Taschengeld") = €${perEarnerDiscretionaryTarget.toFixed(2)} per person.`
      );

      earnerSplits = earners.map((earner) => {
        const net = personIncomes[earner.id] || 0;
        const incomeSharePercent =
          totalEarnersNetIncome > 0 ? (net / totalEarnersNetIncome) * 100 : 0;

        // Contribution = Net Income - Target Discretionary
        let contribution = net - perEarnerDiscretionaryTarget;
        const isDeficitSubsidized = contribution < 0;

        const contributionPercentOfIncome =
          net > 0 ? (contribution / net) * 100 : 0;

        return {
          personId: earner.id,
          personName: earner.name,
          netIncome: net,
          incomeSharePercent,
          contributionAmount: contribution,
          contributionPercentOfIncome,
          discretionaryRemaining: perEarnerDiscretionaryTarget,
          isDeficitSubsidized,
        };
      });

      return {
        strategy,
        totalEarnersNetIncome,
        totalGlobalHouseholdIncome,
        totalNetIncome,
        totalSharedExpenses,
        netExpensesToCover,
        totalDiscretionaryPool,
        perEarnerDiscretionaryTarget,
        earnerSplits,
        mathematicalExplanation: explanation,
      };
    } else if (strategy === 'PROPORTIONAL_INCOME') {
      // Split net expenses strictly proportional to earner net incomes
      explanation.push(
        `Shared expenses (€${netExpensesToCover.toFixed(2)}) are split strictly in proportion to each person's share of total earners income (€${totalEarnersNetIncome.toFixed(2)}).`
      );

      earnerSplits = earners.map((earner) => {
        const net = personIncomes[earner.id] || 0;
        const incomeSharePercent =
          totalEarnersNetIncome > 0 ? (net / totalEarnersNetIncome) * 100 : 0;
        const contribution = (incomeSharePercent / 100) * netExpensesToCover;
        const discretionary = net - contribution;
        const contributionPercentOfIncome =
          net > 0 ? (contribution / net) * 100 : 0;

        return {
          personId: earner.id,
          personName: earner.name,
          netIncome: net,
          incomeSharePercent,
          contributionAmount: contribution,
          contributionPercentOfIncome,
          discretionaryRemaining: discretionary,
        };
      });

      return {
        strategy,
        totalEarnersNetIncome,
        totalGlobalHouseholdIncome,
        totalNetIncome,
        totalSharedExpenses,
        netExpensesToCover,
        totalDiscretionaryPool,
        perEarnerDiscretionaryTarget: totalDiscretionaryPool / earnerCount,
        earnerSplits,
        mathematicalExplanation: explanation,
      };
    } else {
      // FIXED_RATIO (e.g., 50/50 or custom ratio)
      const defaultShare = 100 / earnerCount;
      explanation.push(
        `Shared expenses (€${netExpensesToCover.toFixed(2)}) are split according to predetermined fixed ratios.`
      );

      earnerSplits = earners.map((earner) => {
        const net = personIncomes[earner.id] || 0;
        const ratioPercent = fixedRatioShares?.[earner.id] ?? defaultShare;
        const contribution = (ratioPercent / 100) * netExpensesToCover;
        const discretionary = net - contribution;
        const contributionPercentOfIncome =
          net > 0 ? (contribution / net) * 100 : 0;

        return {
          personId: earner.id,
          personName: earner.name,
          netIncome: net,
          incomeSharePercent: ratioPercent,
          contributionAmount: contribution,
          contributionPercentOfIncome,
          discretionaryRemaining: discretionary,
        };
      });

      return {
        strategy: 'FIXED_RATIO',
        totalEarnersNetIncome,
        totalGlobalHouseholdIncome,
        totalNetIncome,
        totalSharedExpenses,
        netExpensesToCover,
        totalDiscretionaryPool,
        perEarnerDiscretionaryTarget: totalDiscretionaryPool / earnerCount,
        earnerSplits,
        mathematicalExplanation: explanation,
      };
    }
  }
}
