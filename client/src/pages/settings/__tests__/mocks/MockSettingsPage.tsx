/**
 * Mock Settings Page for Integration Testing
 *
 * This is a simplified version of the Settings page used for integration testing.
 * It simulates the key behaviors needed to test user workflows.
 */

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface MockSettingsPageProps {
  defaultSection?: string;
}

interface ProfileData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumberMobile?: string;
  occupation?: string;
}

// Mock API functions (will be mocked by tests)
export const mockProfileApi = {
  getProfile: async () => {
    throw new Error("Mock not implemented");
  },
  updateProfile: async (data: any) => {
    throw new Error("Mock not implemented");
  },
};

export const mockCategoriesApi = {
  getCategories: async () => {
    throw new Error("Mock not implemented");
  },
};

export const mockMerchantsApi = {
  getMerchants: async () => {
    throw new Error("Mock not implemented");
  },
};

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; sectionName: string; onRetry: () => void },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div>
          <p>{this.props.sectionName} failed to load</p>
          <button
            role="button"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onRetry();
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function MockSettingsPage({
  defaultSection = "profile",
}: MockSettingsPageProps) {
  const [activeSection, setActiveSection] = useState(defaultSection);
  const [profileData, setProfileData] = useState({
    fullName: "",
    firstName: "",
    lastName: "",
    email: "",
    phoneNumberMobile: "",
    occupation: "",
  });
  const [isDirty, setIsDirty] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const queryClient = useQueryClient();

  // Profile query
  const { data: profileResponse, isLoading: profileLoading } =
    useQuery<ProfileData>({
      queryKey: ["profile"],
      queryFn: mockProfileApi.getProfile as () => Promise<ProfileData>,
      enabled: activeSection === "profile",
      retry: false,
    });

  // Profile mutation
  // React Query v5 invokes `mutationFn(variables, mutationContext)` — two args.
  // Forward only `data` so the spy on `updateProfile` is called with the single
  // payload the workflow test asserts against (instead of an extra context arg).
  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileData) => mockProfileApi.updateProfile(data),
    onSuccess: () => {
      toast.success("Profile updated successfully");
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: () => {
      toast.error("Failed to update profile");
    },
  });

  // Update local state when profile data loads
  useEffect(() => {
    if (profileResponse) {
      setProfileData({
        fullName: profileResponse.fullName || "",
        firstName: profileResponse.firstName || "",
        lastName: profileResponse.lastName || "",
        email: profileResponse.email || "",
        phoneNumberMobile: profileResponse.phoneNumberMobile || "",
        occupation: profileResponse.occupation || "",
      });
    }
  }, [profileResponse]);

  const sections = [
    { id: "profile", name: "Profile" },
    { id: "categories", name: "Categories" },
    { id: "merchants", name: "Merchants" },
    { id: "display", name: "Display" },
    { id: "notifications", name: "Notifications" },
    { id: "security", name: "Security" },
  ];

  const handleInputChange = (field: string, value: string) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateProfileMutation.mutateAsync(profileData);
    } catch (error) {
      // Mutation onError handles user feedback.
    }
  };

  const renderProfileSection = () => {
    if (profileLoading) {
      return <div data-testid="loading-skeleton">Loading...</div>;
    }

    return (
      <div>
        <h2>Profile</h2>
        <form>
          <div>
            <label htmlFor="fullName">Full Name</label>
            <input
              id="fullName"
              value={profileData.fullName}
              onChange={(e) => handleInputChange("fullName", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="phoneNumberMobile">Phone</label>
            <input
              id="phoneNumberMobile"
              value={profileData.phoneNumberMobile}
              onChange={(e) =>
                handleInputChange("phoneNumberMobile", e.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="occupation">Occupation</label>
            <input
              id="occupation"
              value={profileData.occupation}
              onChange={(e) => handleInputChange("occupation", e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateProfileMutation.isPending}
          >
            Save
          </button>
          {isDirty && <span>Unsaved changes</span>}
        </form>
      </div>
    );
  };

  const CategoriesSection = () => {
    const {
      data: categories,
      isLoading,
      error,
    } = useQuery<Array<{ id: string; name: string }>>({
      queryKey: ["categories", retryKey],
      queryFn: mockCategoriesApi.getCategories as () => Promise<
        Array<{ id: string; name: string }>
      >,
      retry: false,
    });

    if (isLoading) {
      return <div data-testid="loading-skeleton">Loading...</div>;
    }

    if (error) {
      return (
        <div>
          <p>Categories failed to load</p>
          <button
            role="button"
            onClick={() => setRetryKey((prev) => prev + 1)}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div>
        <h2>Categories</h2>
        {categories?.map((cat: any) => (
          <div key={cat.id}>{cat.name}</div>
        ))}
      </div>
    );
  };

  const MerchantsSection = () => {
    const {
      data: merchants,
      isLoading,
      error,
    } = useQuery<Array<{ id: string; name: string }>>({
      queryKey: ["merchants"],
      queryFn: mockMerchantsApi.getMerchants as () => Promise<
        Array<{ id: string; name: string }>
      >,
      retry: false,
    });

    if (isLoading) {
      return <div data-testid="loading-skeleton">Loading...</div>;
    }

    if (error) {
      return (
        <div>
          <p>Merchants failed to load</p>
          <button
            role="button"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["merchants"] })
            }
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div>
        <h2>Merchants</h2>
        {merchants?.map((merchant: any) => (
          <div key={merchant.id}>{merchant.name}</div>
        ))}
      </div>
    );
  };

  const renderSection = () => {
    switch (activeSection) {
      case "profile":
        return renderProfileSection();
      case "categories":
        return <CategoriesSection />;
      case "merchants":
        return <MerchantsSection />;
      default:
        return <div>Section: {activeSection}</div>;
    }
  };

  return (
    <div>
      <nav>
        {sections.map((section) => (
          <a
            key={section.id}
            role="link"
            className={activeSection === section.id ? "active" : ""}
            onClick={() => setActiveSection(section.id)}
            style={{
              cursor: "pointer",
              marginRight: "10px",
              fontWeight: activeSection === section.id ? "bold" : "normal",
            }}
          >
            {section.name}
          </a>
        ))}
      </nav>
      <main>{renderSection()}</main>
    </div>
  );
}
