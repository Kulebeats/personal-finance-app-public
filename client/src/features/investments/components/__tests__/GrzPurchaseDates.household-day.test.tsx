import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { AddGrzBondModal } from "../AddGrzBondModal";
import { AddGrzTBillModal } from "../AddGrzTBillModal";

vi.mock("@/hooks/useGrzSecurities", () => ({
  useCreateGrzBond: () => ({ mutateAsync: vi.fn() }),
  useCreateGrzTBill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [], isLoading: false, isError: false }) }));

// NEW-15: 22:30 UTC on 22 November is 00:30 on 23 November in Lusaka (UTC+2).
async function setZones(household: string | null, display: string | null) {
  setHouseholdCalendarTimeZone(household); setCalendarTimeZone(display);
  await Promise.resolve(); // subscribers hear of it in a microtask
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T22:30:00Z")); });
afterEach(async () => { cleanup(); vi.useRealTimers(); await setZones(null, null); });

// A household with no zone follows the server's UTC day, even when the member's display zone is Lusaka.
const cases = [["Africa/Lusaka", null, "2026-11-23", "2027-02-22"], [null, "Africa/Lusaka", "2026-11-22", "2027-02-21"]] as const;

it.each(cases)("NEW-15: a new GRZ bond defaults its purchase date to the server's household day (household %s, display %s)",
  async (household, display, purchase) => {
    await setZones(household, display);
    render(<AddGrzBondModal open><button>Record</button></AddGrzBondModal>);
    expect(screen.getByLabelText("Purchase Date")).toHaveValue(purchase);
  });

it.each(cases)("NEW-15: a new GRZ T-bill defaults purchase and 91-day maturity to the server's household day (household %s, display %s)",
  async (household, display, purchase, maturity) => {
    await setZones(household, display);
    render(<AddGrzTBillModal open><button>Record</button></AddGrzTBillModal>);
    expect(screen.getByLabelText("Purchase Date")).toHaveValue(purchase);
    expect(screen.getByLabelText("Maturity Date")).toHaveValue(maturity);
  });

it("NEW-15: a household zone that arrives after the GRZ forms mount is used when they open", async () => {
  const bond = render(<AddGrzBondModal open={false} onOpenChange={vi.fn()}><button>Record</button></AddGrzBondModal>);
  const bill = render(<AddGrzTBillModal open={false} onOpenChange={vi.fn()}><button>Record</button></AddGrzTBillModal>);
  await act(() => setZones("Africa/Lusaka", null));
  bond.rerender(<AddGrzBondModal open onOpenChange={vi.fn()}><button>Record</button></AddGrzBondModal>);
  expect(screen.getByLabelText("Purchase Date")).toHaveValue("2026-11-23");
  bond.unmount();
  bill.rerender(<AddGrzTBillModal open onOpenChange={vi.fn()}><button>Record</button></AddGrzTBillModal>);
  expect(screen.getByLabelText("Purchase Date")).toHaveValue("2026-11-23");
  expect(screen.getByLabelText("Maturity Date")).toHaveValue("2027-02-22");
});
