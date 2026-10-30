# Moving off IAMTech iPermit

This guide moves a site's people, tickets and permit history from IAMTech iPermit (or any permit system that can save a list as CSV) into Permit to Work for Claude Code. Plan a day for a single site, with a week of running both side by side.

## 1. Get your records out

IAMTech says its permits download as PDF at any stage, and that iPermit integrates with Active Directory, SAP PM and IBM Maximo through an API. It does not publish a CSV export format. Ask IAMTech, or your administrator, for two lists saved as CSV:

- **The training matrix**: one row per person per ticket. Columns like `Name`, `Company`, `Ticket`, `Ref`, `Expiry`, `Induction Expiry`.
- **The permit register**: one row per permit. Columns like `Permit No`, `Permit Type`, `Location`, `Equipment`, `Description`, `Performing Authority`, `Issuing Authority`, `Status`, `Valid From`, `Valid To`, `Closed`.

If the API is the only way out, Enterprise DNA writes the extract as part of the switch. The examples in `examples/` show the shapes this base reads.

## 2. Set up the site first

Add your areas, assets and each asset's isolation points (`/add`). The isolation point list is the part no export carries well and the part that matters most: every energy source on every piece of plant, the device, how it is locked and how it is proved dead. Walk the plant with your isolators and write it down once.

## 3. Import people, then permits

```bash
npm run permits -- import training-matrix --file=imports/training-matrix.csv --dry-run
npm run permits -- import training-matrix --file=imports/training-matrix.csv
npm run permits -- import permit-register --file=imports/permit-register.csv --dry-run
npm run permits -- import permit-register --file=imports/permit-register.csv
```

People first, so permits find their issuers and receivers by name. Every import runs in one transaction: a bad row stops it and nothing is written. Running it again skips rows it already brought in.

## What maps

| From the export | To |
|---|---|
| Name, Company | `ptw.people`, `ptw.companies` (a new company comes in as a contractor; people with no company join your own) |
| Ticket, Ref, Expiry | `ptw.tickets`, mapped to a ticket kind by name (`Confined Space Entry` to `CS_ENTRY`, `Hot Work` to `HOT_WORK`, `Authorised Isolator` to `ISOLATOR` and so on; the list is `TICKET_ALIASES` in `scripts/permits.mjs`) |
| Induction Expiry | `ptw.people.induction_expires_on` |
| Permit No, Permit Type | `ptw.permits.code` and `kind` (Hot Work, Confined Space, Electrical, Working at Height, Excavation, Lifting, Cold Work or General) |
| Location, Equipment | `ptw.areas`, `ptw.assets`, created by name when they do not exist |
| Description, Performing Authority, Issuing Authority | `task`, `receiver_id`, `issuer_id` |
| Status, Valid From, Valid To, Closed | `status` and times. Dates as `YYYY-MM-DD HH:MM` or `DD/MM/YYYY HH:MM` |

## What does not carry over

- **Open permits are not carried over as live.** A permit that was active in iPermit comes in as requested, with a note. Isolate, test and issue it here before work goes on. Nobody should inherit an isolation they did not see applied.
- Isolation certificates, lock numbers, personal locks, gas test readings and confined space entries from iPermit's history. Keep the PDFs for your records retention period.
- Signatures and photos. This base records who did what and when; if you want signatures and photos on a phone, that is part of a custom version.
- Risk assessments (JSA, HIRA). The permit keeps the reference (`risk_ref`); the assessment stays where you keep documents.

## Run both for a week

Raise each new permit in both systems for a week. When the board, the isolations and the people inside match at each shift change, stop raising permits in iPermit.
