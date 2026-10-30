<h1 align="center">Permit to Work for Claude Code</h1>

<p align="center">
  <strong>The open-source permit to work and isolation system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your IAMTech iPermit data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=ipermit">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/ipermit?utm_source=github&utm_medium=readme&utm_campaign=ipermit">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-ipermit">Instead of IAMTech iPermit</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Permit to Work for Claude Code does the job you pay IAMTech iPermit for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the IAMTech iPermit dashboard cannot.

IAMTech publishes iPermit as four annual licences: US$19,500 a year for up to 10 named users, US$39,000 for up to 100, US$65,000 for up to 500 and US$97,500 for up to 1,000, with online training courses extra on the two smaller tiers ([IAMTech iPermit pricing](https://www.iamtech.com/products/permit-software), checked 30 October 2026). A site with eleven people who issue, receive or isolate is already on the US$39,000 tier. The free code still has hosting, agent and support costs.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=ipermit).

It is for sites in New Zealand and Australia that run permits from a maintenance office: food, grain and dairy processors, mills, packhouses, water and wastewater plants, manufacturers, and the contractors who work on them. It keeps permits by kind (hot work, confined space, electrical, work at height, excavation, lifting, general) with their issuer, receiver, crew and standby, isolations with every energy point on the asset, lock numbers and personal locks, gas tests against limits, confined space entries in and out, shift handovers, and the tickets, inductions and insurance of everyone on site. It refuses to issue a permit on plant nobody proved dead, lets nobody into a space on a stale gas test, and will not remove an isolation while a lock or a permit is still on it, with each rule cited in [docs/compliance.md](docs/compliance.md).

The demo is a fictional flour and stockfeed mill at Mount Maunganui, Harbourside Milling. Right now a contractor is inside wheat silo 3 on a gas test more than two and a half hours old, taken by a shift coordinator whose gas testing ticket lapsed five days ago, and the entrant's own confined space ticket lapsed last week. The silo's isolation misses the aeration fan. A welder is doing hot work on the silo top gantry at the same time, with a site induction three days out of date, for a company whose insurance certificate ran out ten days ago. The bucket elevator job has run 20 hours on an isolation nobody tested for dead, with no shift handover. An electrical permit on the bagging line is an hour past its time. A fitter's personal lock is still on the roller mill six hours after that job closed, and yesterday's hot work on the dust collector closed after a 20-minute fire watch.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/permit-to-work-for-claude-code.git
cd permit-to-work-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/start-of-shift`. Follow it with `/lockout-check`, `/inside` and `/contractor-check`.

Or from the terminal:

```bash
npm test
npm run permits -- attention
npm run view
npm run docs
```

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/add` | Add areas, assets, isolation points, companies or people from a JSON file. |
| `/asset` | One asset: isolation points, recent isolations and permits, and its last 90 days. |
| `/attention` | Everything that needs someone now: people inside, rule breaches, permits ending soon, permits waiting to be issued, warnings, and tickets or insurance about to lapse. |
| `/board` | The live permit board: every issued or suspended permit with its time left, crew, people inside, isolation state and last gas test. |
| `/cancel` | Cancel a permit that was requested and never issued. |
| `/close` | Close a permit with the handback. Refuses while anyone is inside, crew are still signed on, or a hot work fire watch is incomplete. Names the isolations now free to remove. |
| `/company` | One company: contact, insurance, people, tickets to renew and notes. |
| `/compliance` | Check the records against the rules this industry lives under (the ones listed in docs/compliance.md) and report what is missing, late, or about to breach, with the rule cited. |
| `/conflicts` | Open permits that clash by the site's conflict rules: hot work near a confined space entry, lifting over work at height, two crews on one asset. |
| `/contractor-check` | Contractors on site: insurance, prequalification, inductions and tickets, and who on today's permits has lapsed. |
| `/contractors` | Contractor companies: insurance, prequalification, people, tickets to renew and open permits. |
| `/customise` | Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it. |
| `/deisolate` | Remove an isolation. Refuses while any permit relies on it or any personal lock is still on. |
| `/documents` | Render the paperwork in your brand: permits to work, isolation certificates, confined space entry logs and contractor compliance records. |
| `/draft-contractor` | Draft a note to a contractor listing lapsed or lapsing insurance, inductions and tickets. Never sent from here. |
| `/draft-handover` | Save the shift handover sheet as a draft in drafts/. |
| `/draft-weekly` | Save the weekly review as a draft in drafts/. |
| `/end-of-shift` | The end-of-shift handover: what is still open, isolated, locked and inside, written as a draft for the incoming shift, then a handover recorded on each open permit. |
| `/enter` | Record a person going into a confined space. Refuses unless they are signed on, ticketed, the gas test is fresh and inside limits, a standby is named and the permit is live. |
| `/exit` | Record a person coming out of a confined space. |
| `/expiring` | Tickets, inductions and contractor insurance that have lapsed or lapse in the warning window, soonest first. |
| `/export` | Write every record to one JSON file. |
| `/finish` | Hot work: tools down. Starts the fire watch and says when it can end. |
| `/fire-watch-done` | Hot work: record the end of the fire watch, and whether it ran the site's full time. |
| `/gas` | The last gas test on every permit that needs one: readings, age, tester and whether a retest is due. |
| `/gas-limits` | The gas test limits this site uses, with the source of each. |
| `/gas-test` | Record a gas test on a permit. The tester must hold a current gas testing ticket. The result says which reading failed, if any. |
| `/handover` | Record a shift handover on a permit. The new receiver must hold a current receiver ticket. |
| `/history` | Isolation hours and permits by asset over the last 90 days: the plant maintenance keeps going back to. |
| `/import` | Bring a training matrix and a permit register across from IAMTech iPermit or another permit system (saved as CSV). People and tickets first, then permits. |
| `/inside` | Who is inside a confined space right now, for how long, and who their standby is. |
| `/isolate` | Isolate an asset: lock out its energy points with lock numbers, by an authorised isolator, optionally linked to a permit. Names any point still live. |
| `/isolation` | One isolation certificate: every point on the asset with its lock number or NOT LOCKED, personal locks, the permits that rely on it. |
| `/isolations` | Isolations in place: asset, isolator, who proved it dead, points locked out of the asset's total, personal locks and the permits that rely on it. |
| `/issue` | Issue a requested permit. Refuses until the isolation is verified, the gas test is fresh and inside limits, a confined space has a standby and rescue plan, the receiver holds a current ticket, contractors are inducted and insured, and nothing clashes. |
| `/kinds` | The permit kinds and what each needs: crew ticket, isolation, gas test, standby, fire watch and longest validity. |
| `/link` | Link an isolation to a permit, so the isolation cannot be removed while the permit is open. |
| `/lock-off` | Record a personal lock taken off by its owner. |
| `/lock-on` | Record a personal lock put on an isolation lockbox. |
| `/lockout-check` | Walk the isolations: every isolation in place, its points and lock numbers, every personal lock still on, and any lock left on by someone with no open permit. |
| `/locks` | Personal locks still on, how long, and whether the person still has an open permit on that isolation. |
| `/log` | Add a note to a permit, isolation, person, company or asset. |
| `/new-permit` | Request a permit: kind, area, equipment, task, receiver and times. It starts as requested and is issued with /issue once its controls are in place. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/people` | Everyone active on site, by company, with their current tickets. |
| `/permit` | One permit: details, crew, isolations, gas tests, entries, handovers, rule findings and notes. |
| `/permit-audit` | The monthly permit audit: every rule finding, permits closed in the last 30 days with their handback, fire watch times, and where the isolation hours went. |
| `/permits` | Every permit from the last 30 days, and every open one. |
| `/person` | One person: company, tickets with days left, permits they are signed on to, locks they have on and whether they are inside. |
| `/points` | The isolation points for each asset: energy source, device, method and how to prove it dead. |
| `/requested` | Permits waiting to be issued, with the ticket gaps and isolation each still needs. |
| `/resume` | Resume a suspended permit. The issuer rechecks the controls, the same as issuing. |
| `/sign-off` | Sign a person off a permit. Refuses while they are recorded inside, and names any personal lock they still have on. |
| `/sign-on` | Sign a person on to an issued permit. Refuses if they lack the ticket the permit kind needs, or are a contractor with a lapsed induction or insurance. |
| `/start-of-shift` | The start-of-shift check for the permit coordinator: who is inside, what is live, what breaks a rule, what is waiting to be issued and what ends this shift. |
| `/suspend` | Suspend an issued permit (alarm, weather, a clash, a change in conditions). Names anyone still inside. |
| `/ticket` | Record or renew a ticket, authorisation or licence for a person. |
| `/tickets` | Every ticket, authorisation, licence and induction on record, with days left. |
| `/verify` | Record that an isolation was proved dead (try the start, test for dead, gauge at zero). Refuses until every point on the asset is locked. |
| `/weekly-review` | The Monday safety review, written from attention, the rule findings, tickets to renew and isolation hours. |

Views (`npm run view`): `board` (inside now, open permits, breaches, isolations, personal locks), `people` (ticket gaps on open permits, lapsed and lapsing tickets, contractors), `history` (isolation hours by asset, permits closed, fire watch times). Documents (`npm run docs`): permits to work, isolation certificates, confined space entry logs and contractor compliance records, in your `brand.json`.

## Ten questions iPermit's screens do not answer

Each one is a single question to Claude Code, answered from your own records today:

1. Who is inside a confined space right now, for how long, and who is their standby?
2. Which personal locks are still on from people who have signed off or whose permit has closed?
3. Which permits are running on an isolation nobody proved dead, or one that misses an energy point on the asset?
4. Who on today's permits, in any role, holds a lapsed ticket or none at all for what they are doing?
5. Which contractors on site today have a lapsed induction, and which of their companies has no current insurance certificate?
6. Which hot work permits are open in the same area as a confined space entry?
7. Which gas tests are older than our retest interval, and who took them?
8. Whose tickets, inductions and insurance lapse in the next 30 days, by company?
9. Which assets did we isolate most in the last 90 days, and for how many hours?
10. Which hot work permits closed before the fire watch ran its full time, and who kept the watch?

## Instead of IAMTech iPermit

Save your training matrix and permit register from iPermit as CSV and run `/import`, people first. [docs/replace-ipermit.md](docs/replace-ipermit.md) lists the column names the import reads, what carries over and what does not (open permits come in as requested, to be isolated, tested and issued here), and how to run both side by side for a week.

## Your first hour: ten things to ask for

1. "Set up our areas, our plant and every isolation point on it." (`/add`)
2. "Import our training matrix, then our permit register." (`/import`)
3. "Put our name, logo and colours on the permits and certificates." (edit `brand.json`, then `npm run docs`)
4. "What is live right now, and who is inside?" (`/start-of-shift`)
5. "Walk me through every isolation and personal lock on site." (`/lockout-check`)
6. "Which contractors need something renewed before Monday?" (`/contractor-check`)
7. "Raise a hot work permit on the mill floor for tomorrow morning." (`/new-permit`)
8. "Our fire watch is 90 minutes, not 60." (`/customise`)
9. "Add asbestos removal as a permit kind, with its own ticket." (`/customise`)
10. "Give me a board page for the control room screen." (`/new-view`)

## Architecture

```
permit-to-work-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Permit to Work for Claude Code for your business, migrates your IAMTech iPermit data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=ipermit)
- Read more: [enterprisedna.co/omni/instead-of/ipermit](https://enterprisedna.co/omni/instead-of/ipermit?utm_source=github&utm_medium=readme&utm_campaign=ipermit)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
