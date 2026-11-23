import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  members: vi.fn(),
  publish: vi.fn(),
  afterGoalRead: vi.fn(),
  goals: [
    { id: "unavailable-goal", householdId: "unavailable", type: "save_up", status: "on_track", name: "Synthetic B", targetDate: "2026-11-26" },
    { id: "available-goal", householdId: "available", type: "save_up", status: "on_track", name: "Synthetic A", targetDate: "2026-11-26" },
  ],
}));
vi.mock("../../../db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => {
    fakes.afterGoalRead();
    return fakes.goals;
  } }) }) },
  pool: {},
}));
vi.mock("../../../services/notification/audience", async original => ({
  ...await original<typeof import("../../../services/notification/audience")>(),
  notifiableMembers: fakes.members,
  goalsVisibleToMemberNow: async (_actor: unknown, ids: string[]) => fakes.goals.filter(goal => ids.includes(goal.id)),
}));
vi.mock("../../../services/NotificationService", () => ({ notificationService: { notifyDetailed: fakes.publish } }));
vi.mock("../../../utils/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { SCHEDULED_JOBS } from "../jobRegistry";
import { PARTIAL_FAILURE, runScheduledJob, type JobRunDependencies } from "../scheduledJob";

const slot = new Date("2026-11-23T12:00:00.000Z");
const deps: JobRunDependencies = {
  withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
  hasCompletedPeriod: async () => false,
  startRun: async () => "synthetic-run",
  renewRun: async () => {},
  finishRun: async () => {},
};

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("registered goal notices", () => {
  it.each(["goals.weekly-report", "goals.deadlines"] as const)(
    "%s continues past a household's member lookup and a recipient failure",
    async (name) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(slot);
      vi.stubEnv("GOAL_DEADLINE_REMINDER_DAYS", "7");
      fakes.members.mockImplementation(async (householdId: string) => {
        if (householdId === "unavailable") throw new Error("synthetic household lookup failure");
        return ["first", "rejected", "last"].map(userId => ({ householdId, userId, role: "member" }));
      });
      fakes.publish.mockImplementation(async (userId: string) => {
        if (userId === "first") throw new Error("synthetic recipient failure");
        if (userId === "rejected") return { delivered: true, channels: { email: "failed" } };
        return { delivered: true, channels: { email: "sent" } };
      });
      const job = SCHEDULED_JOBS.find(candidate => candidate.name === name)!;

      const result = await runScheduledJob(job, deps, slot);

      expect(result).toMatchObject({ status: "failed", errorCode: PARTIAL_FAILURE,
        summary: { failed: 3, [name === "goals.deadlines" ? "remindersSent" : "notificationsSent"]: 2 } });
      expect(fakes.members.mock.calls).toEqual([["unavailable"], ["available"]]);
      expect(fakes.publish.mock.calls.map(([recipient]) => recipient)).toEqual(["first", "rejected", "last"]);
    },
  );

  it.each([
    ["goals.weekly-report", "2026-11-29T23:52:00Z", "2026-11-30T00:00:00Z"],
    ["goals.deadlines", "2026-11-23T23:52:00Z", "2026-11-24T00:00:00Z"],
  ] as const)("%s leaves the old period open if its query crosses UTC midnight", async (name, before, after) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(before));
    vi.stubEnv("GOAL_DEADLINE_REMINDER_DAYS", "7");
    fakes.afterGoalRead.mockImplementation(() => vi.setSystemTime(new Date(after)));
    fakes.members.mockResolvedValue([{ householdId: "available", userId: "recipient", role: "member" }]);
    fakes.publish.mockResolvedValue({ delivered: true, channels: { email: "sent" } });
    const job = SCHEDULED_JOBS.find(candidate => candidate.name === name)!;

    const finishRun = vi.fn();
    expect(await runScheduledJob(job, { ...deps, finishRun }, new Date(before))).toMatchObject({ status: "failed" });
    expect(finishRun).toHaveBeenCalledWith("synthetic-run", expect.objectContaining({ isOk: false }));
    expect(fakes.publish).not.toHaveBeenCalled();
  });
});
