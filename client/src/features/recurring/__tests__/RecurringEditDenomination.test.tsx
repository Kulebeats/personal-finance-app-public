import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecurringEditModal } from "../components/RecurringEditModal";
import type { RecurringEditForm } from "../types";

describe("Recurring explicit denomination recovery", () => {
  it("does not display an unverified legacy DTO fallback as ZMW", () => {
    render(<RecurringEditModal isOpen onClose={() => {}} form={{ name: "Legacy", amount: "7.25", frequency: "monthly" }}
      onFormChange={() => {}} onSave={() => {}} isSaving={false} currency="ZMW" />);
    expect(screen.queryByText("ZMW")).not.toBeInTheDocument();
    expect(screen.getByText("Currency unconfirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
  });
  it("clears the old amount and requires a new ZMW entry before saving the attestation", () => {
    const save = vi.fn();
    function Harness() {
      const [form, setForm] = useState<RecurringEditForm>({ name: "Legacy amount", amount: "7.25", frequency: "monthly", ...{ expectedDefinition: "1".repeat(64) } });
      return <RecurringEditModal isOpen onClose={() => {}} form={form} onFormChange={updates => setForm(current => ({ ...current, ...updates }))}
        onSave={() => save(form)} isSaving={false} currency="USD" />;
    }
    render(<Harness />);
    expect(screen.getByLabelText("Amount")).toHaveValue(7.25);
    fireEvent.click(screen.getByLabelText("Confirm a newly entered amount in ZMW"));
    expect(screen.getByLabelText("Amount")).toHaveValue(null);
    expect(screen.getByText("ZMW")).toBeInTheDocument();
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "19.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ confirmDenomination: true, amount: "19.50", expectedDefinition: "1".repeat(64) }));
  });
});
