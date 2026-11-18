/**
 * Investments Module Index
 *
 * @module modules/investments
 */

export { default as investmentsRoutes } from "./investments.routes";
export { investmentsController } from "./investments.controller";
export { investmentsSecuritiesController } from "./investments.securities.controller";
export { investmentsHoldingsController } from "./investments.holdings.controller";
export { investmentsPortfolioController } from "./investments.portfolio.controller";
export { investmentsTransactionsController } from "./investments.transactions.controller";
export { investmentsFxController } from "./investments.fx.controller";
export * from "./investments.service";
export * from "./investments.types";
