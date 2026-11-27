import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGrzTBill } from "@/hooks/useGrzSecurities";
import { useAccounts } from "@/hooks/useAccounts";
import { TBillSettlementAccountField } from "./TBillSettlementAccountField";
import { Loader2 } from "lucide-react";
import { addDays } from "date-fns";
import { useHouseholdCalendarToday } from "@/lib/calendarZone";
import { shiftCalendarDate } from "@shared/household-calendar";
import { tbillFormSchema } from "./AddGrzTBillModalData";

const formSchema = tbillFormSchema;

interface AddGrzTBillModalProps {
  children?: React.ReactNode;
  onSuccess?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddGrzTBillModal({
  children,
  onSuccess,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: AddGrzTBillModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen : setInternalOpen;

  const createTBill = useCreateGrzTBill();
  const { data: accounts = [] } = useAccounts(undefined, open);
  const settlementAccounts = accounts.filter(account => account.currency === "ZMW" && account.isAsset && !account.isArchived);

  const today = useHouseholdCalendarToday(); // NEW-15: the server's day, UTC for a legacy household
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tbillName: "",
      isin: "",
      accountId: "",
      tenorDays: 91,
      faceValue: 0, purchasePrice: 0,
      purchaseDate: today,
      maturityDate: shiftCalendarDate(today, 91),
    },
  });
  useEffect(() => { // On open untouched dates (and their defaults) move to today, for a zone that arrived late.
    const defaults = form.formState.defaultValues, purchase = form.getValues("purchaseDate"), tenor = Number(form.getValues("tenorDays"));
    if (!open || purchase !== defaults?.purchaseDate) return;
    form.reset({ ...defaults, purchaseDate: today, maturityDate: shiftCalendarDate(today, 91) }, { keepValues: true });
    form.setValue("purchaseDate", today); // maturity follows only while it is still auto-calculated
    if (form.getValues("maturityDate") === shiftCalendarDate(purchase, tenor)) form.setValue("maturityDate", shiftCalendarDate(today, tenor));
  }, [open, today]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      // Calculate yield roughly? Or let backend handle valid field.
      // Yield = ((Face - Price) / Price) * (365 / Tenor)
      const yieldVal =
        ((values.faceValue - values.purchasePrice) / values.purchasePrice) *
        (365 / values.tenorDays);

      await createTBill.mutateAsync({
        ...values,
        faceValue: values.faceValue.toString(),
        purchasePrice: values.purchasePrice.toString(),
        purchaseYield: isFinite(yieldVal) ? yieldVal.toString() : null,
        status: "active",
      });

      form.reset();
      setOpen?.(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Treasury Bill</DialogTitle>
          <DialogDescription>Use the figures from your purchase confirmation and choose the ZMW account the bill matures into.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="tbillName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>T-Bill Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. GRZ 364-Day T-Bill" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField control={form.control} name="accountId" render={({ field }) => (
              <TBillSettlementAccountField value={field.value} onChange={field.onChange} accounts={settlementAccounts} />
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="isin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ISIN (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="ZM..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tenorDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenor (Days)</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        field.onChange(val);
                        // Update maturity
                        try {
                          const pDate = new Date(
                            form.getValues("purchaseDate")
                          );
                          const mDate = addDays(pDate, Number(val));
                          form.setValue(
                            "maturityDate",
                            mDate.toISOString().split("T")[0]
                          );
                        } catch (e) {}
                      }}
                      defaultValue={field.value.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select tenor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="91">91 Days</SelectItem>
                        <SelectItem value="182">182 Days</SelectItem>
                        <SelectItem value="273">273 Days</SelectItem>
                        <SelectItem value="364">364 Days</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="faceValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Face Value (ZMW)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchasePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Cost</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          try {
                            const pDate = new Date(e.target.value);
                            const tenor = form.getValues("tenorDays");
                            const mDate = addDays(pDate, Number(tenor));
                            form.setValue(
                              "maturityDate",
                              mDate.toISOString().split("T")[0]
                            );
                          } catch (ex) {}
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maturityDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maturity Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <Description>Auto-calculated</Description>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen?.(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createTBill.isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {createTBill.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add T-Bill
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function Description({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8rem] text-muted-foreground">{children}</p>;
}
