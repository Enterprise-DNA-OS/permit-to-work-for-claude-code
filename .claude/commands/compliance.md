---
description: Check the records against the rules a permit to work site lives under (the ones in docs/compliance.md) and report every breach and warning, with the rule cited.
---

1. Run `npm run permits -- compliance`. Read `docs/compliance.md` for the source of each rule.
2. Report as a table: rule, count, the worst example, the source. Breaches first. Anyone inside a confined space on a breached permit goes at the very top.
3. For each breach, give the fix and the command that does it: retest (`/gas-test`), lock the missing point (`/isolate`), prove it dead (`/verify`), renew the ticket (`/ticket`), suspend one of two clashing permits (`/suspend`), record the handover (`/handover`). For a contractor, offer `/draft-contractor` (a draft, never sent).
4. If a rule in `docs/compliance.md` is out of date, say so and stop. Do not guess at law or standards. The operator confirms the rule, then you update the doc and the check together in a new migration.

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the data against them.
