import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { ContactFields } from "../ContactFields";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";

function Harness({ mobile }: { mobile: string }) {
  const form = useForm<ProfileFormData>({
    defaultValues: { phoneNumberMobile: mobile } as Partial<ProfileFormData>,
  });
  return (
    <FormProvider {...form}>
      <ContactFields form={form} />
    </FormProvider>
  );
}

describe("ContactFields mobile number", () => {
  // A synthetic Airtel number, typed the way Zambians write it and without the 0.
  it.each(["0770000001", "770000001", "+260770000001"])(
    "shows %s as a valid Airtel number",
    (mobile) => {
      render(<Harness mobile={mobile} />);

      expect(screen.getByText("Airtel")).toBeInTheDocument();
      expect(
        screen.queryByText("Invalid number format for selected country"),
      ).not.toBeInTheDocument();
    },
  );

  it("still flags a number with an unknown prefix", () => {
    render(<Harness mobile="0711234567" />);

    expect(
      screen.getByText("Invalid number format for selected country"),
    ).toBeInTheDocument();
  });
});
