import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { OwnerSelector } from "../OwnerSelector";

vi.mock("@/hooks/use-settings", () => ({ useProfile: () => ({ data: { id: "actor" } }), useHouseholdMembers: () => ({ data: [
  { userId: "actor", name: "Actor", role: "owner", joinedAt: null }, { userId: "peer", name: "Peer", role: "member", joinedAt: null },
] }) }));
function Field() {
  const form = useForm<{ owner: string | null }>({ defaultValues: { owner: "actor" } });
  return <Form {...form}><FormField control={form.control} name="owner" render={({ field }) => <FormItem>
    <FormLabel>Owner</FormLabel><FormControl><OwnerSelector value={field.value} onChange={field.onChange} /></FormControl><FormMessage />
  </FormItem>} /><button onClick={() => form.setError("owner", { message: "Choose yourself" })}>Set owner error</button><output data-testid="owner-value">{form.watch("owner") ?? "Shared"}</output></Form>;
}
it("forwards the real form label and error attributes to the actual select trigger", async () => {
  render(<Field />); const owner = screen.getByRole("combobox", { name: "Owner" });
  expect(owner.id).toBeTruthy(); await userEvent.click(owner); await userEvent.click(screen.getByRole("option", { name: /Peer/ }));
  expect(screen.getByTestId("owner-value")).toHaveTextContent("peer");
  fireEvent.click(screen.getByRole("button", { name: "Set owner error" }));
  expect(owner).toHaveAttribute("aria-invalid", "true"); expect(owner).toHaveAccessibleDescription(expect.stringContaining("Choose yourself"));
});
