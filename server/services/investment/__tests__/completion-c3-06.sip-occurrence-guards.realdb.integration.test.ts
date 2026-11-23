import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql, type SQL } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { eraseAccount } from "../../../modules/settings/settings.account-deletion.service";
import { password } from "../../../routes/__tests__/completion-c3-06.price-confirmation.fixture";
import {
  cleanConfirmationFixture, confirmationInput, confirmationPath, confirmationSnapshot, createConfirmationFixture,
  createPendingOccurrence, seedConfirmationFixture, signedConfirmation,
  type ConfirmationFixture, type ConfirmationInput,
} from "../../../routes/__tests__/completion-c3-06.sip-confirmation.fixture";
import * as transactions from "../../../utils/withTransaction";
import type { TransactionType } from "../../../utils/withTransaction";
import { digestSipFillProofTerms } from "../sipFillProofContract";
import * as posting from "../sipOccurrencePosting";

// SOURCE ONLY / UNRUN. Main composes the backend fixture/route candidate and
// independently reviewed 0029 before scheduling this suite. No test applies
// migrations, invents positive grants/proofs, fabricates SIDs or bypasses guards.
let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: ConfirmationFixture;
let passwordHash: string;
let planId: string;
let purchaseIds: string[];

beforeAll(async () => {
  app = await getTestApp();
  passwordHash = await hashPassword(password);
});

beforeEach(async () => {
  fixture = createConfirmationFixture();
  await seedConfirmationFixture(fixture, app, passwordHash);
  const pending = await createPendingOccurrence(app, fixture);
  planId = pending.plan.id;
});

afterEach(async () => {
  if (fixture) await cleanConfirmationFixture(fixture);
});

async function rejectedSql(statement: string, parameters: unknown[], code = "23514") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await expect(client.query(statement, parameters)).rejects.toMatchObject({ code });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function retainedFrame() {
  return (await pool.query(`SELECT p.id,p.account_id,p.security_id,p.quantity::text,p.price::text,p.fees::text,
    p.amount::text,p.currency,to_char(p.transaction_date,'YYYY-MM-DD') AS execution_date,p.fx_rate,p.amount_zmw,
    proof.author_user_id,to_char(proof.authorized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS authorized_at,
    proof.authorization_contract_version,proof.authorized_frequency,
    to_char(proof.authorized_initial_date,'YYYY-MM-DD') AS authorized_initial_date,proof.authorized_terms_digest,
    public.c306_sip_fill_digest(p.id,proof.authorized_frequency,proof.authorized_initial_date) AS sql_digest
    FROM investment_transactions p JOIN investment_purchase_authorization_proofs proof ON proof.purchase_id=p.id
    WHERE p.household_id=$1 ORDER BY p.id`, [fixture.homeHouseholdId])).rows;
}

