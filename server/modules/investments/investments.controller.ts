/**
 * Investments Controller - Main Entry Point
 * Re-exports all sub-controllers for backward compatibility
 *
 * @module modules/investments/controller
 */

import { investmentsSecuritiesController } from "./investments.securities.controller";
import { investmentsHoldingsController } from "./investments.holdings.controller";
import { investmentsPortfolioController } from "./investments.portfolio.controller";
import { investmentsTransactionsController } from "./investments.transactions.controller";
import { investmentsFxController } from "./investments.fx.controller";

// Re-export sub-controllers
export { investmentsSecuritiesController } from "./investments.securities.controller";
export { investmentsHoldingsController } from "./investments.holdings.controller";
export { investmentsPortfolioController } from "./investments.portfolio.controller";
export { investmentsTransactionsController } from "./investments.transactions.controller";
export { investmentsFxController } from "./investments.fx.controller";

// Combined export for backward compatibility with routes
export const investmentsController = {
  // Securities
  ...investmentsSecuritiesController,
  // Holdings
  ...investmentsHoldingsController,
  // Portfolio
  ...investmentsPortfolioController,
  // Transactions
  ...investmentsTransactionsController,
  // FX
  ...investmentsFxController,
};
