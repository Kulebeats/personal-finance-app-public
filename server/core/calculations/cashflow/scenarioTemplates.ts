/**
 * Custom Forecast Scenario Templates Module
 *
 * Pre-built scenario templates for common "what-if" analysis questions.
 *
 * @module core/calculations/cashflow/scenarioTemplates
 */

import type { ForecastScenario, ScenarioModification } from "./scenarios";

/**
 * Pre-built scenario templates for common what-if questions.
 */
export type ScenarioTemplate =
  | "income_increase_10"
  | "income_increase_20"
  | "income_decrease_10"
  | "expense_reduction_10"
  | "expense_reduction_20"
  | "emergency_expense"
  | "new_recurring_expense"
  | "job_loss"
  | "promotion";

/**
 * Get a pre-built scenario template.
 *
 * @param template - Template name
 * @param baseCurrency - Currency for fixed amounts
 * @returns Complete scenario based on template
 */
export function getScenarioTemplate(
  template: ScenarioTemplate,
  baseCurrency: string
): ForecastScenario {
  const now = new Date().toISOString();

  switch (template) {
    case "income_increase_10":
      return {
        id: `template-${template}`,
        name: "10% Income Increase",
        description: "What if my income increased by 10%?",
        modifications: [
          {
            id: "mod-1",
            name: "Income +10%",
            target: "income",
            type: "percentage_change",
            percentageChange: 10,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "income_increase_20":
      return {
        id: `template-${template}`,
        name: "20% Income Increase",
        description: "What if my income increased by 20% (promotion, raise)?",
        modifications: [
          {
            id: "mod-1",
            name: "Income +20%",
            target: "income",
            type: "percentage_change",
            percentageChange: 20,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "income_decrease_10":
      return {
        id: `template-${template}`,
        name: "10% Income Decrease",
        description: "What if my income decreased by 10%?",
        modifications: [
          {
            id: "mod-1",
            name: "Income -10%",
            target: "income",
            type: "percentage_change",
            percentageChange: -10,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "expense_reduction_10":
      return {
        id: `template-${template}`,
        name: "10% Expense Reduction",
        description: "What if I reduced expenses by 10%?",
        modifications: [
          {
            id: "mod-1",
            name: "Expenses -10%",
            target: "expenses",
            type: "percentage_change",
            percentageChange: -10,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "expense_reduction_20":
      return {
        id: `template-${template}`,
        name: "20% Expense Reduction",
        description: "What if I aggressively cut expenses by 20%?",
        modifications: [
          {
            id: "mod-1",
            name: "Expenses -20%",
            target: "expenses",
            type: "percentage_change",
            percentageChange: -20,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "emergency_expense":
      return {
        id: `template-${template}`,
        name: "Emergency Expense",
        description: "What if I had a $2,000 emergency expense in month 1?",
        modifications: [
          {
            id: "mod-1",
            name: "Emergency +$2000",
            target: "expenses",
            type: "fixed_change",
            fixedChange: "2000",
            applicableMonths: [0], // Only first month
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "new_recurring_expense":
      return {
        id: `template-${template}`,
        name: "New Monthly Expense",
        description: "What if I added a $200/month recurring expense?",
        modifications: [
          {
            id: "mod-1",
            name: "New expense +$200/mo",
            target: "expenses",
            type: "fixed_change",
            fixedChange: "200",
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "job_loss":
      return {
        id: `template-${template}`,
        name: "Job Loss Scenario",
        description: "What if I lost my job (income to $0)?",
        modifications: [
          {
            id: "mod-1",
            name: "Zero income",
            target: "income",
            type: "fixed_value",
            fixedValue: "0",
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    case "promotion":
      return {
        id: `template-${template}`,
        name: "Promotion Scenario",
        description: "What if I got a 30% raise and my expenses increased 10%?",
        modifications: [
          {
            id: "mod-1",
            name: "Salary +30%",
            target: "income",
            type: "percentage_change",
            percentageChange: 30,
          },
          {
            id: "mod-2",
            name: "Lifestyle creep +10%",
            target: "expenses",
            type: "percentage_change",
            percentageChange: 10,
          },
        ],
        isBaseline: false,
        createdAt: now,
      };

    default:
      // Return baseline (no changes)
      return {
        id: "baseline",
        name: "Baseline",
        description: "Current projection without modifications",
        modifications: [],
        isBaseline: true,
        createdAt: now,
      };
  }
}

/**
 * Get all available scenario templates.
 */
export function getAllScenarioTemplates(): ScenarioTemplate[] {
  return [
    "income_increase_10",
    "income_increase_20",
    "income_decrease_10",
    "expense_reduction_10",
    "expense_reduction_20",
    "emergency_expense",
    "new_recurring_expense",
    "job_loss",
    "promotion",
  ];
}

/**
 * Create a custom scenario from user inputs.
 *
 * @param name - Scenario name
 * @param description - User description
 * @param modifications - List of modifications
 * @returns Complete scenario object
 */
export function createCustomScenario(
  name: string,
  description: string,
  modifications: ScenarioModification[]
): ForecastScenario {
  return {
    id: `custom-${Date.now()}`,
    name,
    description,
    modifications,
    isBaseline: false,
    createdAt: new Date().toISOString(),
  };
}
