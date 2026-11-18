import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

type AddGrzBondModalFooterProps = {
  isPending: boolean;
  onCancel: () => void;
};

export function AddGrzBondModalFooter({
  isPending,
  onCancel,
}: AddGrzBondModalFooterProps) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={isPending}
        className="bg-orange-600 hover:bg-orange-700 text-white"
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Add Bond
      </Button>
    </DialogFooter>
  );
}
