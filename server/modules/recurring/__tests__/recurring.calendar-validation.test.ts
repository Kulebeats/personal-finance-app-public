import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorMiddleware } from "../../../utils/errorHandler";
import type { HouseholdContext } from "../../../middleware/householdGuard";
import recurringRoutes from "../recurring.routes";

const { read, actor } = vi.hoisted(() => ({
  read: vi.fn(),
  actor: { householdId: "calendar-household", userId: "calendar-reader", role: "member" } satisfies HouseholdContext,
}));
vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.householdContext = actor;
    next();
  },
}));
vi.mock("../../../services/recurring/RecurringCalendarQuery", () => ({ listRecurringCalendar: read }));

const app = express();
app.use("/api/recurring", recurringRoutes);
app.use(apiErrorMiddleware);

describe("Recurring calendar request validation", () => {
  beforeEach(() => read.mockReset());

  it.each([
    { from: "2026-11-01", to: "2026-12-31" },
    { from: "2026-11-15", to: "2026-11-01" },
    { from: "2026-02-30", to: "2026-02-28" },
    { from: "2026-11-01" },
    { from: "0000-11-01", to: "0000-11-30" },
  ])("rejects invalid calendar query %j before reading", async query => {
    const response = await request(app).get("/api/recurring/calendar").query(query);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false, error: { code: "VALIDATION_ERROR",
        fields: expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]),
      },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads an in-month query with the normal scoped calendar caller", async () => {
    const range = { from: "2026-11-01", to: "2026-11-30" };
    read.mockResolvedValue([]);
    const response = await request(app).get("/api/recurring/calendar").query(range).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith(actor, range);
    expect(response.body).toEqual({ success: true, data: [] });
  });
});
