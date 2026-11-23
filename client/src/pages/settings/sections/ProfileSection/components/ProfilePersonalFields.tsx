import { UseFormReturn, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/features/settings/components/FormField";
import { BannerUpload } from "./BannerUpload";
import { ProfilePictureUpload } from "./ProfilePictureUpload";
import { BirthdayPicker } from "./BirthdayPicker";
import { OccupationSelect } from "./OccupationSelect";
import { BioField } from "./BioField";
import { SocialLinksFields } from "./SocialLinksFields";
import { NrcField } from "./NrcField";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";
import type { UserProfile } from "@/hooks/use-settings";

interface ProfilePersonalFieldsProps {
  form: UseFormReturn<ProfileFormData>;
  profile?: UserProfile | null;
}

export function ProfilePersonalFields({
  form,
  profile,
}: ProfilePersonalFieldsProps) {
  const {
    control,
    formState: { errors },
    watch,
    setValue,
  } = form;

  return (
    <div className="space-y-6 animate-in fade-in-50">
      {/* Banner & Avatar Section */}
      <div className="space-y-4">
        <BannerUpload
          bannerUrl={profile?.bannerUrl}
          userName={profile?.fullName || profile?.displayName || ""}
        />
        <div className="-mt-[100px] ml-8 relative z-10 mb-4">
          <ProfilePictureUpload />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Controller
          name="firstName"
          control={control}
          render={({ field }) => (
            <FormField
              label="First Name"
              required
              error={errors.firstName?.message as string}
              htmlFor="firstName"
            >
              <Input
                {...field}
                value={field.value || ""}
                id="firstName"
                placeholder="Jane"
              />
            </FormField>
          )}
        />
        <Controller
          name="lastName"
          control={control}
          render={({ field }) => (
            <FormField
              label="Last Name"
              required
              error={errors.lastName?.message as string}
              htmlFor="lastName"
            >
              <Input
                {...field}
                value={field.value || ""}
                id="lastName"
                placeholder="Doe"
              />
            </FormField>
          )}
        />
      </div>

      <Controller
        name="fullName"
        control={control}
        render={({ field }) => (
          <FormField
            label="Display Name"
            required
            error={errors.fullName?.message as string}
            htmlFor="fullName"
            tooltip="This is how you appear to others and We’ll address you by this name in the app and emails."
          >
            <Input
              {...field}
              id="fullName"
              placeholder="Jane Doe"
              className="input-glass transition-all focus:scale-[1.01] focus:shadow-md"
            />
          </FormField>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Birthday */}
        <div className="space-y-2">
          <Controller
            name="birthday"
            control={control}
            render={({ field }) => (
              <BirthdayPicker
                date={field.value || null}
                onChange={field.onChange}
                error={errors.birthday?.message as string}
                hideYear={watch("birthdayHideYear")}
                onHideYearChange={(val) =>
                  setValue("birthdayHideYear", val, {
                    shouldDirty: true,
                  })
                }
                tooltip="Must be at least 18 years old."
              />
            )}
          />
        </div>

        {/* Gender */}
        <Controller
          name="gender"
          control={control}
          render={({ field }) => (
            <FormField
              label="Gender"
              required
              error={errors.gender?.message as string}
              htmlFor="gender"
            >
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger
                  id="gender"
                  className="input-glass transition-all focus:scale-[1.01] focus:shadow-md"
                >
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
      </div>

      {/* Dynamic Occupation */}
      <div className="pt-2">
        <Controller
          name="occupation"
          control={control}
          render={({ field }) => (
            <FormField
              label="Occupation"
              error={errors.occupation?.message as string}
              htmlFor="occupation"
              tooltip="Select or type to create new"
            >
              <OccupationSelect value={field.value} onChange={field.onChange} />
            </FormField>
          )}
        />
      </div>

      <NrcField control={control} errors={errors} />

      {/* Bio Section */}
      <div className="pt-4 border-t">
        <BioField form={form} />
      </div>

      {/* Social Links Section */}
      <div className="pt-4 border-t">
        <SocialLinksFields form={form} />
      </div>
    </div>
  );
}
