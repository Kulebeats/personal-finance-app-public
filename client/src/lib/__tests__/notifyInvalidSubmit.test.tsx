import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { MerchantCombobox } from "@/components/merchants/MerchantCombobox";
import { collectInvalidFields, notifyInvalidSubmit } from "../forms/notifyInvalidSubmit";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/merchants/useMerchantCombobox", () => ({
  useMerchantCombobox: () => ({
    open: false, setOpen: vi.fn(), searchValue: "", setSearchValue: vi.fn(), cleanedSearch: "",
    normalizedSearch: "", selectedMerchant: null, filteredMerchants: [], recentMerchants: [],
    remainingMerchants: [], matchingMerchant: null, hasExactMerchantMatch: false,
    showSimilarWarning: false, bestSimilarMerchant: null, showRecentMerchants: false,
    merchantsLoading: false, autocompleteLoading: false, cleanMerchantName: (name: string) => name.trim(),
  }),
}));

const schema = z.object({
  amount: z.string().min(1, "Amount is required"),
  merchantName: z.string().min(1, "Merchant name is required"),
});
type Values = z.infer<typeof schema>;
type NestedValues = { items: { qty: string }[]; owner: { name: string } };
const LABELS = { merchantName: "Merchant / Name" };

function MerchantForm({ onValid }: { onValid: () => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { amount: "5", merchantName: "" } });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValid, notifyInvalidSubmit<Values>(LABELS))}>
        <div style={{ height: 2000 }} />
        <FormField control={form.control} name="merchantName" render={({ field }) => (
          <FormItem>
            <FormControl>
              <MerchantCombobox value={field.value} selectedMerchantId="" onInputChange={field.onChange}
                onSelect={vi.fn()} onCreate={vi.fn()} onClear={vi.fn()} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

const scrollIntoView = vi.fn();
beforeEach(() => { Element.prototype.scrollIntoView = scrollIntoView; });
afterEach(() => { vi.clearAllMocks(); });

describe("notifyInvalidSubmit", () => {
  it("alerts with the field name and focuses the merchant combobox when it is empty", async () => {
    const onValid = vi.fn();
    render(<MerchantForm onValid={onValid} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const combobox = screen.getByRole("combobox");
    expect(onValid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/not saved/i),
      expect.objectContaining({ description: "Merchant / Name" }),
    );
    expect(combobox).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(scrollIntoView.mock.contexts[0]).toBe(combobox);
  });

  it("falls back to the error message when no label is given", () => {
    const handler = notifyInvalidSubmit();
    handler({ amount: { type: "custom", message: "Amount is required" } }, undefined);
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ description: "Amount is required" }),
    );
  });

  it("flattens nested and array errors and finds fields by name or data-field", async () => {
    const errors: FieldErrors<NestedValues> = { items: [{ qty: { type: "custom", message: "Qty is required" } }], owner: { name: { type: "required" } } };
    expect(collectInvalidFields(errors).map((field) => field.path)).toEqual(["items.0.qty", "owner.name"]);

    render(<form><div data-field="owner.name"><input aria-label="Owner name" /></div><input name="items.0.qty" aria-label="Qty" /></form>);
    notifyInvalidSubmit<NestedValues>()(errors, undefined);
    await waitFor(() => expect(screen.getByLabelText("Qty")).toHaveFocus());
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByLabelText("Qty"));
  });
});
