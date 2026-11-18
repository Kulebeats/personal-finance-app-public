import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Search } from "lucide-react";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type MerchantsToolbarProps = {
  state: MerchantsSectionState;
};

export function MerchantsToolbar({ state }: MerchantsToolbarProps) {
  const { state: viewState, actions } = state;

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search merchants..."
          value={viewState.searchQuery}
          onChange={(event) => actions.setSearchQuery(event.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        value={viewState.sortBy}
        onValueChange={(value) =>
          actions.setSortBy(value as "name" | "count" | "recent")
        }
      >
        <SelectTrigger className="w-[160px]">
          <ArrowUpDown className="w-4 h-4 mr-2" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="count">By Transactions</SelectItem>
          <SelectItem value="name">By Name</SelectItem>
          <SelectItem value="recent">Most Recent</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
