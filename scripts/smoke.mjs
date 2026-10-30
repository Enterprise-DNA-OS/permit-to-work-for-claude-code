// npm test: a temporary database, every command, the rules and the edge cases. Never touches a live database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, READS, TABLES, date, when, mapPermitRow, mapTicketRow } from './permits.mjs';
import { parseCsv } from './lib/csv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'permits-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(temp, 'db');
process.env.OUTPUT_DIR = temp;
let db; let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const rejects = async (fn, re) => { await assert.rejects(fn, re); checks++; };
const file = (name, v) => { const f = path.join(temp, `${name}.json`); fs.writeFileSync(f, JSON.stringify(v)); return `--data=${f}`; };
function cli(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout); checks++;
  return r.stdout;
}
const one = async (sql, p = []) => (await db.query(sql, p))[0];
const rules = async () => (await db.query('select rule, ref from ptw.compliance_findings order by rule, ref')).map((r) => `${r.rule}|${r.ref}`);
const has = async (rule, ref) => (await rules()).includes(`${rule}|${ref}`);

try {
  db = await getDb();
  if (process.env.TEST_DATABASE_URL) await db.exec('drop schema if exists ptw cascade; drop table if exists schema_migrations');
  await migrate(db);
  eq((await migrate(db)).ran.length, 0, 'repeat migration is a no-op');
  await seed(db); await seed(db);
  eq((await one('select count(*)::int n from ptw.permits')).n, 15, 'permits seeded once');
  eq((await one('select count(*)::int n from ptw.gas_tests')).n, 8, 'gas tests seeded once');
  eq((await one('select count(*)::int n from ptw.personal_locks')).n, 12, 'personal locks seeded once');

  // Every read runs.
  for (const c of Object.keys(READS)) ok(Array.isArray(await run(db, [c])), c);
  eq((await run(db, ['help'])).reads.length, Object.keys(READS).length + 1, 'help lists every read');

  // The demo's deliberate problems are each caught by the rule meant for them.
  eq((await rules()).join('\n'), [
    'contractor-induction|permit P-2042', 'contractor-insurance|company BSF', 'fire-watch-short|permit P-2038', 'gas-test-stale|permit P-2041',
    'handover-missing|permit P-2044', 'isolation-incomplete|isolation ISO-311', 'isolation-not-verified|permit P-2044', 'isolation-orphaned|isolation ISO-305',
    'lock-left-on|isolation ISO-305', 'permit-conflict|permit P-2042 / P-2041', 'permit-expired|permit P-2045',
    'ticket-expired|permit P-2041', 'ticket-expired|permit P-2041'].join('\n'), 'demo findings');
  eq((await run(db, ['board'])).map((r) => r.code).join(','), 'P-2045,P-2044,P-2042,P-2041', 'board: expired first, then by end time');
  eq((await run(db, ['inside'])).map((r) => r.person).join(','), 'Paul Anders', 'one person inside');
  eq((await run(db, ['locks'])).filter((r) => r.flag).map((r) => r.person).join(','), 'Sione Fifita', 'one lock left on');
  eq((await run(db, ['conflicts'])).length, 1, 'one clash');
  eq((await run(db, ['history']))[0].asset, 'BE2', 'bucket elevator 2 carries the most isolation hours');
  eq((await run(db, ['history'])).find((r) => r.asset === 'INT1').hours_isolated, '0', 'an asset never isolated has no hours');
  const att = await run(db, ['attention']);
  eq(att[0].area, 'inside now', 'attention leads with who is inside');
  ok(att.some((r) => r.area === 'renew' && /Tauranga Confined Space Services/.test(r.item)), 'insurance lapsing shows');

  // Details.
  const p41 = await run(db, ['permit', 'P-2041']);
  eq(p41.crew.length, 3, 'permit crew'); eq(p41.gas_tests.length, 2, 'permit gas tests'); ok(p41.rule_findings.length >= 4, 'permit findings');
  eq((await run(db, ['isolation', 'ISO-311'])).points.find((r) => r.point === 'SIL3-E2').lock_no, 'NOT LOCKED', 'unlocked point shows');
  eq((await run(db, ['person', 'paul'])).inside.length, 1, 'person detail by partial name');
  ok((await run(db, ['asset', 'BE2'])).isolations.length >= 4, 'asset detail');
  eq((await run(db, ['company', 'BSF'])).people.length, 2, 'company detail');
  await rejects(() => run(db, ['person', 'a']), /Ambiguous/);

  // Fixing the demo clears its findings.
  await run(db, ['gas-test', 'P-2041', '--by=HEM', '--o2=20.9', '--lel=0', '--h2s=0', '--co=1', '--location=Silo 3 cone']);
  ok(!(await has('gas-test-stale', 'permit P-2041')), 'a fresh test clears the stale finding');
  await rejects(() => run(db, ['gas-test', 'P-2041', '--by=DAV', '--o2=20.9', '--lel=0']), /no current gas testing ticket/);
  const fail = await run(db, ['gas-test', 'P-2042', '--by=ANA', '--o2=19.0', '--lel=6']);
  ok(/oxygen 19.0%/.test(fail.result) && /6.0% LEL/.test(fail.result), 'a failed reading names each gas');
  ok(await has('gas-test-failed', 'permit P-2042'), 'failed gas test is a breach');
  await run(db, ['gas-test', 'P-2042', '--by=ANA', '--o2=20.9', '--lel=0']);
  await rejects(() => run(db, ['verify', 'ISO-310', '--by=MEG', '--note=x']), /not a current authorised isolator/);
  await run(db, ['verify', 'ISO-310', '--by=RAJ', '--note=Start pressed at head, nothing turns']);
  ok(!(await has('isolation-not-verified', 'permit P-2044')), 'verified isolation clears');
  await run(db, ['handover', 'P-2044', '--from=TOM', '--to=SIO', '--note=Half the buckets changed']);
  ok(!(await has('handover-missing', 'permit P-2044')), 'handover clears');
  eq((await one("select rq.code from ptw.permits p join ptw.people rq on rq.id = p.receiver_id where p.code = 'P-2044'")).code, 'SIO', 'handover moves the receiver');
  await rejects(() => run(db, ['handover', 'P-2044', '--from=SIO', '--to=MEG']), /not a current permit receiver/);

  // Locks and isolations: nobody removes an isolation with a permit or a lock still on it.
  await rejects(() => run(db, ['deisolate', 'ISO-305', '--by=SIO']), /personal locks still on \(Sione Fifita\)/);
  await rejects(() => run(db, ['lock-off', 'ISO-305', '--person=TOM']), /has no lock/);
  await run(db, ['lock-off', 'ISO-305', '--person=SIO']);
  ok(!(await has('lock-left-on', 'isolation ISO-305')), 'lock off clears');
  await run(db, ['deisolate', 'ISO-305', '--by=SIO']);
  ok(!(await has('isolation-orphaned', 'isolation ISO-305')), 'removed isolation clears');
  await rejects(() => run(db, ['deisolate', 'ISO-311', '--by=SIO']), /P-2041 still rely on it/);

  // Confined space: entry needs a signed-on person, a fresh test, a standby; nobody closes with someone inside.
  await rejects(() => run(db, ['close', 'P-2041', '--by=DAV', '--handback=x']), /Paul Anders still recorded inside/);
  await rejects(() => run(db, ['sign-off', 'P-2041', '--person=PAU']), /still recorded inside/);
  await rejects(() => run(db, ['enter', 'P-2041', '--person=MEG']), /not signed on/);
  await rejects(() => run(db, ['enter', 'P-2041', '--person=PAU']), /already inside/);
  eq((await run(db, ['exit', 'P-2041', '--person=PAU'])).inside_now, 0, 'exit');
  await rejects(() => run(db, ['enter', 'P-2041', '--person=PAU']), /no current entry ticket/);
  eq((await run(db, ['enter', 'P-2041', '--person=HEM'])).inside_now, 1, 'a ticketed entrant enters after a fresh test');
  await run(db, ['exit', 'P-2041', '--person=HEM']);
  const off = await run(db, ['sign-off', 'P-2041', '--person=PAU']);
  eq(off.locks_still_on.join(), 'P-PA on ISO-311', 'sign-off reminds about the personal lock');
  await run(db, ['lock-off', 'ISO-311', '--person=PAU']);

  // Close-out: everyone off first, handback recorded, isolations named for removal.
  await rejects(() => run(db, ['close', 'P-2041', '--by=DAV', '--handback=Hatch shut']), /still signed on: /);
  await run(db, ['sign-off', 'P-2041', '--person=SIO']); await run(db, ['sign-off', 'P-2041', '--person=HEM']);
  const closed = await run(db, ['close', 'P-2041', '--by=DAV', '--handback=Cone clear, hatch shut, all out and counted']);
  eq(closed.isolations_to_remove.join(), 'ISO-311 (2 personal locks still on)', 'close names the isolation to remove');
  ok(!(await has('permit-conflict', 'permit P-2042 / P-2041')), 'closing the entry clears the clash');

  // Hot work: tools down starts the fire watch; closing early needs a named override, which is noted.
  await rejects(() => run(db, ['finish', 'P-2044', '--fire-watch=TOM']), /finish is for hot work/);
  const fin = await run(db, ['finish', 'P-2042', '--fire-watch=TOM']);
  ok(/^\d{2}:\d{2}$/.test(fin.keep_watch_until), 'fire watch end time');
  eq((await run(db, ['fire-watch-done', 'P-2042'])).short, true, 'a short fire watch is flagged');
  await run(db, ['sign-off', 'P-2042', '--person=JAK']); await run(db, ['sign-off', 'P-2042', '--person=LIA']);
  await rejects(() => run(db, ['close', 'P-2042', '--by=ANA', '--handback=Area clear']), /fire watch kept 0 minutes; the site rule is 60/);
  await run(db, ['close', 'P-2042', '--by=ANA', '--handback=Area clear', '--override-by=Ana Rewiti']);
  ok(/Accepted to close P-2042: fire watch kept 0 minutes/.test((await one("select body from ptw.notes where body like 'Accepted to close P-2042%'")).body), 'override is on the record');
  ok(await has('fire-watch-short', 'permit P-2042'), 'the short watch stays a finding after close');

  // A new job end to end: request, isolate, verify, link, issue, sign on, lock on.
  await rejects(() => run(db, ['request', '--kind=hot_work', '--area=MILL', '--task=x', '--receiver=JAK', '--from=+1h', '--hours=13']), /at most 12 hours/);
  await rejects(() => run(db, ['request', '--kind=welding', '--area=MILL', '--task=x', '--receiver=JAK', '--from=+1h', '--hours=2']), /No permit kind "welding"/);
  await rejects(() => run(db, ['request', '--kind=general', '--area=MILL', '--asset=BE2', '--task=x', '--receiver=TOM', '--from=+1h', '--hours=2']), /BE2 is not in MILL/);
  const req = await run(db, ['request', '--kind=electrical', '--area=MILL', '--asset=RM1', '--task=Replace roller mill 1 motor bearings', '--receiver=RAJ', '--from=now', '--hours=4', '--risk=JSA-EL-10']);
  eq(req.permit, 'P-2048', 'next permit code');
  await rejects(() => run(db, ['issue', 'P-2048', '--by=RAJ']), /is the receiver/);
  await rejects(() => run(db, ['issue', 'P-2048', '--by=TOM']), /not a current permit issuer/);
  await rejects(() => run(db, ['issue', 'P-2048', '--by=ANA']), /no verified isolation is linked/);
  const iso = await run(db, ['isolate', 'RM1', '--by=RAJ', '--points=RM1-E1:L-05', '--permit=P-2048', '--lockbox=LB-2']);
  eq(iso.still_live.join(), 'RM1-P1 (pneumatic)', 'isolate names what is still live');
  await rejects(() => run(db, ['verify', iso.isolation, '--by=RAJ', '--note=x']), /Lock every point/);
  await rejects(() => run(db, ['isolate', 'RM1', '--by=RAJ', '--points=BE2-E1:L-01']), /BE2-E1 is not on RM1/);
  await db.query("insert into ptw.isolation_lines (isolation_id, point_id, lock_no) values ((select id from ptw.isolations where code = $1), (select id from ptw.isolation_points where code = 'RM1-P1'), 'L-06')", [iso.isolation]);
  await run(db, ['verify', iso.isolation, '--by=RAJ', '--note=Start pressed, gauge zero']);
  eq((await run(db, ['issue', 'P-2048', '--by=ANA'])).status, 'issued', 'issued once isolated and verified');
  await rejects(() => run(db, ['sign-on', 'P-2048', '--person=SIO']), /no current Electrical worker licence ticket/);
  await run(db, ['sign-on', 'P-2048', '--person=RAJ']);
  await run(db, ['lock-on', iso.isolation, '--person=RAJ', '--lock=P-RP']);
  await rejects(() => run(db, ['lock-on', iso.isolation, '--person=RAJ', '--lock=P-RP']), /already has a lock/);
  ok(!(await rules()).some((r) => r.endsWith('P-2048')), 'a clean permit has no findings');

  // Contractor gates: lapsed induction and insurance refuse sign-on unless overridden.
  await rejects(() => run(db, ['sign-on', 'P-2044', '--person=LIA']), /Liam Ward has no current site induction; Bay Steel Fabrication has no current insurance certificate/);
  // Suspend and resume.
  await run(db, ['suspend', 'P-2044', '--by=ANA', '--reason=Crane on the silo top']);
  eq((await one("select status from ptw.permits where code = 'P-2044'")).status, 'suspended', 'suspended');
  await rejects(() => run(db, ['enter', 'P-2044', '--person=TOM']), /is suspended/);
  await run(db, ['resume', 'P-2044', '--by=ANA']);
  eq((await one("select status from ptw.permits where code = 'P-2044'")).status, 'issued', 'resumed');

  // Confined space issue gate: standby and rescue plan, then gas test.
  await run(db, ['isolate', 'BLR1', '--by=RAJ', '--points=BLR1-S1:L-20,BLR1-E1:L-21', '--permit=P-2046']);
  const blr = (await one("select code from ptw.isolations where asset_id = (select id from ptw.assets where code = 'BLR1') and status = 'applied'")).code;
  await run(db, ['verify', blr, '--by=RAJ', '--note=Drain open, burner will not start']);
  await rejects(() => run(db, ['issue', 'P-2046', '--by=ANA']), /no gas test recorded; a confined space entry needs a standby person and a rescue plan/);
  await run(db, ['gas-test', 'P-2046', '--by=HEM', '--o2=20.9', '--lel=0', '--co=2']);
  await rejects(() => run(db, ['issue', 'P-2046', '--by=ANA', '--standby=MEG']), /needs a standby person and a rescue plan/);
  eq((await run(db, ['issue', 'P-2046', '--by=ANA', '--standby=MEG', '--rescue=Tripod at the manhole; TCS rescue team on call'])).status, 'issued', 'issued with standby, rescue plan and a test');

  // Tickets and cancel.
  await run(db, ['ticket', 'PAU', '--kind=cs_entry', '--ref=CS-2200', '--expires=2028-01-31']);
  eq((await one("select ref from ptw.tickets where kind = 'CS_ENTRY' and person_id = (select id from ptw.people where code = 'PAU')")).ref, 'CS-2200', 'ticket renewed in place');
  await rejects(() => run(db, ['ticket', 'PAU', '--kind=SCUBA']), /No ticket kind "SCUBA"/);
  await rejects(() => run(db, ['cancel', 'P-2044', '--reason=x']), /Only a requested permit is cancelled/);
  await run(db, ['cancel', 'P-2047', '--reason=Filter bags not delivered']);
  eq((await one("select status from ptw.permits where code = 'P-2047'")).status, 'cancelled', 'cancelled');

  // Add, log.
  eq((await run(db, ['add', 'areas', file('areas', [{ code: 'LAB', name: 'Quality lab' }])])).added, 1, 'add area');
  eq((await run(db, ['add', 'assets', file('assets', [{ code: 'OVEN1', name: 'Moisture oven', area: 'LAB', kind: 'oven' }])])).added, 1, 'add asset by area code');
  await rejects(() => run(db, ['add', 'assets', file('bad', [{ code: 'X1', name: 'X', area: 'NOPE' }])]), /No areas match/);
  eq((await run(db, ['log', 'company', 'BSF', '--author=Ana', '--text=Certificate promised Friday'])).logged, 'company BSF', 'log');

  // Parsers.
  eq(date('2026-02-28'), '2026-02-28', 'date'); assert.throws(() => date('2026-02-30')); checks++;
  eq(when('+90m').mins, 90, 'relative minutes'); eq(when('-2h').mins, -120, 'relative hours'); eq(when('2026-11-02 07:00').at, '2026-11-02 07:00:00', 'absolute');
  assert.throws(() => when('tomorrow'), /not a time/); checks++;

  // Import from a permit register and a training matrix.
  const reg = parseCsv(fs.readFileSync(path.join(REPO_ROOT, 'examples/permit-register.csv'), 'utf8'));
  eq(mapPermitRow(reg[0], 2).kind, 'hot_work', 'maps Hot Work'); eq(mapPermitRow(reg[0], 2).valid_from, '2026-08-14 07:00:00', 'DD/MM/YYYY times');
  eq(mapPermitRow(reg[3], 5).status, 'requested', 'an active permit comes in as requested');
  assert.throws(() => mapPermitRow({ ...reg[0], 'Permit Type': 'Diving' }, 2), /not one of/); checks++;
  eq(mapTicketRow(parseCsv(fs.readFileSync(path.join(REPO_ROOT, 'examples/training-matrix.csv'), 'utf8'))[3], 5).kind, 'ELECTRICAL', 'maps a licence');
  const tm = await run(db, ['import', 'training-matrix', `--file=${path.join(REPO_ROOT, 'examples/training-matrix.csv')}`]);
  eq(tm.inserted, 5, 'tickets imported'); eq(tm.created_companies, 1, 'contractor company created');
  eq((await one("select count(*)::int n from ptw.tickets t join ptw.people p on p.id = t.person_id where p.name = 'Grant Ellis'")).n, 2, 'tickets attach to imported people');
  eq((await one("select c.kind from ptw.people p join ptw.companies c on c.id = p.company_id where p.name = 'Sam Ito'")).kind, 'contractor', 'contractor from the company column');

  const dry = await run(db, ['import', 'permit-register', `--file=${path.join(REPO_ROOT, 'examples/permit-register.csv')}`, '--dry-run']);
  eq(dry.inserted, 4, 'dry run counts'); eq((await one("select count(*)::int n from ptw.permits where code like 'PTW-%'")).n, 0, 'dry run writes nothing');
  const imp = await run(db, ['import', 'permit-register', `--file=${path.join(REPO_ROOT, 'examples/permit-register.csv')}`]);
  eq(imp.inserted, 4, 'permits imported'); eq(imp.created_areas, 2, 'areas created'); eq(imp.created_assets, 3, 'assets created');
  eq((await run(db, ['import', 'permit-register', `--file=${path.join(REPO_ROOT, 'examples/permit-register.csv')}`])).skipped_identical, 4, 'repeat import skips');
  eq((await one("select status from ptw.permits where code = 'PTW-10414'")).status, 'requested', 'open permit waits to be reissued');
  // Export, drafts, views and documents.
  const exp = await run(db, ['export', `--out=${path.join(temp, 'export.json')}`]);
  eq(exp.tables, TABLES.length, 'export covers every table');
  const wk = await run(db, ['draft-weekly']); ok(fs.readFileSync(wk.draft, 'utf8').includes('## Rule findings'), 'weekly draft');
  const ho = await run(db, ['draft-handover']); ok(fs.readFileSync(ho.draft, 'utf8').includes('## Isolations in place'), 'handover draft');
  const ct = await run(db, ['draft-contractor', 'BSF']); ok(/insurance certificate we hold ran out/.test(fs.readFileSync(ct.draft, 'utf8')), 'contractor draft');
  await rejects(() => run(db, ['draft-contractor', 'HM']), /not a contractor/);
  await rejects(() => run(db, ['nonsense']), /Unknown command/);
  await rejects(() => run(db, ['board', '--bogus']), /Unknown option/);
  for (const f of fs.readdirSync(temp).filter((f) => f.endsWith('.md'))) ok(!fs.readFileSync(path.join(temp, f), 'utf8').includes(String.fromCharCode(8212)), `no em dash in ${f}`);

  await db.close(); db = null;
  ok(cli('permits.mjs', ['board']).includes('P-2045'), 'CLI prints the board');
  ok(JSON.parse(cli('permits.mjs', ['inside', '--json'])).length === 0, 'CLI --json');
  ok(cli('view.mjs').includes('views'), 'views render');
  ok(/\d+ document\(s\) rendered/.test(cli('docs.mjs')), 'documents render');
  console.log(`PASS  ${checks} checks`);
} finally {
  if (db) await db.close();
}
