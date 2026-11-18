/**
 * Accounts Module Index
 *
 * Re-exports all account module components.
 *
 * @module modules/accounts
 */

// Routes
export { default as accountsRoutes } from "./accounts.routes";

// Controller
export { accountsController } from "./accounts.controller";

// Service (re-export from legacy for convenience)
export { accountService } from "../../services/AccountService";
