import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import type { ProfileFieldMode } from "@shared/profile-policy";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";
import { NrcField } from "../components/NrcField";

function Harness({ mode, nrc = "" }: { mode: ProfileFieldMode; nrc?: string }) {
  const form = useForm<ProfileFormData>({ defaultValues: { nrc } });
  return <NrcField control={form.control} errors={form.formState.errors} mode={mode} />;
}

describe("NrcField display modes (AH-07)", () => {
  it("editable: collects the NRC and formats digits as 123456/78/9", async () => {
    render(<Harness mode="editable" />);
    const input = screen.getByLabelText(/national registration card/i);
    expect(input).toBeEnabled();
    await userEvent.type(input, "123456789");
    expect(input).toHaveValue("123456/78/9");
  });

  it("readonly: shows the saved NRC greyed out", () => {
    render(<Harness mode="readonly" nrc="123456/78/9" />);
    const input = screen.getByLabelText(/national registration card/i);
    expect(input).toBeDisabled();
    expect(input).toHaveValue("123456/78/9");
  });

  it("hidden: renders no NRC field", () => {
    render(<Harness mode="hidden" nrc="123456/78/9" />);
    expect(screen.queryByLabelText(/national registration card/i)).toBeNull();
  });
});
