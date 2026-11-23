import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ACTION_ERROR_FALLBACK, toastActionError } from "../actionErrorToast";

const SERVER_TEXT = 'duplicate key value violates unique constraint "presets_pkey"';

afterEach(() => vi.restoreAllMocks());

describe("toastActionError", () => {
  it("titles the toast with the action and describes the error in plain copy, never the server text", () => {
    const display = vi.spyOn(toast, "error");
    toastActionError("Failed to delete preset", Object.assign(new Error(SERVER_TEXT), { status: 409 }));
    expect(display).toHaveBeenCalledWith("Failed to delete preset", {
      description: "This was changed elsewhere or already exists. Refresh the page and try again.",
    });
  });

  it("asks the user to try again when the error says nothing more", () => {
    const display = vi.spyOn(toast, "error");
    toastActionError("Failed to delete preset", new Error(SERVER_TEXT));
    expect(display).toHaveBeenCalledWith("Failed to delete preset", { description: ACTION_ERROR_FALLBACK });
  });
});
