import type { Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../core/errors";
import { success } from "../../core/http";
import { reconcileAccount, reconciliationSchema } from "../../services/account/AccountReconciliationService";

export async function reconcile(req: Request, res: Response): Promise<void> {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw new ValidationError("Invalid account ID", id.error.issues);
  const input = reconciliationSchema.safeParse(req.body);
  if (!input.success) throw new ValidationError("Invalid reconciliation", input.error.issues);
  const { householdId, userId } = req.householdContext!;
  const result = await reconcileAccount(id.data.toLowerCase(), householdId, userId, input.data);
  success(res, result);
}
