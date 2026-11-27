import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { AddGrzBondModal } from "../AddGrzBondModal";
import { AddGrzTBillModal } from "../AddGrzTBillModal";

vi.mock("@/hooks/useGrzSecurities", () => ({
  useCreateGrzBond: () => ({ mutateAsync: vi.fn() }),
  useCreateGrzTBill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [], isLoading: false, isError: false }) }));

// NEW-15: 22:30 UTC on 22 November is 00:30 on 23 November in Lusaka (UTC+2).
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T22:30:00Z"));
  setHouseholdCalendarTimeZone("Africa/Lusaka"); await Promise.resolve(); // subscribers hear of it in a microtask
});
afterEach(async () => { cleanup(); vi.useRealTimers(); setHouseholdCalendarTimeZone(null); await Promise.resolve(); });

it("NEW-15: a new GRZ bond defaults its purchase date to the household's day, not UTC's", () => {
  render(<AddGrzBondModal open><button>Record</button></AddGrzBondModal>);
  expect(screen.getByLabelText("Purchase Date")).toHaveValue("2026-11-23");
});

it("NEW-15: a new GRZ T-bill defaults purchase to the household's day and maturity 91 days on", () => {
  render(<AddGrzTBillModal open><button>Record</button></AddGrzTBillModal>);
  expect(screen.getByLabelText("Purchase Date")).toHaveValue("2026-11-23");
  expect(screen.getByLabelText("Maturity Date")).toHaveValue("2027-02-22");
});
