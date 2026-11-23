/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuleCreationModal } from "../RuleCreationModal";

const categoryId = "11111111-1111-4111-8111-111111111111";
const tagId = "22222222-2222-4222-8222-222222222222";

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { categories: [
    { id: "11111111-1111-4111-8111-111111111111", householdId: "h1", name: "Groceries", groupName: "Food", groupType: "expenses" },
  ] } }),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: () => ({ data: [
    { id: "22222222-2222-4222-8222-222222222222", householdId: "h1", name: "Groceries tag" },
  ] }),
}));

function chooseExistingTag() {
  fireEvent.click(screen.getByRole("switch", { name: "Add tags" }));
  const input = screen.getByRole("combobox", { name: "Existing tag name" });
  fireEvent.change(input, { target: { value: "Groceries tag" } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("RuleCreationModal category and tag values", () => {
  it("keeps category and tag labels visible but submits their UUIDs", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<RuleCreationModal
      open
      onOpenChange={onOpenChange}
      initialMerchant="Shoprite"
      initialCategory="Groceries"
      {...({ initialCategoryId: categoryId } as { initialCategoryId: string })}
      onSubmit={onSubmit}
    />);

    expect(screen.getByRole("dialog", { name: "New rule" })).toHaveAccessibleDescription(
      "Choose the merchant condition and category or existing tags for this rule.",
    );
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    chooseExistingTag();
    expect(screen.getByText("Groceries tag")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      merchant: "Shoprite", categoryId, tagIds: [tagId],
    }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Shoprite")).toBeInTheDocument();
  });

  it("omits a category action for an uncategorized transaction and requires another action", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RuleCreationModal
      open
      onOpenChange={vi.fn()}
      initialMerchant="Market"
      initialCategory=""
      {...({ initialCategoryId: null } as { initialCategoryId: null })}
      onSubmit={onSubmit}
    />);

    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    chooseExistingTag();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ categoryId: null, tagIds: [tagId] }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("does not silently submit an unrecognized tag name with an otherwise valid category", () => {
    const onSubmit = vi.fn();
    render(<RuleCreationModal
      open onOpenChange={vi.fn()} initialMerchant="Shoprite" initialCategory="Groceries"
      {...({ initialCategoryId: categoryId } as { initialCategoryId: string })}
      onSubmit={onSubmit}
    />);
    fireEvent.click(screen.getByRole("switch", { name: "Add tags" }));
    const input = screen.getByRole("combobox", { name: "Existing tag name" });
    fireEvent.change(input, { target: { value: "Brand new tag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Select an existing tag");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends one pending create and keeps the same draft available for retry after rejection", async () => {
    let rejectFirst!: (reason: Error) => void;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const onSubmit = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    render(<RuleCreationModal
      open onOpenChange={onOpenChange} initialMerchant="Shoprite" initialCategory="Groceries"
      {...({ initialCategoryId: categoryId } as { initialCategoryId: string })}
      onSubmit={onSubmit}
    />);
    const save = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByDisplayValue("Shoprite")).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => { rejectFirst(new Error("save failed")); });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByDisplayValue("Shoprite")).toBeInTheDocument();
    await act(async () => { fireEvent.click(save); });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
