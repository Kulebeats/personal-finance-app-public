import { AccountAuditedWriteService } from "./AccountAuditedWrites";

export class AccountService extends AccountAuditedWriteService {}

export const accountService = new AccountService();
