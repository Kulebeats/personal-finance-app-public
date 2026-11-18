import React, { useState } from "react";
import { FormProvider } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, User, Phone, Wallet } from "lucide-react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { useProfileForm } from "./useProfileForm";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-settings";

// Sub-components
import { ProfilePersonalFields } from "./components/ProfilePersonalFields";
import { ContactFields } from "./components/ContactFields";
import { FinancialProfileFields } from "./components/FinancialProfileFields";
import { ProfileCompletenessWidget } from "./components/ProfileCompletenessWidget";

export function ProfileForm() {
  const { form, isLoading, isSubmitting, onSubmit } = useProfileForm();
  const { data: profile } = useProfile();
  const {
    formState: { errors },
  } = form;
  const [activeTab, setActiveTab] = useState("personal");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const success = await onSubmit();
      if (success) {
        toast.success("Profile updated successfully");
      } else {
        // Find which tab has errors and switch to it
        const errorFields = Object.keys(errors);

        // Map fields to tabs
        const fieldToTab: Record<string, string> = {
          firstName: "personal",
          lastName: "personal",
          fullName: "personal",
          birthday: "personal",
          gender: "personal",
          nrc: "personal",
          profilePicture: "personal",
          bannerUrl: "personal",
          phoneNumberMobile: "contact",
          phoneNumberWork: "contact",
          address: "contact",
          employmentStatus: "financial",
          annualIncome: "financial",
          investmentGoal: "financial",
          riskTolerance: "financial",
        };

        const firstErrorField = errorFields[0];
        const targetTab =
          fieldToTab[firstErrorField] ||
          (firstErrorField.startsWith("socialLinks") ? "personal" : null);

        if (targetTab) {
          setActiveTab(targetTab);
        }

        // Generate a more helpful error message
        const missingFieldNames = errorFields.map((field) => {
          // simple mapping to user friendly names
          const names: Record<string, string> = {
            firstName: "First Name",
            lastName: "Last Name",
            fullName: "Display Name",
            birthday: "Date of Birth",
            gender: "Gender",
            nrc: "NRC",
            profilePicture: "Profile Picture",
            bannerUrl: "Cover Photo",
            "socialLinks.email": "Email",
            address: "Address/City",
          };
          return names[field] || field;
        });

        toast.error("Profile update failed", {
          description: `Please fix errors in: ${missingFieldNames.join(", ")}`,
        });
      }
    } catch (error) {
      toast.error("Failed to update profile", {
        description: "An unexpected error occurred. Please try again.",
      });
    }
  };

  const handleTabChange = async (newTab: string) => {
    if (activeTab === "personal" && newTab !== "personal") {
      // Validate mandatory fields before leaving personal tab
      const valid = await form.trigger([
        "firstName",
        "lastName",
        "birthday",
        "gender",
        "nrc",
        "socialLinks.email",
      ]);

      if (!valid) {
        toast.error("Please fill in all mandatory fields before proceeding.", {
          description:
            "First Name, Last Name, DOB, Gender, NRC, and Email are required.",
        });
        return;
      }
    }
    setActiveTab(newTab);
  };

  return (
    <SettingsCard
      title="Profile"
      description="Manage your personal information"
      isLoading={isLoading}
      action={
        <div className="flex items-center gap-4">
          <FormProvider {...form}>
            {/* Nano Widget needs context */}
            <ProfileCompletenessWidget />
          </FormProvider>

          <Button
            type="submit"
            form="profile-form"
            disabled={isSubmitting}
            className="bg-rose-400 hover:bg-rose-500 text-white min-w-[100px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      }
    >
      <FormProvider {...form}>
        <form id="profile-form" onSubmit={handleSubmit} className="space-y-6">
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3 mb-8">
              <TabsTrigger value="personal" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Personal
              </TabsTrigger>
              <TabsTrigger value="contact" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Contact
              </TabsTrigger>
              <TabsTrigger
                value="financial"
                className="flex items-center gap-2"
              >
                <Wallet className="h-4 w-4" />
                Financial
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: PERSONAL */}
            <TabsContent value="personal">
              <ProfilePersonalFields form={form} profile={profile} />
            </TabsContent>

            {/* TAB 2: CONTACT */}
            <TabsContent value="contact">
              <ContactFields form={form} />
            </TabsContent>

            {/* TAB 3: FINANCIAL */}
            <TabsContent value="financial">
              <FinancialProfileFields form={form} />
            </TabsContent>
          </Tabs>
        </form>
      </FormProvider>
    </SettingsCard>
  );
}

export default ProfileForm;
