# Household calendar for confirming scheduled purchases

14 November 2026. **Owner selected explicit shared household timezone and holding confirmation until chosen.** Main relayed the direct answer. The alternatives below preserve the proposal's decision context; no question remains open. Source preparation is authorized, while exact SQL review, runtime and integration remain separate.

The application needs one shared meaning of “today” when checking the execution dates entered from a final broker statement. It currently has personal timezone settings, but no authoritative household timezone. A member's personal setting must not change household policy. We cannot infer the household's timezone from a device, a signed-in member or existing financial dates.

| Choice | What it means for the household's records |
| --- | --- |
| **Explicit household timezone selected by the owner — recommended** | The owner chooses an IANA timezone for the household. Every member's confirmation uses that shared calendar, regardless of personal display settings. Before selection, operations that require this cutoff stay held with an explanation. Existing dates remain unchanged; no timezone is guessed or backfilled. |
| **UTC for every household** | All members use the same UTC calendar. No household selection is needed, but near midnight a date that is already “today” locally can still be “tomorrow” in UTC. Users may have to wait until the UTC date changes before recording an actual local-date fill. Existing dates remain unchanged. |

For example, at 00:30 in Africa/Lusaka it is still 22:30 on the previous UTC date. The first option can recognize the household's local day; the second intentionally uses the earlier UTC date. Personal display settings would change neither rule.

I recommend explicit owner selection and holding the dependent cutoff until that selection exists. It makes the shared policy visible and avoids inventing history. Confirmation records each actual fill's evidenced date; it does not force that date to equal or follow the scheduled date. Existing FIFO/backdated-trade safeguards still apply.

The accepted mapping adds nullable `households.time_zone`, with no default/backfill. The current owner selects a supported named zone through the dedicated calendar route. Existing households remain unset until that explicit action; confirmation holds before effects. Every new batch uses one database-authored instant and the locked chosen zone. Personal/device settings are not household policy. Main separately reviewed that source contract; this proposal itself applies no schema and claims no working behavior. All verification stays on Main's schedule.
