import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, TrendingUp } from "lucide-react";
import { useGrzBonds, useGrzTBills, GrzBond } from "@/hooks/useGrzSecurities";
import { useFormat } from "@/hooks/use-format";
import { sumMoneyValues } from "@/lib/money";
import { AddGrzBondModal } from "./AddGrzBondModal";
import { AddGrzTBillModal } from "./AddGrzTBillModal";
import { BondScheduleDialog } from "./BondScheduleDialog";
import { GoalProjectionCalculator } from "./GoalProjectionCalculator";
import { InvestmentGoalsList } from "./InvestmentGoalsList";
import { BondLadder } from "./BondLadder";
import { GRZBondsTable } from "./GRZBondsTable";
import { GRZTBillsTable } from "./GRZTBillsTable";
import { GrzPolicyNotice } from "./GrzPolicyNotice";
import { useState } from "react";

export function GRZSecurities() {
  const { data: bonds, isLoading: bondsLoading } = useGrzBonds();
  const { data: tbills, isLoading: tbillsLoading } = useGrzTBills();
  const { formatCurrency } = useFormat();

  const [openBondModal, setOpenBondModal] = useState(false);
  const [openTBillModal, setOpenTBillModal] = useState(false);
  const [selectedBondId, setSelectedBondId] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const isLoading = bondsLoading || tbillsLoading;

  const activeBonds = (bonds ?? []).filter(bond => bond.status === "active");
  const activeTBills = (tbills ?? []).filter(bill => bill.status === "active");
  // A-36: a bill awaiting receipt is still held, at face less the booked withholding.
  // Without its booked proceeds a due bill's value is unavailable, never zero.
  const dueTBills = (tbills ?? []).filter(bill => bill.status === "awaiting_receipt");
  const awaitingTBills = dueTBills.flatMap(bill => bill.maturityNetProceeds ? [bill.maturityNetProceeds] : []);
  const isTBillValueUnavailable = awaitingTBills.length < dueTBills.length;
  const totalBondValue = sumMoneyValues(activeBonds.map(bond => bond.faceValue));
  const totalTBillValue = sumMoneyValues([...activeTBills.map(bill => bill.faceValue), ...awaitingTBills]);
  const totalGrzValue = totalBondValue.plus(totalTBillValue);

  const handleViewSchedule = (bond: GrzBond) => {
    setSelectedBondId(bond.id);
    setShowSchedule(true);
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading GRZ Securities...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GrzPolicyNotice />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              GRZ value held (ZMW)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {isTBillValueUnavailable ? "Unavailable" : formatCurrency(totalGrzValue.toNumber(), "ZMW")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Face value; bills awaiting receipt at face less withholding</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active bond face value (ZMW)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalBondValue.toNumber(), "ZMW")}
            </div>
            <div className="flex items-center text-xs text-emerald-600 mt-1">
              <TrendingUp className="h-3 w-3 mr-1" />
              {activeBonds.length} Active Bonds
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              T-bill value held (ZMW)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isTBillValueUnavailable ? "Unavailable" : formatCurrency(totalTBillValue.toNumber(), "ZMW")}
            </div>
            <div className="flex items-center text-xs text-emerald-600 mt-1">
              <TrendingUp className="h-3 w-3 mr-1" />
              {activeTBills.length} Active T-Bills{dueTBills.length > 0 && `, ${dueTBills.length} awaiting receipt`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="bonds" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="bonds">Government Bonds</TabsTrigger>
            <TabsTrigger value="tbills">Treasury Bills</TabsTrigger>
            <TabsTrigger value="ladder">Payment Ladder</TabsTrigger>
            <TabsTrigger value="goals">Goals & Projection</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Plus className="h-4 w-4" /> Add Security
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setOpenBondModal(true)}>
                  Government Bond
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setOpenTBillModal(true)}>
                  Treasury Bill
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AddGrzBondModal
              open={openBondModal}
              onOpenChange={setOpenBondModal}
            />
            <AddGrzTBillModal
              open={openTBillModal}
              onOpenChange={setOpenTBillModal}
            />
          </div>
        </div>

        <TabsContent value="bonds" className="mt-4">
          <GRZBondsTable
            bonds={bonds}
            formatCurrency={formatCurrency}
            onViewSchedule={handleViewSchedule}
          />
        </TabsContent>

        <TabsContent value="tbills">
          <GRZTBillsTable tbills={tbills} formatCurrency={formatCurrency} />
        </TabsContent>

        <TabsContent value="ladder" className="mt-4">
          <BondLadder />
        </TabsContent>

        <TabsContent value="goals" className="mt-4">
          <div className="grid gap-6 md:grid-cols-1">
            <GoalProjectionCalculator />
            <InvestmentGoalsList />
          </div>
        </TabsContent>
      </Tabs>

      <BondScheduleDialog
        bond={bonds?.find(bond => bond.id === selectedBondId) ?? null}
        open={showSchedule}
        onOpenChange={setShowSchedule}
      />
    </div>
  );
}
