---
description: The end-of-shift handover: what is still open, isolated, locked and inside, written as a draft for the incoming shift, then a handover recorded on each open permit.
---

Run `npm run permits -- draft-handover` and show the draft path. Then list each open permit from `npm run permits -- board` and ask who is handing over to whom. For each answer run `npm run permits -- handover <permit> --from=<person> --to=<person> --note="<state of the job>"`. The incoming receiver must hold a current receiver ticket; if the command refuses, say who can take it.
