---
description: Issue a requested permit. Refuses until the isolation is verified, the gas test is fresh and inside limits, a confined space has a standby and rescue plan, the receiver holds a current ticket, contractors are inducted and insured, and nothing clashes.
---

Run `npm run permits -- issue <permit> --by=<issuer> [--standby=<person> --rescue="<plan>"]`. If it refuses, show the reasons and the command that fixes each. Only use `--override-by="<name>"` when the operator names who accepts the risk; the acceptance is written on the permit.
