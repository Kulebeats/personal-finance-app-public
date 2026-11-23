import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePictureUpload } from "@/pages/settings/sections/ProfileSection/components/ProfilePictureUpload";
import { PushNotificationSetup } from "@/pages/settings/sections/NotificationsSection/PushNotificationSetup";
import { StepUpProvider } from "@/components/security/StepUpProvider";
import { createDataQueryClient } from "@/lib/queryClient";
import { requestStepUp } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";

vi.mock("react-webcam", async () => {
  const React = await import("react");
  return { default: React.forwardRef((_props, ref) => { React.useImperativeHandle(ref, () => ({ getScreenshot: () => "data:image/jpeg;base64,cGhvdG8=" })); return <p>Camera ready</p>; }) };
});
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
function CameraForm() { const form = useForm(); return <FormProvider {...form}><ProfilePictureUpload /></FormProvider>; }
const replace = () => { retireOperationLifetime(); activateOperationLifetime(createOperationLifetime()); };
const json = (data: unknown) => new Response(JSON.stringify(data));

describe("pre-transport protected preparation", () => {
  beforeEach(() => { clearCsrfToken(); activateOperationLifetime(createOperationLifetime()); });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); });

  it("does not upload a camera conversion which completed after identity changed", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => [{ kind: "videoinput" }] } });
    const conversion = deferred<Response>();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.startsWith("data:")) return conversion.promise;
      if (url === "/api/csrf-token") return json({ csrfToken: "token" });
      return json({ success: true, data: { profile: { id: "a", fullName: "Test Person" }, pictureUrl: "/picture" } });
    }));
    const client = createDataQueryClient();
    const view = render(<QueryClientProvider client={client}><CameraForm /></QueryClientProvider>);
    fireEvent.click(view.container.querySelector(".cursor-pointer")!);
    const tab = await screen.findByRole("tab", { name: "Camera" });
    expect((await screen.findAllByText("TP")).length).toBeGreaterThan(0);
    await waitFor(() => expect(tab).not.toBeDisabled());
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("button", { name: "Take Photo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use This Photo" }));
    await waitFor(() => expect(urls.some(url => url.startsWith("data:"))).toBe(true));
    replace();
    await act(async () => { conversion.resolve(new Response(new Blob(["photo"]))); });
    expect(urls).not.toContain("/api/settings/profile/picture");
    client.clear();
  });

  it("does not send push requests after a delayed permission decision changes identity", async () => {
    const permission = deferred<NotificationPermission>();
    const subscription = { endpoint: "test", toJSON: () => ({ endpoint: "test" }) };
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => null, subscribe: async () => subscription } }) } });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { requestPermission: () => permission.promise });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token" ? json({ csrfToken: "token" }) : json({ success: true, data: { publicKey: "cHVzaA" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<PushNotificationSetup />);
    fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
    replace();
    await act(async () => { permission.resolve("granted"); });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("settles queued step-up requests when the provider unmounts", async () => {
    const view = render(<StepUpProvider />);
    let settled: boolean | undefined;
    await act(async () => { void requestStepUp("SETTINGS").then(value => { settled = value; }); });
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(false);
  });
});
