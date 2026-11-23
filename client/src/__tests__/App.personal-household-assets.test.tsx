import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { clearCsrfToken } from "@/lib/csrf";

const profile = {
  id: "a", email: "ada@example.test", firstName: "Ada", lastName: "Person",
  fullName: "Ada Person", displayName: "Ada", birthday: "1990-01-01", gender: "female",
  nrc: "123456/78/1", socialLinks: { email: "ada@example.test" },
  profilePictureUrl: "/uploads/profiles/ada.png", bannerUrl: "/uploads/banners/ada.png",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("complete household-free personal profile", () => {
  let requests: string[];
  let bootstrapCount: number;
  let saved: Record<string, unknown> | null;
  let external: boolean;
  beforeEach(() => {
    requests = []; bootstrapCount = 0; saved = null; external = false; clearCsrfToken();
    window.history.replaceState({}, "", "/settings/profile");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push(url);
      if (url === "/api/auth/session") {
        if (++bootstrapCount > 1) return new Promise<Response>(() => {});
        return json({ success: true, data: { state: "verified_without_household", subject: { id: "a", email: profile.email, displayName: "Ada" } } });
      }
      if (url === "/api/settings/display") return json({ success: true, data: { settings: {} } });
      if (url === "/api/csrf-token") return json({ csrfToken: "personal-token" });
      if (url === "/api/settings/profile") {
        if (init?.method === "PUT") saved = JSON.parse(String(init.body));
        return json({ success: true, data: { profile: { ...profile, ...(external ? { profilePictureUrl: "https://images.example/avatar.png", bannerUrl: "/assets/banner.png" } : {}), ...saved } } });
      }
      if (url.startsWith("/uploads/")) return json({ error: { code: "HOUSEHOLD_NOT_FOUND", message: "Create a household first" } }, 404);
      throw new Error(`Unexpected personal-shell request: ${url}`);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

  it("keeps editable profile stable without requesting household uploads or erasing stored URLs", async () => {
    const view = render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue("Ada"), { timeout: 5000 });
    expect(requests.filter(url => url.startsWith("/uploads/"))).toEqual([]);
    expect(bootstrapCount).toBe(1);
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText("Edit Cover")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Adaline" } });
    fireEvent.submit(view.container.querySelector("#profile-form")!);
    await waitFor(() => expect(saved).toMatchObject({ firstName: "Adaline" }));
    // Stored image URLs cannot be erased by a profile save: the body never carries them
    // (only the upload endpoints write them, and the server refuses these keys).
    expect(saved).not.toHaveProperty("profilePictureUrl");
    expect(saved).not.toHaveProperty("bannerUrl");
    expect(bootstrapCount).toBe(1);
  });

  it("retains native external and static personal images without enabling household upload controls", async () => {
    external = true;
    const view = render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue("Ada"), { timeout: 5000 });
    expect(screen.getByRole("img", { name: "Profile" })).toHaveAttribute("src", "https://images.example/avatar.png");
    expect(screen.getByRole("img", { name: "Profile banner" })).toHaveAttribute("src", "/assets/banner.png");
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(requests.filter(url => url.startsWith("/uploads/") || url.startsWith("https://images.example"))).toEqual([]);
  });
});
