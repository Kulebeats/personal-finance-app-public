import Decimal from "decimal.js";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useCreateGrzBond } from "@/hooks/useGrzSecurities";
import { useAccounts } from "@/hooks/useAccounts";
import {
  grzBondFormSchema,
} from "./AddGrzBondModalData";
import { AddGrzBondModalFooter } from "./AddGrzBondModalFooter";


interface AddGrzBondModalProps {
  children?: React.ReactNode;
  onSuccess?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddGrzBondModal({
  children,
  onSuccess,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: AddGrzBondModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen : setInternalOpen;

  const createBond = useCreateGrzBond();
  const { data: accounts = [] } = useAccounts(undefined, open);
  const custodyAccounts = accounts.filter(account => account.currency === "ZMW" && account.isAsset && !account.isArchived);

  const form = useForm<z.infer<typeof grzBondFormSchema>>({
    resolver: zodResolver(grzBondFormSchema),
    defaultValues: {
      bondName: "",
      isin: "",
      accountId: null,
      tenorYears: 5,
      faceValue: 0,
      purchasePrice: 0,
      purchaseDate: new Date().toISOString().split("T")[0],
      firstCouponDate: "",
      maturityDate: "",
    },
  });

  async function onSubmit(values: z.infer<typeof grzBondFormSchema>) {
    try {
      const { accountId, ...acquisition } = values;
      await createBond.mutateAsync({
        ...acquisition,
        ...(accountId ? { accountId } : {}),
        couponRate: new Decimal(values.couponRate).div(100).toString(), // Convert % to decimal
        faceValue: values.faceValue.toString(),
        purchasePrice: values.purchasePrice.toString(),
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
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Government Bond</DialogTitle>
          <DialogDescription>Use the purchase price from your confirmation and the coupon and dates for this specific bond.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="bondName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bond Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. GRZ 5-Year Bond" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField control={form.control} name="accountId" render={({ field }) => (
              <FormItem>
                <FormLabel>Custody account (optional)</FormLabel>
                <Select value={field.value ?? "none"} onValueChange={value => field.onChange(value === "none" ? null : value)}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No custody account</SelectItem>
                    {custodyAccounts.map(account => <SelectItem key={account.id} value={account.id}>{account.name} (ZMW)</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormDescription>Links this existing holding to an account for valuation. Recording it does not deduct the purchase price.</FormDescription>
                <FormMessage />
              </FormItem>
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
                name="tenorYears"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenor (Years)</FormLabel>
                    <Select
                      onValueChange={(val) => field.onChange(Number(val))}
                      defaultValue={field.value.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select tenor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="2">2 Years</SelectItem>
                        <SelectItem value="3">3 Years</SelectItem>
                        <SelectItem value="5">5 Years</SelectItem>
                        <SelectItem value="7">7 Years</SelectItem>
                        <SelectItem value="10">10 Years</SelectItem>
                        <SelectItem value="15">15 Years</SelectItem>
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
                      <Input
                        type="number"
                        step="0.01"
                        {...field}
                      />
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
                    <FormLabel>Purchase Price (ZMW)</FormLabel>
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="firstCouponDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First coupon date you are entitled to</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="couponRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Coupon Rate (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 14.5"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the annual coupon printed on the bond or its issue terms.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <AddGrzBondModalFooter
              isPending={createBond.isPending}
              onCancel={() => setOpen?.(false)}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
