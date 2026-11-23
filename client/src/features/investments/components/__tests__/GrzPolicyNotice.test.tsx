/**
 * NEW-35: the GRZ conventions come from the server's meta.policy and are shown
 * as labelled policy defaults pending OI-03, never as current rules.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrzPolicyNotice } from "../GrzPolicyNotice";

const policy = {
  status: "policy_default_pending_OI-03",
  label: "Policy default, pending OI-03",
  couponWithholding: { rule: "Withholding on each scheduled bond coupon", value: "0.15" },
  tbillDiscountWithholding: { rule: "Withholding on a T-bill's discount", value: "0.15" },
  principalWithholding: { rule: "Withholding on returned bond principal", value: "0" },
  bondSaleWithholding: { rule: "Withholding on a bond sale's proceeds", value: "0" },
  tbillYieldDayBasis: { rule: "Recorded T-bill yield", value: "ACT/365" },
  auctionYieldDayBasis: { rule: "T-bill auction calculator", value: "ACT/360" },
  accruedInterestDayCount: { rule: "Accrued interest calculator default", value: "ACT/365" },
};

function renderWith(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<GrzPolicyNotice />, { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GrzPolicyNotice", () => {
  it("shows the server's conventions under the pending-OI-03 label, fractions as percentages", async () => {
    renderWith({ success: true, data: [], meta: { policy } });

    const notice = await screen.findByTestId("grz-policy-notice");
    expect(within(notice).getByText("Policy default, pending OI-03")).toBeInTheDocument();
    expect(within(notice).getByText(/not a statement of current tax law/)).toBeInTheDocument();
    const coupon = within(notice).getByText("Coupon withholding").closest("div")!;
    expect(within(coupon).getByText("15%")).toBeInTheDocument();
    const auction = within(notice).getByText("Auction calculator day basis").closest("div")!;
    expect(within(auction).getByText("ACT/360")).toBeInTheDocument();
  });

  it("shows nothing when the server sends no policy", async () => {
    const { container } = renderWith({ success: true, data: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
