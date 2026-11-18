import { AccountImportService } from "./AccountImportService";

export class AccountService extends AccountImportService {}

export const accountService = new AccountService();
