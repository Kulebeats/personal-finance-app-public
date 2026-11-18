import { useEffect, useMemo, useState } from "react";
import { parseMoney } from "@/lib/utils";

import type {
  DebtStrategyResult,
  ScenarioKey,
  StrategyRow,
} from "../GoalDetailTypes";
import { getScenarioData, useGoalDetailData } from "./useGoalDetailData";

function parseAmount(value?: string | number | null) {
  return parseMoney(value);
}

export function useGoalDetailState(
  data: ReturnType<typeof useGoalDetailData>
) {
  const [assignmentType, setAssignmentType] = useState<
    "full_balance" | "partial_balance"
  >("full_balance");
  const [assignmentAccountId, setAssignmentAccountId] = useState("");
  const [partialAmount, setPartialAmount] = useState("");

  const [transferOpen, setTransferOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [contributionModalOpen, setContributionModalOpen] = useState(false);

  const [customPayment, setCustomPayment] = useState("");
  const [customOneTime, setCustomOneTime] = useState("");
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("current");

  const [snowballStrategy, setSnowballStrategy] =
    useState<DebtStrategyResult | null>(null);
  const [avalancheStrategy, setAvalancheStrategy] =
    useState<DebtStrategyResult | null>(null);

  const scenarioData = useMemo(
    () =>
      getScenarioData(scenarioKey, data.payoffScenarios, data.calculatePayoff),
    [scenarioKey, data.payoffScenarios, data.calculatePayoff]
  );

  const canAssign =
    !!assignmentAccountId &&
    (assignmentType === "full_balance" ||
      (assignmentType === "partial_balance" &&
        parseAmount(partialAmount) > 0));

  const handleAssign = () => {
    if (!canAssign) return;

    data.assignAccount.mutate({
      accountId: assignmentAccountId,
      assignmentType,
      partialAmount:
        assignmentType === "partial_balance" && partialAmount
          ? { amount: partialAmount, currency: data.goalCurrency }
          : null,
      autoUpdate: assignmentType === "full_balance",
    });

    setAssignmentAccountId("");
    setPartialAmount("");
  };

  const handleCustomPayoff = () => {
    const monthlyPayment = parseAmount(customPayment);
    if (!Number.isFinite(monthlyPayment) || monthlyPayment <= 0) return;

    data.calculatePayoff.mutate(
      {
        monthlyPayment,
        oneTimePayment: customOneTime
          ? parseAmount(customOneTime)
          : undefined,
      },
      {
        onSuccess: () => {
          setScenarioKey("custom");
        },
      }
    );
  };

  const handleRunStrategies = async () => {
    if (data.debtInputs.length < 2) return;
    try {
      const snowball = await data.debtStrategy.mutateAsync({
        method: "snowball",
        debts: data.debtInputs,
      });
      const avalanche = await data.debtStrategy.mutateAsync({
        method: "avalanche",
        debts: data.debtInputs,
      });
      setSnowballStrategy(snowball);
      setAvalancheStrategy(avalanche);
    } catch {
      return;
    }
  };

  useEffect(() => {
    if (scenarioKey === "custom") {
      const hasCustom =
        !!data.calculatePayoff.data || !!data.payoffScenarios.data?.custom;
      if (!hasCustom) {
        setScenarioKey("current");
      }
    }
  }, [data.calculatePayoff.data, data.payoffScenarios.data, scenarioKey]);

  const snowballRows = useMemo<StrategyRow[]>(
    () =>
      snowballStrategy
        ? [...snowballStrategy]
            .sort((a, b) => a.payoffOrder - b.payoffOrder)
            .map((item) => {
              const goalItem = data.payDownGoalMap.get(item.debtId);
              return {
                id: item.debtId,
                order: item.payoffOrder,
                name: goalItem?.name ?? "Unknown",
                balance: goalItem ? parseAmount(goalItem.currentAmount) : null,
                payoffDate: item.payoffDate,
              };
            })
        : [],
    [snowballStrategy, data.payDownGoalMap]
  );

  const avalancheRows = useMemo<StrategyRow[]>(
    () =>
      avalancheStrategy
        ? [...avalancheStrategy]
            .sort((a, b) => a.payoffOrder - b.payoffOrder)
            .map((item) => {
              const goalItem = data.payDownGoalMap.get(item.debtId);
              return {
                id: item.debtId,
                order: item.payoffOrder,
                name: goalItem?.name ?? "Unknown",
                balance: goalItem ? parseAmount(goalItem.currentAmount) : null,
                payoffDate: item.payoffDate,
              };
            })
        : [],
    [avalancheStrategy, data.payDownGoalMap]
  );

  return {
    assignmentType,
    setAssignmentType,
    assignmentAccountId,
    setAssignmentAccountId,
    partialAmount,
    setPartialAmount,
    transferOpen,
    setTransferOpen,
    editOpen,
    setEditOpen,
    linkModalOpen,
    setLinkModalOpen,
    contributionModalOpen,
    setContributionModalOpen,
    customPayment,
    setCustomPayment,
    customOneTime,
    setCustomOneTime,
    scenarioKey,
    setScenarioKey,
    scenarioData,
    canAssign,
    handleAssign,
    handleCustomPayoff,
    handleRunStrategies,
    snowballRows,
    avalancheRows,
  };
}
