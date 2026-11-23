-- Lane 3, in one migration (renumbered 0047 under the coordinator's merge-order rule):
-- 1. holdings.acquisition_fx_rate NUMERIC(10,4) -> NUMERIC(18,8), matching the
--    purchase and lot columns widened in 0041, so a declared opening can carry
--    its dated household rate's 8 places. Widening only: every value fits, no
--    row is refused, no backfill. No view, rule or SQL function reads this
--    column; the server compares it numerically where an older 4-place text
--    form may be stored (receipts, CREATE audits).
-- 2. (NEW-21 F4) a confirmed foreign SIP fill's CREATE audit names the rate
--    row its dated conversion used, as `fxRateSource` {kind, id, date}.
--    Replaces c306_sip_fill_evidence only:
--    * a null pair is accepted only on a ZMW fill (0042 also let a foreign
--      fill with no conversion through); otherwise judged as in 0042;
--    * a foreign fill must name the exact row the converter chooses for its
--      date: this household's override valid on the date with the newest
--      effective date, else (no such override) the provider row dated on or
--      before it, newest date first, lowest id on a same-day tie. Same pair
--      and rate. Another household's row, an equal-rate row it did not choose,
--      or no fxRateSource at all is refused.
--    Every caller runs this only inside the fill's own creation transaction
--    (investment_sip_owns_xid), so a fill confirmed before this migration is
--    never judged again and keeps its 0042 audit form.
ALTER TABLE "holdings" ALTER COLUMN "acquisition_fx_rate" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.c306_sip_fill_evidence(purchase_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills f
    JOIN public.investment_sip_confirmations c ON c.id=f.confirmation_id
    JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
    JOIN public.investment_transactions p ON p.id=f.purchase_id
    JOIN public.holdings h ON h.id=p.holding_id AND h.household_id=o.household_id
      AND h.account_id=o.account_id AND h.security_id=o.security_id
    JOIN public.accounts custody ON custody.id=o.account_id AND custody.household_id=o.household_id
    WHERE p.id=purchase_uuid AND f.posting_confirmed AND p.type='buy'
      AND p.household_id=o.household_id AND p.account_id=o.account_id AND p.security_id=o.security_id
      AND p.currency=o.currency AND p.quantity=f.quantity AND p.price=f.price AND p.fees=f.fees
      AND p.amount=f.amount AND p.transaction_date=f.execution_date AND ((p.currency='ZMW' AND p.fx_rate IS NULL AND p.amount_zmw IS NULL) OR (p.currency<>'ZMW' AND p.fx_rate>0
        AND p.amount_zmw IS NOT NULL AND p.amount_zmw=round(p.amount*p.fx_rate,2)))
      AND p.linked_transaction_id IS NULL AND p.notes IS NULL AND coalesce(p.withholding_tax,0)=0
      AND (SELECT count(*) FROM public.tax_lots l WHERE l.transaction_id=p.id)=1
      AND EXISTS(SELECT 1 FROM public.tax_lots l WHERE l.transaction_id=p.id AND l.holding_id=p.holding_id
        AND l.household_id=p.household_id AND l.quantity=p.quantity AND l.cost_basis=p.amount
        AND l.remaining_quantity=l.quantity AND l.acquired_date=p.transaction_date
        AND l.cost_basis_zmw IS NOT DISTINCT FROM p.amount_zmw AND l.acquisition_fx_rate IS NOT DISTINCT FROM p.fx_rate)
      AND (SELECT count(*) FROM public.audit_logs a WHERE a.entity_id=p.id
        AND a.entity_type='investment_transaction' AND a.action='CREATE')=1
      AND EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_id=p.id AND a.entity_type='investment_transaction'
        AND a.action='CREATE' AND a.user_id=c.actor_user_id AND a.ip_address IS NULL
        AND ((custody.is_private AND a.household_id IS NULL) OR (NOT custody.is_private AND a.household_id=o.household_id))
        AND ((p.currency='ZMW' AND p.fx_rate IS NULL AND a.details=jsonb_build_object('newValue',jsonb_build_object('type','buy','accountId',p.account_id::text,
          'holdingId',p.holding_id::text,'securityId',p.security_id::text,'quantity',p.quantity::text,'amount',p.amount::text,
          'currency',p.currency,'transactionDate',to_char(p.transaction_date,'YYYY-MM-DD'),'price',p.price::text,
          'fees',p.fees::text,'feesDeclared',true)))
        OR (p.fx_rate IS NOT NULL AND jsonb_typeof(a.details->'fxRateSource')='object'
          AND a.details=jsonb_build_object('newValue',jsonb_build_object('type','buy','accountId',p.account_id::text,
            'holdingId',p.holding_id::text,'securityId',p.security_id::text,'quantity',p.quantity::text,'amount',p.amount::text,
            'currency',p.currency,'transactionDate',to_char(p.transaction_date,'YYYY-MM-DD'),'price',p.price::text,
            'fees',p.fees::text,'feesDeclared',true,'fxRate',p.fx_rate::text,'amountZmw',p.amount_zmw::text),
            'fxRateBasis','dated_household_then_provider_fx_v1',
            'fxRateSource',jsonb_build_object('kind',a.details->'fxRateSource'->>'kind','id',a.details->'fxRateSource'->>'id',
              'date',a.details->'fxRateSource'->>'date'))
          AND ((a.details->'fxRateSource'->>'kind'='household' AND EXISTS(SELECT 1 FROM public.household_fx_rate_overrides r
                WHERE r.id::text=a.details->'fxRateSource'->>'id' AND r.rate=p.fx_rate
                  AND to_char(r.effective_date,'YYYY-MM-DD')=a.details->'fxRateSource'->>'date'
                  AND r.id=(SELECT own.id FROM public.household_fx_rate_overrides own
                    WHERE own.household_id=o.household_id AND own.from_currency=p.currency AND own.to_currency='ZMW'
                      AND own.effective_date<=p.transaction_date AND own.valid_through>=p.transaction_date
                    ORDER BY own.effective_date DESC LIMIT 1)))
            OR (a.details->'fxRateSource'->>'kind'='provider'
              AND NOT EXISTS(SELECT 1 FROM public.household_fx_rate_overrides own
                WHERE own.household_id=o.household_id AND own.from_currency=p.currency AND own.to_currency='ZMW'
                  AND own.effective_date<=p.transaction_date AND own.valid_through>=p.transaction_date)
              AND EXISTS(SELECT 1 FROM public.fx_rates s
                WHERE s.id::text=a.details->'fxRateSource'->>'id' AND s.rate=p.fx_rate
                  AND to_char(s.date,'YYYY-MM-DD')=a.details->'fxRateSource'->>'date'
                  AND s.id=(SELECT shared.id FROM public.fx_rates shared
                    WHERE shared.from_currency=p.currency AND shared.to_currency='ZMW' AND shared.date<=p.transaction_date
                    ORDER BY shared.date DESC, shared.id ASC LIMIT 1))))))))
$body$;