describe("C3-06 additive occurrence and completed-fill storage guards", () => {
  beforeEach(async () => {
    const response = await signedConfirmation(app, fixture, "home", "post", confirmationPath(planId, fixture.today))
      .send({ ...confirmationInput(fixture), brokerReference: "synthetic-private-statement-ref" }).expect(200);
    purchaseIds = response.body.data.occurrence.result.fills.map((fill: { purchaseId: string }) => fill.purchaseId);
    expect(purchaseIds).toHaveLength(2);
  });
  it("retains exactly seven proof columns and three nonpersonal fence columns", async () => {
    const columns = async (table: string) => (await pool.query<{ column_name: string }>(`SELECT column_name
      FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]))
      .rows.map(row => row.column_name);
    expect(await columns("investment_purchase_authorization_proofs")).toEqual([
      "purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
      "authorized_frequency", "authorized_initial_date", "authorized_terms_digest",
    ]);
    expect(await columns("investment_sip_occurrence_fences")).toEqual(["plan_id", "original_due_date", "terminal"]);
  });

  it("preserves the original v1 guard bodies rather than replacing their semantics", async () => {
    const original = readFileSync(fileURLToPath(new URL("../../../../migrations/0028_r13_sip_authorization.sql", import.meta.url)), "utf8");
    for (const name of ["guard_investment_purchase_authorization_proof", "guard_investment_sip_reservation",
      "guard_proven_investment_purchase", "require_completed_sip_reservation"]) {
      const start = original.indexOf(`CREATE FUNCTION public.${name}()`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const first = original.indexOf("$body$", start) + "$body$".length;
      const last = original.indexOf("$body$", first);
      const expected = original.slice(first, last).replace(/\r\n/g, "\n");
      const stored = await pool.query<{ prosrc: string }>(`SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid=to_regprocedure($1)`, [`public.${name}()`]);
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].prosrc.replace(/\r\n/g, "\n"), name).toBe(expected);
    }
  });

  it.each([
    "authorization_contract_version=1",
    "authorized_terms_digest=repeat('0',64)",
    "authorized_at=authorized_at+interval '1 microsecond'",
    "authorized_frequency='daily'",
    "authorized_initial_date=authorized_initial_date+1",
  ])("does not relabel or amend a completed proof: %s", async assignment => {
    const before = await retainedFrame();
    await rejectedSql(`UPDATE investment_purchase_authorization_proofs SET ${assignment} WHERE purchase_id=$1`, [purchaseIds[0]]);
    expect(await retainedFrame()).toEqual(before);
  });

  it.each(["price=price+1", "quantity=quantity+1", "fees=fees+0.01", "transaction_date=transaction_date+1"])(
    "keeps the actual financial source immutable: %s", async assignment => {
      const before = await retainedFrame();
      await rejectedSql(`UPDATE investment_transactions SET ${assignment} WHERE id=$1`, [purchaseIds[0]]);
      expect(await retainedFrame()).toEqual(before);
    },
  );

  it("cannot delete a surviving purchase's proof or retrofit another proof onto its old INSERT", async () => {
    await rejectedSql("DELETE FROM investment_purchase_authorization_proofs WHERE purchase_id=$1", [purchaseIds[0]]);
    await rejectedSql(`INSERT INTO investment_purchase_authorization_proofs
      SELECT * FROM investment_purchase_authorization_proofs WHERE purchase_id=$1`, [purchaseIds[0]]);
    expect(await retainedFrame()).toHaveLength(2);
  });

  it("cannot rewrite, unseal or directly delete an operational actual-fill witness", async () => {
    await rejectedSql("UPDATE investment_sip_confirmed_fills SET posting_confirmed=false WHERE purchase_id=$1", [purchaseIds[0]]);
    await rejectedSql("DELETE FROM investment_sip_confirmed_fills WHERE purchase_id=$1", [purchaseIds[0]]);
  });

  it("does not repurpose a historical purchase as a newly reserved fill", async () => {
    await rejectedSql(`INSERT INTO investment_sip_confirmed_fills
      (confirmation_id,fill_index,purchase_id,execution_date,quantity,price,fees,amount)
      SELECT confirmation_id,99,purchase_id,execution_date,quantity,price,fees,amount
      FROM investment_sip_confirmed_fills WHERE purchase_id=$1`, [purchaseIds[0]]);
  });

  it("keeps custody immutable for the whole retained fence lifetime", async () => {
    await rejectedSql("UPDATE recurring_investments SET account_id=$1 WHERE id=$2", [fixture.otherAccountId, planId]);
    await rejectedSql("UPDATE recurring_investments SET household_id=$1 WHERE id=$2", [fixture.otherHouseholdId, planId]);
    await rejectedSql("UPDATE investment_sip_occurrence_fences SET terminal=false WHERE plan_id=$1", [planId]);
    await rejectedSql("DELETE FROM investment_sip_occurrence_fences WHERE plan_id=$1", [planId]);
  });

  it("rejects an orphan pending identity at an explicit early constraint flush", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO investment_sip_occurrence_fences(plan_id,original_due_date)
        SELECT id,next_execution_date FROM recurring_investments WHERE id=$1`, [planId]);
      await expect(client.query("SET CONSTRAINTS c306_require_materialized_occurrence IMMEDIATE"))
        .rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("cannot duplicate the original due identity even after the mutable cursor is restored", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE recurring_investments SET next_execution_date=$1 WHERE id=$2", [fixture.today, planId]);
      await expect(client.query("INSERT INTO investment_sip_occurrence_fences(plan_id,original_due_date) VALUES($1,$2)", [planId, fixture.today]))
        .rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("recomputes v2 terms from only retained financial and seven proof facts before and after actual erasure", async () => {
    const before = await retainedFrame();
    const verify = (rows: typeof before) => {
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.authorization_contract_version).toBe(2);
        expect(row.sql_digest).toBe(row.authorized_terms_digest);
        expect(digestSipFillProofTerms({ contractVersion: 2, contractType: "record_only_sip_actual_fill",
          accountId: row.account_id, securityId: row.security_id, quantity: row.quantity, price: row.price,
          fees: row.fees, amount: row.amount, currency: row.currency, executionDate: row.execution_date,
          authorizedFrequency: row.authorized_frequency, authorizedInitialDate: row.authorized_initial_date,
          fxRate: row.fx_rate, amountZmw: row.amount_zmw })).toBe(row.authorized_terms_digest);
      }
    };
    verify(before);
    await eraseAccount({ userId: fixture.home.id, householdId: fixture.homeHouseholdId, userEmail: fixture.home.email });
    const after = await retainedFrame();
    expect(after).toEqual(before);
    verify(after);
    expect((await pool.query("SELECT * FROM investment_sip_occurrences WHERE plan_id=$1", [planId])).rows).toEqual([]);
    expect((await pool.query("SELECT * FROM investment_sip_confirmations WHERE plan_id=$1", [planId])).rows).toEqual([]);
    expect((await pool.query("SELECT * FROM investment_sip_confirmed_fills WHERE purchase_id=ANY($1::uuid[])", [purchaseIds])).rows).toEqual([]);
    const fence = (await pool.query("SELECT * FROM investment_sip_occurrence_fences WHERE plan_id=$1", [planId])).rows;
    expect(fence).toHaveLength(1);
    expect(fence[0].terminal).toBe(true);
    expect(Object.keys(fence[0]).sort()).toEqual(["original_due_date", "plan_id", "terminal"]);
    const financialAudit = (await pool.query("SELECT * FROM audit_logs WHERE entity_id=ANY($1::uuid[])", [purchaseIds])).rows;
    const retained = JSON.stringify({ after, financialAudit, fence });
    expect(retained).not.toContain("synthetic-private-statement-ref");
    expect(retained).not.toContain(createHash("sha256").update("synthetic-private-statement-ref", "utf8").digest("hex"));
  });
});

async function probeRejectedConfirmation(input: ConfirmationInput, statement: SQL, expectedMessage: string) {
  const before = await confirmationSnapshot(fixture);
  const runTransaction = transactions.withTransaction;
  const causes: unknown[] = [];
  const probe = vi.spyOn(transactions, "withTransaction").mockImplementationOnce(
    <T>(operation: (tx: TransactionType) => Promise<T>) => runTransaction(async tx => {
      await operation(tx);
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      const closure = await tx.execute(sql`
        SELECT c.outcome,c.fill_count,o.state,f.terminal
        FROM public.investment_sip_confirmations c
        JOIN public.investment_sip_occurrences o USING (plan_id,original_due_date)
        JOIN public.investment_sip_occurrence_fences f USING (plan_id,original_due_date)
        WHERE c.plan_id=${planId}::uuid AND c.operation_id=${input.operationId}::uuid
      `);
      expect(closure.rows).toEqual([
        { outcome: input.outcome, fill_count: input.fills.length, state: "closed", terminal: true },
      ]);
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      try {
        await tx.execute(statement);
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      } catch (error) {
        let cause: unknown = error;
        for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
          causes.push(cause);
          cause = (cause as { cause?: unknown }).cause;
        }
        throw error;
      }
      // Even when testing an earlier migration, a missing guard cannot commit the probe.
      return tx.rollback();
    }),
  );
  try {
    await signedConfirmation(app, fixture, "home", "post", confirmationPath(planId, fixture.today))
      .send(input).expect(500);
  } finally {
    probe.mockRestore();
  }
  expect(await confirmationSnapshot(fixture)).toEqual(before);
  expect(causes).toContainEqual(expect.objectContaining({ code: "23514", message: expectedMessage }));
}

function inputFor(outcome: "filled" | "unfilled"): ConfirmationInput {
  const input = confirmationInput(fixture);
  return outcome === "filled" ? input : { ...input, outcome, fills: [] };
}

describe("C3-06 confirmation storage after early constraint checks", () => {
  it.each(["filled", "unfilled"] as const)("blocks deleting the plan while its %s closure is still being recorded", async outcome => {
    await probeRejectedConfirmation(inputFor(outcome), sql`
      DELETE FROM public.recurring_investments
      WHERE id=${planId}::uuid AND household_id=${fixture.homeHouseholdId}::uuid
    `, "Current confirmation witnesses must survive their creation transaction");
  });

  it.each(["filled", "unfilled"] as const)("blocks direct fence deletion during its %s closure transaction", async outcome => {
    await probeRejectedConfirmation(inputFor(outcome), sql`
      DELETE FROM public.investment_sip_occurrence_fences
      WHERE plan_id=${planId}::uuid AND original_due_date=${fixture.today}::date
    `, "Current confirmation witnesses must survive their creation transaction");
  });

  it.each(["filled", "unfilled"] as const)("blocks direct occurrence deletion during its %s closure transaction", async outcome => {
    await probeRejectedConfirmation(inputFor(outcome), sql`
      DELETE FROM public.investment_sip_occurrences
      WHERE plan_id=${planId}::uuid AND original_due_date=${fixture.today}::date
        AND household_id=${fixture.homeHouseholdId}::uuid
    `, "Current confirmation witnesses must survive their creation transaction");
  });

  it.each(["filled", "unfilled"] as const)("blocks direct confirmation deletion during its %s closure transaction", async outcome => {
    const input = inputFor(outcome);
    await probeRejectedConfirmation(input, sql`
      DELETE FROM public.investment_sip_confirmations
      WHERE plan_id=${planId}::uuid AND original_due_date=${fixture.today}::date
        AND household_id=${fixture.homeHouseholdId}::uuid AND operation_id=${input.operationId}::uuid
    `, "Current confirmation witnesses must survive their creation transaction");
  });

  it("blocks a custody privacy change that leaves a shared financial audit", async () => {
    await probeRejectedConfirmation(inputFor("filled"), sql`
      UPDATE public.accounts SET is_private=true,owner_user_id=${fixture.home.id}::uuid
      WHERE id=${fixture.homeAccountId}::uuid AND household_id=${fixture.homeHouseholdId}::uuid
    `, "Actual confirmation requires one complete atomic closure");
  });

  it.each(["filled", "unfilled"] as const)("rechecks original custody scope after recording a %s closure", async outcome => {
    await probeRejectedConfirmation(inputFor(outcome), sql`
      UPDATE public.accounts SET household_id=${fixture.otherHouseholdId}::uuid
      WHERE id=${fixture.homeAccountId}::uuid AND household_id=${fixture.homeHouseholdId}::uuid
    `, "Actual confirmation requires one complete atomic closure");
  });

  it("blocks truncating the mandatory audit of an unfilled closure", async () => {
    await probeRejectedConfirmation(inputFor("unfilled"), sql`TRUNCATE TABLE public.audit_logs`,
      "Current confirmation evidence cannot be truncated");
  });

  it("blocks truncating lots for fills recorded in the same transaction", async () => {
    await probeRejectedConfirmation(inputFor("filled"), sql`TRUNCATE TABLE public.tax_lot_disposals,public.tax_lots`,
      "Current confirmation evidence cannot be truncated");
  });
});

describe("C3-06 fill reservation requires a genuinely new purchase", () => {
  it("rejects a committed signed BUY under a current confirmation and accepts genuine new fill INSERTs", async () => {
    const input = confirmationInput(fixture);
    const firstFill = input.fills[0];
    const opening = await signedConfirmation(app, fixture, "home", "post", "/api/investments/holdings")
      .send({
        operationId: randomUUID(), expectedCurrency: "ZMW", accountId: fixture.homeAccountId,
        securityId: fixture.referenceSecurityId, quantity: "0", costBasis: "0.00",
        acquiredDate: firstFill.executionDate,
      }).expect(201);
    const oldBuy = await signedConfirmation(app, fixture, "home", "post", "/api/investments/transactions")
      .send({
        accountId: fixture.homeAccountId, holdingId: opening.body.data.id,
        securityId: fixture.referenceSecurityId, type: "buy", quantity: firstFill.quantity,
        price: firstFill.price, fees: firstFill.fees, amount: "4.80", currency: "ZMW",
        transactionDate: firstFill.executionDate,
      }).expect(201);
    const oldPurchaseId: string = oldBuy.body.data.id;
    const before = await confirmationSnapshot(fixture);
    expect(before.purchases).toMatchObject([{
      id: oldPurchaseId, type: "buy", quantity: firstFill.quantity, price: firstFill.price,
      fees: firstFill.fees, amount: "4.80", transactionDate: firstFill.executionDate,
    }]);
    expect(before.lots).toMatchObject([{ transactionId: oldPurchaseId, quantity: firstFill.quantity, costBasis: "4.80" }]);
    expect(before.proofs).toEqual([]);
    expect(before.fills).toEqual([]);

    const realPost = posting.postSipOccurrenceFill;
    const causes: unknown[] = [];
    const adoption = vi.spyOn(posting, "postSipOccurrenceFill").mockImplementationOnce(
      async (tx, _source, confirmationId, fillIndex, fill) => {
        const current = await tx.execute(sql`
          SELECT c.actor_user_id,c.fill_count,o.state,f.terminal,
            public.investment_sip_owns_xid(c.xmin) AS current_confirmation,
            public.investment_sip_owns_xid(p.xmin) AS current_purchase
          FROM public.investment_sip_confirmations c
          JOIN public.investment_sip_occurrences o USING(plan_id,original_due_date)
          JOIN public.investment_sip_occurrence_fences f USING(plan_id,original_due_date)
          CROSS JOIN public.investment_transactions p
          WHERE c.id=${confirmationId}::uuid AND c.operation_id=${input.operationId}::uuid
            AND p.id=${oldPurchaseId}::uuid
        `);
        expect(current.rows).toEqual([{
          actor_user_id: fixture.home.id, fill_count: 2, state: "pending", terminal: false,
          current_confirmation: true, current_purchase: false,
        }]);
        expect(fillIndex).toBe(0);
        expect(fill).toMatchObject(firstFill);
        try {
          await tx.execute(sql`
            INSERT INTO public.investment_sip_confirmed_fills
              (confirmation_id,fill_index,purchase_id,execution_date,quantity,price,fees,amount)
            SELECT ${confirmationId}::uuid,${fillIndex},p.id,p.transaction_date,p.quantity,p.price,p.fees,p.amount
            FROM public.investment_transactions p WHERE p.id=${oldPurchaseId}::uuid
          `);
        } catch (error) {
          let cause: unknown = error;
          for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
            causes.push(cause);
            cause = (cause as { cause?: unknown }).cause;
          }
          throw error;
        }
        // A missing origin guard still rolls this adversarial attempt back.
        return tx.rollback();
      },
    );
    try {
      await signedConfirmation(app, fixture, "home", "post", confirmationPath(planId, fixture.today))
        .send(input).expect(500);
      expect(adoption).toHaveBeenCalledOnce();
    } finally {
      adoption.mockRestore();
    }
    expect(causes).toContainEqual(expect.objectContaining({
      code: "23514", message: "Actual fill reservation is unavailable or immutable",
    }));
    expect(await confirmationSnapshot(fixture)).toEqual(before);

    const currentOrigins: boolean[] = [];
    const positive = vi.spyOn(posting, "postSipOccurrenceFill").mockImplementation(
      async (...args) => {
        const purchaseId = await realPost(...args);
        const [tx, , confirmationId] = args;
        const origin = await tx.execute<{ current_purchase: boolean; current_confirmation: boolean }>(sql`
          SELECT public.investment_sip_owns_xid(p.xmin) AS current_purchase,
            public.investment_sip_owns_xid(c.xmin) AS current_confirmation
          FROM public.investment_transactions p
          JOIN public.investment_sip_confirmed_fills f ON f.purchase_id=p.id
          JOIN public.investment_sip_confirmations c ON c.id=f.confirmation_id
          WHERE p.id=${purchaseId}::uuid AND c.id=${confirmationId}::uuid
            AND f.posting_confirmed
        `);
        expect(origin.rows).toEqual([{ current_purchase: true, current_confirmation: true }]);
        currentOrigins.push(origin.rows[0].current_purchase);
        return purchaseId;
      },
    );
    let newPurchaseIds: string[] = [];
    try {
      const accepted = await signedConfirmation(app, fixture, "home", "post", confirmationPath(planId, fixture.today))
        .send(input).expect(200);
      newPurchaseIds = accepted.body.data.occurrence.result.fills.map((fill: { purchaseId: string }) => fill.purchaseId);
      expect(positive).toHaveBeenCalledTimes(2);
      expect(currentOrigins).toEqual([true, true]);
    } finally {
      positive.mockRestore();
    }
    expect(newPurchaseIds).toHaveLength(2);
    expect(new Set(newPurchaseIds).size).toBe(2);
    expect(newPurchaseIds).not.toContain(oldPurchaseId);
    const after = await confirmationSnapshot(fixture);
    expect(after.purchases).toHaveLength(3);
    expect(after.purchases.filter(row => row.id === oldPurchaseId)).toEqual(before.purchases);
    expect(after.lots).toHaveLength(3);
    expect(after.lots.filter(row => row.transactionId === oldPurchaseId)).toEqual(before.lots);
    expect(after.fills).toHaveLength(2);
    expect(after.proofs).toHaveLength(2);
    expect(after.proofs.map(row => row.purchase_id).sort()).toEqual([...newPurchaseIds].sort());
    expect(after.proofs.every(row => row.authorization_contract_version === 2
      && row.author_user_id === fixture.home.id)).toBe(true);
  });
});
