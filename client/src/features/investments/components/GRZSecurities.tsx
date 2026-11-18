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
import { AddGrzBondModal } from "./AddGrzBondModal";
import { AddGrzTBillModal } from "./AddGrzTBillModal";
import { BondScheduleDialog } from "./BondScheduleDialog";
import { GoalProjectionCalculator } from "./GoalProjectionCalculator";
import { InvestmentGoalsList } from "./InvestmentGoalsList";
import { BondLadder } from "./BondLadder";
import { GRZBondsTable } from "./GRZBondsTable";
import { GRZTBillsTable } from "./GRZTBillsTable";
import { useState } from "react";

export function GRZSecurities() {
  const { data: bonds, isLoading: bondsLoading } = useGrzBonds();
  const { data: tbills, isLoading: tbillsLoading } = useGrzTBills();
  const { formatCurrency } = useFormat();

  const [openBondModal, setOpenBondModal] = useState(false);
  const [openTBillModal, setOpenTBillModal] = useState(false);
  const [selectedBond, setSelectedBond] = useState<GrzBond | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const isLoading = bondsLoading || tbillsLoading;

  // Calculations
  const totalBondValue =
    bonds?.reduce((sum, b) => sum + Number(b.faceValue), 0) || 0;
  const totalTBillValue =
    tbills?.reduce((sum, t) => sum + Number(t.faceValue), 0) || 0;
  const totalGrzValue = totalBondValue + totalTBillValue;

  const handleViewSchedule = (bond: GrzBond) => {
    setSelectedBond(bond);
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
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total GRZ Portfolio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {formatCurrency(totalGrzValue)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Face Value</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bond Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalBondValue)}
            </div>
            <div className="flex items-center text-xs text-emerald-600 mt-1">
              <TrendingUp className="h-3 w-3 mr-1" />
              {bonds?.length || 0} Active Bonds
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              T-Bill Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalTBillValue)}
            </div>
            <div className="flex items-center text-xs text-emerald-600 mt-1">
              <TrendingUp className="h-3 w-3 mr-1" />
              {tbills?.length || 0} Active T-Bills
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
        bond={selectedBond}
        open={showSchedule}
        onOpenChange={setShowSchedule}
      />
    </div>
  );
}
