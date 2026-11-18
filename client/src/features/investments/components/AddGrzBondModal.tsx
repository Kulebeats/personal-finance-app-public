import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
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
import { addYears, format } from "date-fns";
import {
  RECENT_AUCTION_RATES,
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

  const form = useForm<z.infer<typeof grzBondFormSchema>>({
    resolver: zodResolver(grzBondFormSchema),
    defaultValues: {
      bondName: "",
      isin: "",
      tenorYears: 5,
      faceValue: 0,
      purchasePrice: 0,
      purchaseDate: new Date().toISOString().split("T")[0],
      couponRate: 0,
      maturityDate: addYears(new Date(), 5).toISOString().split("T")[0],
    },
  });

  // Auto-calculate maturity date when tenor/purchase date changes
  const watchTenor = form.watch("tenorYears");
  const watchPurchaseDate = form.watch("purchaseDate");

  // Effect to update maturity? (Might be complex with react-hook-form, user can just edit it)

  async function onSubmit(values: z.infer<typeof grzBondFormSchema>) {
    try {
      await createBond.mutateAsync({
        ...values,
        couponRate: (values.couponRate / 100).toString(), // Convert % to decimal
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Government Bond</DialogTitle>
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
                      onValueChange={(val) => {
                        const years = Number(val);
                        field.onChange(val);
                        // Update maturity
                        try {
                          const pDate = new Date(
                            form.getValues("purchaseDate")
                          );
                          const mDate = addYears(pDate, years);
                          form.setValue(
                            "maturityDate",
                            mDate.toISOString().split("T")[0]
                          );

                          // Update coupon rate from recent auctions
                          if (RECENT_AUCTION_RATES[years]) {
                            form.setValue(
                              "couponRate",
                              RECENT_AUCTION_RATES[years]
                            );
                          }
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
                        onChange={(e) => {
                          field.onChange(e);
                          // Default purchase price to face value (Par issuance post-Jan 2024)
                          form.setValue(
                            "purchasePrice",
                            Number(e.target.value)
                          );
                        }}
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
                    <FormLabel>Purchase Price</FormLabel>
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
                            const tenor = form.getValues("tenorYears");
                            const mDate = addYears(pDate, Number(tenor));
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                    />
                  </FormControl>
                  <FormDescription>
                    Annual coupon interest rate. Suggestion:{" "}
                    {RECENT_AUCTION_RATES[Number(form.watch("tenorYears"))] ||
                      "N/A"}
                    %
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
