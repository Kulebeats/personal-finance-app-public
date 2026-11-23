import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../../core/errors";
import type { InvestmentSourceSession } from "./investmentTransactionAccess";
import { confirmSipOccurrence } from "../../services/investment/sipOccurrenceConfirmation";
import { listSipOccurrences } from "../../services/investment/sipOccurrenceRead";
import { safeSipOccurrenceError } from "../../services/investment/sipOccurrenceErrors";
import { getSipOccurrenceCalendar, setSipOccurrenceCalendar } from "../../services/investment/sipOccurrenceCalendar";
import { sipOccurrenceCalendarSchema, sipOccurrenceConfirmationPathSchema, sipOccurrenceConfirmationSchema,
  sipOccurrenceListQuerySchema, sipOccurrencePlanPathSchema } from "./investments.occurrences.validation";

function signedSession(req: Request): InvestmentSourceSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) {
    throw new UnauthorizedError("Authentication required");
  }
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const session = signedSession(req);
    const actor = { ...req.householdContext! };
    const path = sipOccurrencePlanPathSchema.safeParse(req.params);
    const query = sipOccurrenceListQuerySchema.safeParse(req.query);
    if (!path.success) throw new ValidationError("Invalid occurrence plan", path.error.errors);
    if (!query.success) throw new ValidationError("Invalid occurrence query", query.error.errors);
    const result = await listSipOccurrences(path.data.planId, query.data, actor, session);
    res.json({ success: true, ...result });
  } catch (error) {
    next(safeSipOccurrenceError(error));
  }
}

async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const session = signedSession(req);
    const actor = { ...req.householdContext! };
    const path = sipOccurrenceConfirmationPathSchema.safeParse(req.params);
    const command = sipOccurrenceConfirmationSchema.safeParse(req.body);
    if (!path.success) throw new ValidationError("Invalid occurrence identity", path.error.errors);
    if (!command.success) throw new ValidationError("Invalid occurrence confirmation", command.error.errors);
    const result = await confirmSipOccurrence(path.data.planId, path.data.scheduledDate, command.data, actor, session);
    res.json({ success: true, data: result });
  } catch (error) {
    next(safeSipOccurrenceError(error));
  }
}

async function getCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const session = signedSession(req);
    const actor = { ...req.householdContext! };
    const result = await getSipOccurrenceCalendar(actor, session);
    res.json({ success: true, data: result });
  } catch (error) {
    next(safeSipOccurrenceError(error));
  }
}

async function setCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const session = signedSession(req);
    const actor = { ...req.householdContext! };
    const command = sipOccurrenceCalendarSchema.safeParse(req.body);
    if (!command.success) throw new ValidationError("Invalid household calendar", command.error.errors);
    const result = await setSipOccurrenceCalendar(command.data.timeZone, actor, session);
    res.json({ success: true, data: result });
  } catch (error) {
    next(safeSipOccurrenceError(error));
  }
}

export const investmentOccurrencesController = { list, confirm, getCalendar, setCalendar };
