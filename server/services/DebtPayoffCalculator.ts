export const PAYOFF_CONVENTIONS = {
  compoundingPeriod: "monthly" as const,
  dayCount: "30/360" as const,
  monthlyRate: (apr: number): number => apr / 100 / 12,
  negativeAmortization: {
    behavior: "cap_at_maximum" as const,
    maxBalanceMultiplier: 1.5,
  },
  maxTermMonths: 600,
  oneTimePaymentTiming: "immediate" as const,
  round: (amount: number): number => Number(amount.toFixed(2)),
};

export interface PaymentScheduleItem {
  month: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface PayoffScenario {
  monthlyPayment: number;
  payoffDate: string | null;
  totalInterest: number;
  totalPayment: number;
  monthsToPayoff: number | null;
  interestSavedVsMinimum: number;
  schedule: PaymentScheduleItem[];
}

export class DebtPayoffCalculator {
  calculatePayoff(
    balance: number,
    apr: number,
    monthlyPayment: number,
    oneTimePayment: number = 0
  ): PayoffScenario {
    const originalBalance = balance;
    let remaining = Math.max(0, balance - oneTimePayment);
    let totalInterest = 0;
    let totalPayment = Math.max(0, oneTimePayment);
    const schedule: PaymentScheduleItem[] = [];
    const monthlyRate = PAYOFF_CONVENTIONS.monthlyRate(apr);

    let months = 0;
    while (remaining > 0 && months < PAYOFF_CONVENTIONS.maxTermMonths) {
      const interest = remaining * monthlyRate;
      if (monthlyPayment <= interest) {
        remaining += interest;
        months += 1;
        if (
          remaining >
          originalBalance * PAYOFF_CONVENTIONS.negativeAmortization.maxBalanceMultiplier
        ) {
          return {
            monthlyPayment,
            payoffDate: null,
            totalInterest: PAYOFF_CONVENTIONS.round(totalInterest),
            totalPayment: PAYOFF_CONVENTIONS.round(totalPayment),
            monthsToPayoff: null,
            interestSavedVsMinimum: 0,
            schedule,
          };
        }
        continue;
      }

      const principal = monthlyPayment - interest;
      remaining = Math.max(0, remaining - principal);
      totalInterest += interest;
      totalPayment += monthlyPayment;
      months += 1;

      schedule.push({
        month: months,
        interest: PAYOFF_CONVENTIONS.round(interest),
        principal: PAYOFF_CONVENTIONS.round(principal),
        balance: PAYOFF_CONVENTIONS.round(remaining),
      });
    }

    const payoffDate = remaining <= 0
      ? this.addMonths(new Date(), months)
      : null;

    return {
      monthlyPayment,
      payoffDate,
      totalInterest: PAYOFF_CONVENTIONS.round(totalInterest),
      totalPayment: PAYOFF_CONVENTIONS.round(totalPayment),
      monthsToPayoff: remaining <= 0 ? months : null,
      interestSavedVsMinimum: 0,
      schedule,
    };
  }

  calculateScenarios(params: {
    balance: number;
    apr: number;
    minimumPayment: number;
    currentPayment: number;
    oneTimePayment?: number;
  }): {
    minimum: PayoffScenario;
    current: PayoffScenario;
    accelerated: PayoffScenario;
    aggressive: PayoffScenario;
  } {
    const minimum = this.calculatePayoff(
      params.balance,
      params.apr,
      params.minimumPayment,
      params.oneTimePayment ?? 0
    );

    const current = this.calculatePayoff(
      params.balance,
      params.apr,
      params.currentPayment,
      params.oneTimePayment ?? 0
    );

    const accelerated = this.calculatePayoff(
      params.balance,
      params.apr,
      Math.max(params.minimumPayment * 1.5, params.minimumPayment + 1),
      params.oneTimePayment ?? 0
    );

    const aggressive = this.calculatePayoff(
      params.balance,
      params.apr,
      Math.max(params.minimumPayment * 2, params.minimumPayment + 1),
      params.oneTimePayment ?? 0
    );

    const minimumInterest = minimum.totalInterest;

    return {
      minimum: { ...minimum, interestSavedVsMinimum: 0 },
      current: {
        ...current,
        interestSavedVsMinimum: PAYOFF_CONVENTIONS.round(
          Math.max(0, minimumInterest - current.totalInterest)
        ),
      },
      accelerated: {
        ...accelerated,
        interestSavedVsMinimum: PAYOFF_CONVENTIONS.round(
          Math.max(0, minimumInterest - accelerated.totalInterest)
        ),
      },
      aggressive: {
        ...aggressive,
        interestSavedVsMinimum: PAYOFF_CONVENTIONS.round(
          Math.max(0, minimumInterest - aggressive.totalInterest)
        ),
      },
    };
  }

  calculateRequiredPayment(
    balance: number,
    apr: number,
    months: number
  ): number {
    const monthlyRate = PAYOFF_CONVENTIONS.monthlyRate(apr);
    if (monthlyRate === 0) {
      return PAYOFF_CONVENTIONS.round(balance / months);
    }

    const payment =
      (balance * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);

    return PAYOFF_CONVENTIONS.round(payment);
  }

  calculateSnowball(
    debts: Array<{ id: string; balance: number; rate: number; minPayment: number }>
  ): Array<{ debtId: string; payoffOrder: number; payoffDate: string | null }> {
    const sorted = [...debts].sort((a, b) => a.balance - b.balance);

    let extraPayment = 0;
    const results = [];
    const today = new Date();

    for (let i = 0; i < sorted.length; i += 1) {
      const debt = sorted[i];
      const totalPayment = debt.minPayment + extraPayment;
      const scenario = this.calculatePayoff(debt.balance, debt.rate, totalPayment);

      const payoffDate = scenario.monthsToPayoff
        ? this.addMonths(new Date(today), scenario.monthsToPayoff)
        : null;

      results.push({
        debtId: debt.id,
        payoffOrder: i + 1,
        payoffDate,
      });

      extraPayment += debt.minPayment;
    }

    return results;
  }

  calculateAvalanche(
    debts: Array<{ id: string; balance: number; rate: number; minPayment: number }>
  ): Array<{ debtId: string; payoffOrder: number; payoffDate: string | null }> {
    const sorted = [...debts].sort((a, b) => b.rate - a.rate);

    let extraPayment = 0;
    const results = [];
    const today = new Date();

    for (let i = 0; i < sorted.length; i += 1) {
      const debt = sorted[i];
      const totalPayment = debt.minPayment + extraPayment;
      const scenario = this.calculatePayoff(debt.balance, debt.rate, totalPayment);

      const payoffDate = scenario.monthsToPayoff
        ? this.addMonths(new Date(today), scenario.monthsToPayoff)
        : null;

      results.push({
        debtId: debt.id,
        payoffOrder: i + 1,
        payoffDate,
      });

      extraPayment += debt.minPayment;
    }

    return results;
  }

  private addMonths(date: Date, months: number): string {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next.toISOString().split("T")[0];
  }
}

export const debtPayoffCalculator = new DebtPayoffCalculator();
