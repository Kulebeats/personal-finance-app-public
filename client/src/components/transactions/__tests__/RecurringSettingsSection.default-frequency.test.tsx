/**
 * @vitest-environment jsdom
 *
 * NEW-10: switching on "Recurring Transaction" preselects a frequency, so the
 * form never sends a recurring request without one.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { Form } from "@/components/ui/form";
import { RecurringSettingsSection } from "../form/RecurringSettingsSection";
import type { TransactionFormValues } from "../form/schema";

function Harness({ onForm, frequency }: {
  onForm: (form: UseFormReturn<TransactionFormValues>) => void;
  frequency?: TransactionFormValues["recurringFrequency"];
}) {
  const form = useForm<TransactionFormValues>({
    defaultValues: { type: "expense", amount: "", accountId: "", isRecurring: false, recurringFrequency: frequency, tags: [] },
  });
  onForm(form);
  return <Form {...form}><RecurringSettingsSection form={form} isEditMode={false} isTransferMode={false} /></Form>;
}

describe("Recurring Transaction toggle", () => {
  afterEach(cleanup);

  it("preselects monthly when switched on, and keeps a frequency the user already chose", async () => {
    let form!: UseFormReturn<TransactionFormValues>;
    const view = render(<Harness onForm={value => { form = value; }} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /recurring transaction/i }));
    expect(form.getValues("isRecurring")).toBe(true);
    expect(form.getValues("recurringFrequency")).toBe("monthly");

    view.unmount();
    render(<Harness frequency="weekly" onForm={value => { form = value; }} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /recurring transaction/i }));
    expect(form.getValues("recurringFrequency")).toBe("weekly");
  });
});
