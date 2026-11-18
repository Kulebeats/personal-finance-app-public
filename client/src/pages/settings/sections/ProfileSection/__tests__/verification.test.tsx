import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProfileForm } from "../ProfileForm";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";

vi.mock("@/hooks/use-settings", () => {
  const profileData = {
    fullName: "Test User",
    displayName: "Test User",
    bannerUrl: "",
  };

  return {
    useProfile: () => ({
      data: profileData,
      isLoading: false,
      error: null,
    }),
    useUpdateProfile: () => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    }),
    useUploadProfilePicture: () => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    }),
    useDeleteProfilePicture: () => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    }),
  };
});

// Mock hook form context logic since ProfileForm expects to be used locally or via hook
// But wait, ProfileForm *uses* useProfileForm internally which returns 'form'.
// Let's rely on the mock above.

const queryClient = createTestQueryClient();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("ProfileForm Runtime Check", () => {
  it("renders without crashing", () => {
    try {
      render(
        <Wrapper>
          <ProfileForm />
        </Wrapper>
      );
    } catch (e) {
      console.error("Render Crash:", e);
      throw e;
    }

    // Check for some text to ensure it rendered
    expect(screen.getByText(/Display Name/i)).toBeInTheDocument();
  });
});
