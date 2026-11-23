import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountDetailHeader } from "../../AccountDetailHeader";
import type { Account } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { state } from "./data.fixture";
activateOperationLifetime(createOperationLifetime({ subject: "fixture-actor", household: "fixture-home" }));
Object.assign(window, { copyFixture: { state, retire: retireOperationLifetime } });
const account = { id: "synthetic-account", name: "Synthetic account", type: "checking", balance: "123.45", currency: "ZMW" } as Account;
function Fixture() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const listener = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener("copy-fixture-toast", listener);
    return () => window.removeEventListener("copy-fixture-toast", listener);
  }, []);
  return <><AccountDetailHeader account={account} dateRange="all" setDateRange={() => {}}
    onEdit={() => {}} onImportTransactions={() => {}} onImportBalanceHistory={() => {}} hasHistory />
    <output aria-label="Copy outcome">{message}</output></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
