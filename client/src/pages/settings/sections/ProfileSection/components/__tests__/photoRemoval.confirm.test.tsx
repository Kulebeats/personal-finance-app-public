/**
 * @vitest-environment jsdom
 *
 * NEW-37: removing the cover photo or the profile picture asks through the
 * app's AlertDialog, never the browser's native confirm box. Confirm removes
 * once; Cancel and Escape remove nothing.
 */
import { useState, type ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BannerUpload } from "../BannerUpload";
import { ProfilePictureUpload } from "../ProfilePictureUpload";

const apiCall = vi.hoisted(() => vi.fn());
const deletePicture = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const PHOTO = "https://example.invalid/synthetic-photo.png";

vi.mock("@/lib/api", () => ({ apiCall }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/session/ProtectedImage", () => ({
  ProtectedImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("react-webcam", () => ({ default: () => null }));
vi.mock("@/hooks/use-settings", () => ({
  useProfile: () => ({ data: { profilePictureUrl: PHOTO, fullName: "Synthetic User" } }),
  useUploadProfilePicture: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProfilePicture: () => deletePicture,
}));

afterEach(() => {
  vi.restoreAllMocks();
  apiCall.mockReset();
  deletePicture.mutate.mockReset();
});

function Form({ children }: { children: ReactNode }) {
  const methods = useForm({ defaultValues: { bannerUrl: PHOTO, profilePicture: PHOTO } });
  const [client] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  return <QueryClientProvider client={client}><FormProvider {...methods}>{children}</FormProvider></QueryClientProvider>;
}

async function openRemoval(imageAlt: string, title: RegExp) {
  const user = userEvent.setup();
  const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getAllByAltText(imageAlt)[0]);
  const trigger = screen.getByRole("button", { name: /remove photo/i });
  await user.click(trigger);
  const dialog = await screen.findByRole("alertdialog", { name: title });
  return { user, nativeConfirm, trigger, dialog };
}

describe("cover photo removal", () => {
  const title = /remove cover photo\?/i;

  it("asks in the dialog and removes once on confirm", async () => {
    apiCall.mockResolvedValue({});
    render(<Form><BannerUpload userName="Synthetic User" /></Form>);
    const { user, nativeConfirm, dialog } = await openRemoval("Profile banner", title);
    expect(apiCall).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /^remove photo$/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1));
    expect(apiCall).toHaveBeenCalledWith("/settings/profile/banner", { method: "DELETE" });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Cancel removes nothing; Escape also cancels and returns focus", async () => {
    render(<Form><BannerUpload userName="Synthetic User" /></Form>);
    const { user, nativeConfirm, trigger, dialog } = await openRemoval("Profile banner", title);

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(trigger);
    await screen.findByRole("alertdialog", { name: title });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(apiCall).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});

describe("profile picture removal", () => {
  const title = /remove profile picture\?/i;

  it("asks in the dialog and removes once on confirm", async () => {
    render(<Form><ProfilePictureUpload /></Form>);
    const { user, nativeConfirm, dialog } = await openRemoval("Profile", title);
    expect(deletePicture.mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /^remove photo$/i }));

    expect(deletePicture.mutate).toHaveBeenCalledTimes(1);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("Cancel removes nothing; Escape also cancels and returns focus", async () => {
    render(<Form><ProfilePictureUpload /></Form>);
    const { user, nativeConfirm, trigger, dialog } = await openRemoval("Profile", title);

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(trigger);
    await screen.findByRole("alertdialog", { name: title });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(deletePicture.mutate).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
