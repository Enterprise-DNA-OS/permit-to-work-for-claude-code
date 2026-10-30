# Permit to Work for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS] (the demo is Harbourside Milling, a fictional flour and stockfeed mill at Mount Maunganui)
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| a new dashboard page | `/new-view` |
| add a field, change a rule | `/customise` |
| add a note | `/log` |
| add areas, plant, points, companies, people | `/add` |
| all rule checks | `/compliance` |
| all tickets and licences | `/tickets` |
| bring data from iPermit | `/import` |
| cancel a permit never issued | `/cancel` |
| clashing permits, SIMOPS | `/conflicts` |
| close a permit, hand the area back | `/close` |
| contractor companies | `/contractors` |
| contractors on site, who has lapsed | `/contractor-check` |
| end of shift, handover sheet | `/end-of-shift` |
| export everything | `/export` |
| fire watch finished | `/fire-watch-done` |
| gas test limits | `/gas-limits` |
| gas tests, is a retest due | `/gas` |
| hand a permit to the next shift | `/handover` |
| hot work tools down | `/finish` |
| isolate plant, lock out | `/isolate` |
| isolation hours by asset | `/history` |
| isolation points | `/points` |
| isolations in place | `/isolations` |
| issue a permit | `/issue` |
| link an isolation to a permit | `/link` |
| look up a company | `/company` |
| look up a permit | `/permit` |
| look up a person | `/person` |
| look up a piece of plant | `/asset` |
| look up an isolation certificate | `/isolation` |
| permit kinds and their controls | `/kinds` |
| permits waiting to be issued | `/requested` |
| permits, certificates, entry logs to print | `/documents` |
| personal lock off | `/lock-off` |
| personal lock on | `/lock-on` |
| personal locks on | `/locks` |
| proved dead, test for dead | `/verify` |
| raise a permit | `/new-permit` |
| recent permits | `/permits` |
| record a gas test | `/gas-test` |
| record or renew a ticket | `/ticket` |
| remove an isolation | `/deisolate` |
| restart a suspended job | `/resume` |
| save the handover sheet | `/draft-handover` |
| save the review as a draft | `/draft-weekly` |
| sign a worker off | `/sign-off` |
| sign a worker on | `/sign-on` |
| someone came out | `/exit` |
| someone went into a confined space | `/enter` |
| start of shift, what is live, what is on fire | `/start-of-shift` |
| stop the job, alarm, weather | `/suspend` |
| the Monday safety review | `/weekly-review` |
| the monthly permit audit | `/permit-audit` |
| the permit board, what is live | `/board` |
| walk the isolations and locks, LOTO check | `/lockout-check` |
| what lapses soon | `/expiring` |
| what needs doing now | `/attention` |
| who is in the silo, the tank, the pit | `/inside` |
| who is on site | `/people` |
| write to a contractor about renewals | `/draft-contractor` |

If an ask fits nothing here, run the CLI directly (`npm run permits -- help`) and then propose a new command for it.

## How a permit site runs (read before you change anything)

- Times are site wall-clock in `ptw.settings.timezone`. `ptw.site_now()` is now on site. Every command takes times as `2026-11-02 07:00`, `now` or `+8h`.
- A permit moves requested, issued (or suspended), then closed. A requested permit that never ran is cancelled. Only issued permits carry live work.
- What each permit kind needs (crew ticket, isolation, gas test, standby, fire watch, longest validity) is `ptw.permit_kinds`. Which kinds clash is `ptw.conflict_rules`. Gas limits are `ptw.gas_limits`. Tickets are `ptw.ticket_kinds`. The operator owns all four; docs/compliance.md cites where each row comes from.
- An isolation covers one asset. It is applied (points locked with lock numbers), then verified (proved dead), then removed. Verify refuses until every point on the asset is locked. Remove refuses while a permit relies on it or a personal lock is on.
- `issue`, `resume`, `sign-on`, `enter` and `close` refuse a rule breach unless the operator names who accepts it (`--override-by`), and that is noted on the permit. Never pass an override the operator did not name.
- Only the owner takes off a personal lock. Never suggest cutting one; that is the site's lock removal procedure, with a named authoriser.
- Anyone recorded inside a confined space comes first in every answer.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off IAMTech iPermit.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/ipermit
