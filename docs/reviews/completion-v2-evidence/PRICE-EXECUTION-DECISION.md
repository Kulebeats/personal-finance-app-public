# Price evidence for scheduled share purchases

**Owner decision, 14 November 2026: option 3 selected.** Each scheduled share-purchase occurrence requires an authorized user's confirmation from actual execution evidence before recording. Reference quotes must not silently establish actual purchase cost basis. A due schedule can identify an occurrence needing confirmation; it cannot autonomously record a completed purchase from a quote. The global-price write and household-isolation rules below remain required. Implementation must preserve original occurrence identity and replay safety. Details not established by this decision must not be invented.

The master already settles who may write prices: global market data is service-written; owner/admin overrides belong only to their own household. Existing manual global rows must not be assigned an invented source or owner.

The remaining choice is which evidence may authorize an unattended scheduled purchase. The existing update timestamp records when a value was written or fetched, not necessarily when the market observed it. It cannot establish freshness.

1. **Provider quote dated the execution day — recommended initial policy.** Require an attributable quote dated that day in the instrument's exchange timezone. Missing, older, future-dated or unverifiable quotes hold the occurrence without financial writes. A household manual override cannot authorize unattended execution. Weekends and outages may delay recording.
2. **Latest completed exchange session's closing price.** Allow the latest evidenced close until the next session closes, using an explicit exchange calendar. This accommodates weekends and holidays but accepts overnight movement and requires calendar support.
3. **Confirm each occurrence from actual execution evidence.** An authorized user supplies attributable execution price and date evidence before recording. This avoids treating a reference quote as an actual fill, but requires manual confirmation.

In every option, preserve the price source, observation time, instrument, currency and quote identity with the purchase. Never substitute fetch time or relabel legacy manual prices as trusted. This decision concerns application recording, not an instruction to place a market trade.

The owner's selection above settles the execution-price policy. The earlier three-day weekly-recap FX decision does not apply to this share-price policy. No claim about Yahoo Finance coverage was used to make this decision; that coverage has not been verified here.

## Validity of household prices in valuations

On 15 November 2026, the owner chose an explicit validity end date. Use a household's authorized override from its stated effective date through the selected end date, inclusive. Store both calendar dates as supplied. Outside the selected dates, valuation needs other eligible evidence. Show an unvalued holding and an incomplete total when required evidence is missing.

The existing owner and admin authorization for household-local overrides still applies. A global provider record and another household's valuation stay independent of these entries. Preserve exact price, currency, instrument, source and actor provenance. The selected date window does not authorize a scheduled purchase. A purchase requires the actual fills and authorized confirmation.
