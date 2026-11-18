import React from "react";
import { Controller, UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FormField } from "@/features/settings/components/FormField";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";
import { Linkedin, Twitter, Globe, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SocialLinksFieldsProps {
  form: UseFormReturn<ProfileFormData>;
}

export function SocialLinksFields({ form }: SocialLinksFieldsProps) {
  const {
    control,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium">Social Links</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-4 h-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[250px]">
              <p className="text-sm">
                Add your social profiles to help others connect with you. All
                fields are optional.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LinkedIn */}
        <Controller
          name="socialLinks.linkedin"
          control={control}
          render={({ field }) => (
            <FormField
              label="LinkedIn"
              error={errors.socialLinks?.linkedin?.message}
              htmlFor="linkedin"
            >
              <div className="relative">
                <Linkedin className="absolute left-3 top-2.5 h-4 w-4 text-[#0A66C2] z-10 pointer-events-none" />
                <Input
                  {...field}
                  value={field.value || ""}
                  id="linkedin"
                  placeholder="https://linkedin.com/in/username"
                  className="pl-10 input-glass"
                />
              </div>
            </FormField>
          )}
        />

        {/* Facebook */}
        <Controller
          name="socialLinks.facebook"
          control={control}
          render={({ field }) => (
            <FormField
              label="Facebook"
              error={errors.socialLinks?.facebook?.message}
              htmlFor="facebook"
            >
              <div className="relative">
                <svg
                  className="absolute left-3 top-2.5 h-4 w-4 text-[#1877F2] z-10 pointer-events-none"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                <Input
                  {...field}
                  value={field.value || ""}
                  id="facebook"
                  placeholder="https://facebook.com/username"
                  className="pl-10 input-glass"
                />
              </div>
            </FormField>
          )}
        />

        {/* Twitter/X */}
        <Controller
          name="socialLinks.twitter"
          control={control}
          render={({ field }) => (
            <FormField
              label="Twitter / X"
              error={errors.socialLinks?.twitter?.message}
              htmlFor="twitter"
            >
              <div className="relative">
                <Twitter className="absolute left-3 top-2.5 h-4 w-4 text-[#1DA1F2] z-10 pointer-events-none" />
                <Input
                  {...field}
                  value={field.value || ""}
                  id="twitter"
                  placeholder="https://twitter.com/username"
                  className="pl-10 input-glass"
                />
              </div>
            </FormField>
          )}
        />

        {/* Website */}
        <Controller
          name="socialLinks.website"
          control={control}
          render={({ field }) => (
            <FormField
              label="Website"
              error={errors.socialLinks?.website?.message}
              htmlFor="website"
            >
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 h-4 w-4 text-emerald-600 z-10 pointer-events-none" />
                <Input
                  {...field}
                  value={field.value || ""}
                  id="website"
                  placeholder="https://yourwebsite.com"
                  className="pl-10 input-glass"
                />
              </div>
            </FormField>
          )}
        />
      </div>
    </div>
  );
}
