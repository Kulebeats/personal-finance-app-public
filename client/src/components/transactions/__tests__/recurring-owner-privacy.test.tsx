/**
 * @vitest-environment jsdom
 *
 * NEW-10 Q1: POST /recurring/transaction takes no owner and no privacy flag
 * (the saver owns it, and it is shared). While a new transaction is recurring
 * the form must not offer those choices as if they applied.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Form } from "@/components/ui/form";
import { RecurringToggleField } from "../form/RecurringToggleField";
import { RECURRING_OWNER_NOTE, TransactionOwnerField } from "../form/TransactionOwnerField";
import { RECURRING_PRIVACY_NOTE, TransactionPrivacyField } from "../form/TransactionPrivacyField";
import type { TransactionFormValues } from "../form/schema";

vi.mock("@/hooks/use-settings", () => ({
  useHouseholdMembers: () => ({ data: [] }),
  useProfile: () => ({ data: { id: "00000000-0000-4000-8000-000000000001" } }),
}));

function Harness({ isPrivate = false }: { isPrivate?: boolean }) {
  const form = useForm<TransactionFormValues>({
    defaultValues: { type: "expense", amount: "", accountId: "", isRecurring: false, ownerUserId: null, isPrivate, tags: [] },
  });
  return <Form {...form}>
    <TransactionOwnerField form={form} isEditMode={false} />
    <TransactionPrivacyField form={form} />
    <RecurringToggleField form={form} />
  </Form>;
}

const recurringToggle = () => screen.getByRole("checkbox", { name: /recurring transaction/i });

describe("owner and privacy while a new transaction is recurring", () => {
  afterEach(cleanup);

  it("disables the owner picker and privacy toggle and says why, then restores them", async () => {
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeEnabled();

    await userEvent.click(recurringToggle());
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeDisabled();
    expect(screen.getByText(RECURRING_OWNER_NOTE)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeDisabled();
    expect(screen.getByText(RECURRING_PRIVACY_NOTE)).toBeVisible();

    await userEvent.click(recurringToggle());
    expect(screen.getByRole("combobox", { name: "Owner" })).toBeEnabled();
    expect(screen.queryByText(RECURRING_OWNER_NOTE)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeEnabled();
  });

  it("keeps an already ticked Private box clearable after recurring is switched on", async () => {
    render(<Harness isPrivate />);
    await userEvent.click(recurringToggle());
    const privacy = screen.getByRole("checkbox", { name: "Private transaction" });
    expect(privacy).toBeEnabled();
    await userEvent.click(privacy);
    expect(privacy).not.toBeChecked();
    expect(privacy).toBeDisabled();
  });
});
