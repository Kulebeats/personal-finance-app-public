import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PersonalExportItem } from "@shared/personal-data-export";

const mocks = vi.hoisted(() => ({
  apiCall: vi.fn(),
  downloadProtectedResource: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiCall: mocks.apiCall }));
vi.mock("@/lib/protected-media", () => ({ downloadProtectedResource: mocks.downloadProtectedResource }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PersonalDataExportCard } from "../PersonalDataExportCard";

const ready: PersonalExportItem = {
  id: "11111111-1111-4111-8111-111111111111", status: "ready", fileFormat: "json",
  createdAt: "2026-11-17T08:00:00Z", expiresAt: "2026-11-24T08:00:00Z", sizeBytes: 2048, recordCount: 12,
  sections: null, downloadUrl: "/api/settings/privacy/exports/11111111-1111-4111-8111-111111111111/download",
};
const expired: PersonalExportItem = {
  ...ready, id: "22222222-2222-4222-8222-222222222222", status: "expired", downloadUrl: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PersonalDataExportCard /></QueryClientProvider>);
}

describe("PersonalDataExportCard", () => {
  beforeEach(() => {
    mocks.apiCall.mockReset();
    mocks.downloadProtectedResource.mockReset();
  });

  it("requests a new export with a POST and downloads a ready one through the authenticated fetch", async () => {
    mocks.apiCall.mockImplementation(async (endpoint: string) =>
      endpoint === "/settings/privacy/exports" ? { success: true, data: [ready, expired] } : { success: true, data: ready });
    mocks.downloadProtectedResource.mockResolvedValue(undefined);
    renderCard();

    const downloads = await screen.findAllByRole("button", { name: /^Download the export/ });
    // Only the ready export offers a download.
    expect(downloads).toHaveLength(1);
    expect(screen.getByText(/^Expired · 12 records$/)).toBeTruthy();

    await userEvent.click(downloads[0]);
    await waitFor(() => expect(mocks.downloadProtectedResource).toHaveBeenCalledWith(ready.downloadUrl));

    await userEvent.click(screen.getByRole("button", { name: "Export my data" }));
    await waitFor(() => expect(mocks.apiCall).toHaveBeenCalledWith("/settings/privacy/export", { method: "POST", body: "{}" }));
  });

  it("says so when there are no exports yet", async () => {
    mocks.apiCall.mockResolvedValue({ success: true, data: [] });
    renderCard();
    expect(await screen.findByText("You have not exported your data yet.")).toBeTruthy();
  });
});
