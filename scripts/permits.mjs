#!/usr/bin/env node
// The one CLI. Every slash command drives this file.
//   npm run permits -- help
//   npm run permits -- board [--json]
// Reads print aligned tables; --json prints rows for machines. Writes run in one transaction.
// Times are site wall-clock: "2026-11-02 07:00", "now", or "+90m" / "+8h" from now.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table } from './lib/format.mjs';

export const TABLES = ['settings', 'areas', 'assets', 'isolation_points', 'companies', 'people', 'ticket_kinds', 'tickets', 'permit_kinds', 'conflict_rules',
  'gas_limits', 'permits', 'permit_crew', 'isolations', 'isolation_lines', 'permit_isolations', 'personal_locks', 'gas_tests', 'entries', 'handovers', 'notes', 'import_rows'];

const t = (col) => `to_char(${col}, 'YYYY-MM-DD HH24:MI')`;
const left = (col) => `case when ${col} is null then '' when ${col} < 0 then 'over by ' || (-${col} / 60) || 'h ' || (-${col} % 60) || 'm' else (${col} / 60) || 'h ' || (${col} % 60) || 'm' end`;

export const READS = {
  board: `select code, kind, area, coalesce(asset, '') asset, task, receiver, company, ${t('valid_to')} valid_to, ${left('minutes_left')} time_left,
    crew_on, inside, case when not isolation_needed then '' when isolation_verified then 'verified' else 'NOT VERIFIED' end isolation,
    case when gas_minutes_ago is null then '' else gas_minutes_ago || ' min ago' || case when gas_failures <> '' then ' FAILED' else '' end end gas, state
    from ptw.permit_board where status <> 'requested' order by state = 'EXPIRED' desc, valid_to`,
  requested: `select p.code, p.kind, ar.code area, coalesce(a.code, '') asset, p.task, rq.name receiver, ${t('p.valid_from')} starts, ${t('p.valid_to')} ends,
    coalesce((select string_agg(r.person || ' needs ' || r.ticket, '; ') from ptw.role_needs r where r.permit_id = p.id and r.state <> 'ok'), '') ticket_gaps,
    case when (p.isolation_required or k.needs_isolation) and not exists (select 1 from ptw.permit_isolations pi join ptw.isolations i on i.id = pi.isolation_id
      where pi.permit_id = p.id and i.status = 'verified') then 'isolate and verify first' else '' end isolation
    from ptw.permits p join ptw.permit_kinds k on k.code = p.kind join ptw.areas ar on ar.id = p.area_id left join ptw.assets a on a.id = p.asset_id
    left join ptw.people rq on rq.id = p.receiver_id where p.status = 'requested' order by p.valid_from`,
  permits: `select p.code, p.kind, ar.code area, coalesce(a.code, '') asset, p.task, p.status, rq.name receiver, ${t('p.valid_from')} valid_from,
    ${t('coalesce(p.closed_at, p.valid_to)')} closed_or_due from ptw.permits p join ptw.areas ar on ar.id = p.area_id left join ptw.assets a on a.id = p.asset_id
    left join ptw.people rq on rq.id = p.receiver_id where p.valid_from >= ptw.site_now() - interval '30 days' or ptw.is_open(p.status) order by p.valid_from desc`,
  isolations: `select code, asset, asset_name, area, status, isolator, coalesce(verified_by, '') verified_by, points || ' of ' || asset_points points_locked,
    personal_locks_on, coalesce(open_permits, '') open_permits, hours_isolated, lockbox from ptw.isolation_state where status <> 'removed' order by code`,
  locks: `select isolation, asset, person, company, lock_no, ${t('on_at')} on_at, hours_on, coalesce(working_under, '') working_under, flag
    from ptw.locks_on order by flag = '' , isolation, person`,
  inside: `select permit, asset, asset_name, person, company, ${t('in_at')} in_at, minutes_in, coalesce(standby, 'NONE') standby, permit_status from ptw.inside_now order by in_at`,
  gas: `select gs.permit, gs.kind, b.task, ${t('gs.tested_at')} tested_at, gs.minutes_ago, gs.o2_pct o2, gs.lel_pct lel, gs.h2s_ppm h2s, gs.co_ppm co,
    coalesce(pe.name, '') tester,
    case when gs.tested_at is null then 'NO TEST' when gs.failures <> '' then 'FAILED: ' || gs.failures
      when gs.minutes_ago > (select gas_retest_minutes from ptw.settings) then 'RETEST DUE' else 'ok' end state
    from ptw.gas_status gs join ptw.permit_board b on b.id = gs.permit_id left join ptw.people pe on pe.id = gs.tester_id order by gs.permit`,
  tickets: `select person_code, person, company, ticket, coalesce(ref, '') ref, expires_on, days_left, state from ptw.ticket_status order by person, ticket`,
  expiring: `select person, company, ticket, coalesce(ref, '') ref, expires_on, days_left, state from ptw.ticket_status where state <> 'current'
    union all
    select c.contact, c.name, 'Insurance certificate', '', c.insurance_expires_on, c.insurance_expires_on - ptw.site_now()::date,
      case when c.insurance_expires_on is null or c.insurance_expires_on < ptw.site_now()::date then 'EXPIRED' else 'expiring' end
    from ptw.companies c where c.kind = 'contractor' and (c.insurance_expires_on is null or c.insurance_expires_on <= ptw.site_now()::date + (select ticket_warn_days from ptw.settings))
    order by days_left nulls first`,
  contractors: `select c.code, c.name, c.contact, c.phone, c.insurance_expires_on insurance_to, c.prequalified_on,
    (select count(*) from ptw.people p where p.company_id = c.id and p.active)::int people,
    (select count(*) from ptw.ticket_status ts join ptw.people p on p.id = ts.person_id where p.company_id = c.id and ts.state <> 'current')::int tickets_to_renew,
    coalesce((select string_agg(distinct pm.code, ', ') from ptw.permits pm join ptw.people p on p.company_id = c.id
      where ptw.is_open(pm.status) and (pm.receiver_id = p.id or exists (select 1 from ptw.permit_crew pc where pc.permit_id = pm.id and pc.person_id = p.id and pc.off_at is null))), '') open_permits
    from ptw.companies c where c.kind = 'contractor' order by c.name`,
  people: `select p.code, p.name, c.name company, coalesce(p.role, '') role,
    coalesce((select string_agg(t.kind, ' ' order by t.kind) from ptw.tickets t where t.person_id = p.id and (t.expires_on is null or t.expires_on >= ptw.site_now()::date)), '') current_tickets
    from ptw.people p join ptw.companies c on c.id = p.company_id where p.active order by c.kind, c.name, p.name`,
  conflicts: `select permit_a, kind_a, permit_b, kind_b, area, coalesce(asset, '') asset, reason, ${t('overlap_from')} overlap_from, ${t('overlap_to')} overlap_to from ptw.conflicts order by permit_a`,
  history: `select asset, name, area, isolations, hours_isolated, permits, ${t('last_isolated_at')} last_isolated from ptw.asset_isolation_history order by hours_isolated desc, asset`,
  points: `select a.code asset, pt.code point, pt.energy, pt.device, pt.method, pt.verify from ptw.isolation_points pt join ptw.assets a on a.id = pt.asset_id order by a.code, pt.code`,
  kinds: `select code, name, coalesce(crew_ticket, '') crew_ticket, needs_isolation isolation, needs_gas_test gas_test, needs_standby standby, needs_fire_watch fire_watch, max_hours from ptw.permit_kinds order by code`,
  'gas-limits': `select gas, name, unit, coalesce(min_value::text, '') min, coalesce(max_value::text, '') max, source from ptw.gas_limits order by gas`,
  compliance: `select rule, severity, ref, subject, detail from ptw.compliance_findings order by severity = 'breach' desc, rule, ref`,
};

const ADD_FIELDS = {
  areas: ['code', 'name', 'hazards'],
  assets: ['code', 'name', 'area_id', 'kind', 'confined_space'],
  isolation_points: ['code', 'asset_id', 'energy', 'device', 'method', 'verify'],
  companies: ['code', 'name', 'kind', 'contact', 'email', 'phone', 'insurance_expires_on', 'prequalified_on'],
  people: ['code', 'name', 'company_id', 'role', 'phone', 'email', 'inducted_on', 'induction_expires_on'],
};
const REFS = { area_id: 'areas', asset_id: 'assets', company_id: 'companies' };
const LOOKUP = {
  areas: { label: 'areas', sql: 'select id, code, name from ptw.areas' },
  assets: { label: 'assets', sql: 'select id, code, name from ptw.assets' },
  companies: { label: 'companies', sql: 'select id, code, name from ptw.companies' },
  people: { label: 'people', sql: 'select id, code, name from ptw.people where active' },
  permits: { label: 'permits', sql: 'select id, code, task as name from ptw.permits' },
  isolations: { label: 'isolations', sql: 'select id, code, code as name from ptw.isolations' },
  points: { label: 'isolation points', sql: 'select id, code, device as name from ptw.isolation_points' },
};

const HELP = {
  reads: [...Object.keys(READS), 'attention'].sort(),
  details: ['permit <ref>', 'isolation <ref>', 'person <ref>', 'asset <ref>', 'company <ref>'],
  writes: [
    'request --kind= --area= --task= --receiver= --from= (--to= | --hours=) [--asset=] [--risk=] [--requested-by=] [--isolation]',
    'issue <permit> --by= [--standby=] [--rescue=] [--override-by=]',
    'sign-on <permit> --person= [--override-by=]', 'sign-off <permit> --person=',
    'enter <permit> --person= [--override-by=]', 'exit <permit> --person=',
    'gas-test <permit> --by= --o2= --lel= [--h2s=] [--co=] [--location=] [--instrument=] [--no-bump]',
    'isolate <asset> --by= --points=POINT:LOCK,... [--reason=] [--lockbox=] [--permit=]',
    'verify <isolation> --by= --note=', 'link <permit> <isolation>',
    'lock-on <isolation> --person= --lock=', 'lock-off <isolation> --person=',
    'deisolate <isolation> --by=',
    'suspend <permit> --by= --reason=', 'resume <permit> --by=',
    'handover <permit> --from= --to= [--note=]',
    'finish <permit> --fire-watch= (hot work: tools down, fire watch starts)', 'fire-watch-done <permit>',
    'close <permit> --by= --handback= [--override-by=]', 'cancel <permit> --reason=',
    'ticket <person> --kind= [--ref=] [--issued=YYYY-MM-DD] [--expires=YYYY-MM-DD]',
    'add <areas|assets|isolation_points|companies|people> --data=<file.json>',
    'log <permit|isolation|person|company|asset> <ref> --author= --text=',
    'import permit-register|training-matrix --file=<csv> [--dry-run]', 'export --out=<file.json>',
    'draft-weekly', 'draft-handover', 'draft-contractor <company>'],
};

// ------------------------------------------------------------------ helpers
export function date(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw Error(`Invalid date "${v}". Use YYYY-MM-DD.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw Error(`Invalid date "${v}".`);
  return v;
}
// "2026-11-02 07:00", "2026-11-02T07:00", "now", "+90m", "+8h", "-2h" -> SQL expression parameters [absolute or null, offset minutes]
export function when(v, label = 'time') {
  const s = String(v ?? '').trim();
  if (s === 'now') return { at: null, mins: 0 };
  const rel = s.match(/^([+-])(\d+(?:\.\d+)?)(m|h|d)$/);
  if (rel) return { at: null, mins: Math.round(Number(rel[2]) * { m: 1, h: 60, d: 1440 }[rel[3]] * (rel[1] === '-' ? -1 : 1)) };
  const abs = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
  if (abs && Number(abs[2]) < 24 && Number(abs[3]) < 60) { date(abs[1]); return { at: `${abs[1]} ${abs[2]}:${abs[3]}:00`, mins: 0 }; }
  throw Error(`${label} "${v}" is not a time. Use "2026-11-02 07:00", "now", or "+8h".`);
}
async function at(db, v, label) {
  const w = when(v, label);
  const [{ ts }] = await db.query("select to_char(coalesce($1::timestamp, ptw.site_now() + make_interval(mins => $2::int)), 'YYYY-MM-DD HH24:MI:SS') ts", [w.at, w.mins]);
  return ts;
}
function num(v, label) {
  if (v === undefined || v === true || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw Error(`${label} "${v}" must be a number`);
  return n;
}
function parseArgs(args) {
  const pos = []; const opts = {};
  for (const a of args) {
    if (a.startsWith('--')) { const eq = a.indexOf('='); opts[eq < 0 ? a.slice(2) : a.slice(2, eq)] = eq < 0 ? true : a.slice(eq + 1); }
    else pos.push(a);
  }
  return { pos, opts };
}
function allow(opts, names) {
  for (const k of Object.keys(opts)) if (!['json', ...names].includes(k)) throw Error(`Unknown option --${k}`);
}
function need(opts, k) { if (opts[k] === undefined || opts[k] === true || String(opts[k]).trim() === '') throw Error(`--${k} is required`); return String(opts[k]).trim(); }
function noExtra(pos, n) { if (pos.length > n) throw Error(`Unexpected argument "${pos[n]}"`); }

// Code, name (case insensitive), or UUID prefix. Ambiguity lists the candidates.
export async function resolve(db, kind, ref) {
  const l = LOOKUP[kind];
  if (!ref) throw Error(`Name a ${l.label.replace(/ies$/, 'y').replace(/s$/, '')}`);
  const rows = await db.query(`select * from (${l.sql}) t where lower(code) = lower($1) or lower(name) = lower($1) or id::text like lower($1) || '%'
    or lower(name) like '%' || lower($1) || '%' or lower(code) like lower($1) || '%'`, [ref]);
  const exact = rows.filter((r) => r.code.toLowerCase() === ref.toLowerCase() || r.name.toLowerCase() === ref.toLowerCase());
  const hits = exact.length ? exact : rows;
  if (!hits.length) throw Error(`No ${l.label} match "${ref}"`);
  if (hits.length > 1) throw Error(`Ambiguous ${l.label} "${ref}": ${hits.map((r) => `${r.code} (${r.name})`).join(', ')}`);
  return hits[0];
}

async function tx(db, fn, { dryRun = false } = {}) {
  await db.exec('BEGIN');
  try { const out = await fn(); await db.exec(dryRun ? 'ROLLBACK' : 'COMMIT'); return out; }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}
async function nextCode(db, tableName, prefix) {
  const [{ n }] = await db.query(`select coalesce(max(substring(code from '\\d+$')::int), 0) + 1 n from ptw.${tableName} where code like $1 || '%'`, [prefix]);
  return `${prefix}${n}`;
}
async function note(db, type, id, author, body) {
  await db.query('insert into ptw.notes (subject_type, subject_id, author, body) values ($1, $2, $3, $4)', [type, id, author, body]);
}
async function permitRow(db, ref) {
  const p = await resolve(db, 'permits', ref);
  const [row] = await db.query(`select p.*, k.name kind_name, k.crew_ticket, k.needs_isolation or p.isolation_required isolation_needed, k.needs_gas_test,
    k.needs_standby, k.needs_fire_watch, k.max_hours from ptw.permits p join ptw.permit_kinds k on k.code = p.kind where p.id = $1`, [p.id]);
  return row;
}
async function hasTicket(db, personId, kind) {
  if (!kind) return true;
  return (await db.query('select 1 from ptw.tickets where person_id = $1 and kind = $2 and (expires_on is null or expires_on >= ptw.site_now()::date)', [personId, kind])).length > 0;
}
// Contractor checks for one person: site induction current, company insurance current.
async function contractorGaps(db, personId) {
  const [r] = await db.query(`select pe.name, pe.inducted_on, pe.induction_expires_on < ptw.site_now()::date induction_lapsed, c.kind, c.name company,
    c.insurance_expires_on is null or c.insurance_expires_on < ptw.site_now()::date insurance_lapsed
    from ptw.people pe join ptw.companies c on c.id = pe.company_id where pe.id = $1`, [personId]);
  if (!r || r.kind !== 'contractor') return [];
  const gaps = [];
  if (!r.inducted_on || r.induction_lapsed) gaps.push(`${r.name} has no current site induction`);
  if (r.insurance_lapsed) gaps.push(`${r.company} has no current insurance certificate`);
  return gaps;
}
// The gas reading on a permit, fresh and inside limits, or the reason it is not.
async function gasProblem(db, permitId) {
  const [g] = await db.query(`select minutes_ago, failures, (select gas_retest_minutes from ptw.settings) retest from ptw.gas_status where permit_id = $1`, [permitId]);
  if (!g || g.minutes_ago === null) return 'no gas test recorded';
  if (g.failures) return `the last gas test failed (${g.failures})`;
  if (g.minutes_ago > g.retest) return `the last gas test is ${g.minutes_ago} minutes old (retest every ${g.retest})`;
  return null;
}
// Refuse unless every problem is accepted by a named person, who goes on the record.
async function gate(db, problems, opts, permitId, action) {
  if (!problems.length) return;
  if (!opts['override-by']) throw Error(`Cannot ${action}: ${problems.join('; ')}. Fix it, or rerun with --override-by="<name>" to accept it on the record.`);
  await note(db, 'permit', permitId, String(opts['override-by']), `Accepted to ${action}: ${problems.join('; ')}`);
}

// ------------------------------------------------------------------ commands
export async function run(db, argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help') return HELP;
  if (READS[cmd]) { allow(opts, []); noExtra(pos, 0); return db.query(READS[cmd]); }

  switch (cmd) {
    case 'attention': { allow(opts, []); noExtra(pos, 0); return attention(db); }
    case 'permit': { allow(opts, []); noExtra(pos, 1); return permitDetail(db, pos[0]); }
    case 'isolation': {
      allow(opts, []); noExtra(pos, 1);
      const i = await resolve(db, 'isolations', pos[0]);
      return {
        isolation: (await db.query(`select code, asset, asset_name, area, status, isolator, ${t('applied_at')} applied_at, coalesce(verified_by, '') verified_by,
          ${t('verified_at')} verified_at, (select verify_note from ptw.isolations where id = $1) verify_note, ${t('removed_at')} removed_at, lockbox, hours_isolated
          from ptw.isolation_state where id = $1`, [i.id]))[0],
        points: await db.query(`select pt.code point, pt.energy, pt.device, coalesce(l.lock_no, 'NOT LOCKED') lock_no, pt.verify
          from ptw.isolations i join ptw.isolation_points pt on pt.asset_id = i.asset_id
          left join ptw.isolation_lines l on l.isolation_id = i.id and l.point_id = pt.id where i.id = $1 order by pt.code`, [i.id]),
        personal_locks: await db.query(`select pe.name person, pl.lock_no, ${t('pl.on_at')} on_at, ${t('pl.off_at')} off_at from ptw.personal_locks pl
          join ptw.people pe on pe.id = pl.person_id where pl.isolation_id = $1 order by pl.on_at`, [i.id]),
        permits: await db.query(`select p.code, p.kind, p.status, p.task from ptw.permit_isolations pi join ptw.permits p on p.id = pi.permit_id where pi.isolation_id = $1 order by p.code`, [i.id]),
        rule_findings: await db.query("select rule, detail from ptw.compliance_findings where ref = 'isolation ' || $1", [i.code]),
      };
    }
    case 'person': {
      allow(opts, []); noExtra(pos, 1);
      const p = await resolve(db, 'people', pos[0]);
      return {
        person: (await db.query(`select pe.code, pe.name, c.name company, pe.role, pe.phone, pe.email, pe.inducted_on, pe.induction_expires_on
          from ptw.people pe join ptw.companies c on c.id = pe.company_id where pe.id = $1`, [p.id]))[0],
        tickets: await db.query('select ticket, coalesce(ref, \'\') ref, expires_on, days_left, state from ptw.ticket_status where person_id = $1 order by ticket', [p.id]),
        on_permits: await db.query(`select p.code, p.kind, p.status, p.task, ${t('pc.on_at')} signed_on from ptw.permit_crew pc join ptw.permits p on p.id = pc.permit_id
          where pc.person_id = $1 and pc.off_at is null and ptw.is_open(p.status) order by p.code`, [p.id]),
        locks_on: await db.query('select isolation, asset, lock_no, hours_on, flag from ptw.locks_on where person_code = $1', [p.code]),
        inside: await db.query('select permit, asset, minutes_in from ptw.inside_now where person = $1', [p.name]),
        notes: await db.query("select created_at, author, body from ptw.notes where subject_type = 'person' and subject_id = $1 order by created_at", [p.id]),
      };
    }
    case 'asset': {
      allow(opts, []); noExtra(pos, 1);
      const a = await resolve(db, 'assets', pos[0]);
      return {
        asset: (await db.query(`select a.code, a.name, ar.name area, a.kind, a.confined_space from ptw.assets a join ptw.areas ar on ar.id = a.area_id where a.id = $1`, [a.id]))[0],
        isolation_points: await db.query('select code, energy, device, method, verify from ptw.isolation_points where asset_id = $1 order by code', [a.id]),
        isolations: await db.query(`select i.code, i.status, ${t('i.applied_at')} applied_at, ${t('i.removed_at')} removed_at, s.hours_isolated from ptw.isolations i
          join ptw.isolation_state s on s.id = i.id where i.asset_id = $1 order by i.applied_at desc limit 10`, [a.id]),
        permits: await db.query(`select code, kind, status, task, ${t('valid_from')} valid_from from ptw.permits where asset_id = $1 order by valid_from desc limit 10`, [a.id]),
        last_90_days: (await db.query('select isolations, hours_isolated, permits from ptw.asset_isolation_history where asset = $1', [a.code]))[0],
      };
    }
    case 'company': {
      allow(opts, []); noExtra(pos, 1);
      const c = await resolve(db, 'companies', pos[0]);
      return {
        company: (await db.query('select code, name, kind, contact, email, phone, insurance_expires_on, prequalified_on from ptw.companies where id = $1', [c.id]))[0],
        people: await db.query(`select p.code, p.name, p.role, p.induction_expires_on from ptw.people p where p.company_id = $1 and p.active order by p.name`, [c.id]),
        tickets_to_renew: await db.query(`select person, ticket, expires_on, days_left, state from ptw.ticket_status ts join ptw.people p on p.id = ts.person_id
          where p.company_id = $1 and ts.state <> 'current' order by days_left`, [c.id]),
        notes: await db.query("select created_at, author, body from ptw.notes where subject_type = 'company' and subject_id = $1 order by created_at", [c.id]),
      };
    }
    case 'request': return request(db, pos, opts);
    case 'issue': return issue(db, pos, opts);
    case 'sign-on': return signOn(db, pos, opts);
    case 'sign-off': return signOff(db, pos, opts);
    case 'enter': return enter(db, pos, opts);
    case 'exit': return exitSpace(db, pos, opts);
    case 'gas-test': return gas(db, pos, opts);
    case 'isolate': return isolate(db, pos, opts);
    case 'verify': return verify(db, pos, opts);
    case 'link': {
      allow(opts, []); noExtra(pos, 2);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]); const i = await resolve(db, 'isolations', pos[1]);
        const [iso] = await db.query('select status, asset_id from ptw.isolations where id = $1', [i.id]);
        if (iso.status === 'removed') throw Error(`${i.code} has been removed`);
        if (p.asset_id && p.asset_id !== iso.asset_id) throw Error(`${i.code} is on a different asset from ${p.code}`);
        await db.query('insert into ptw.permit_isolations (permit_id, isolation_id) values ($1, $2) on conflict do nothing', [p.id, i.id]);
        return { permit: p.code, isolation: i.code, linked: true };
      });
    }
    case 'lock-on': {
      allow(opts, ['person', 'lock']); noExtra(pos, 1);
      return tx(db, async () => {
        const i = await resolve(db, 'isolations', pos[0]); const pe = await resolve(db, 'people', need(opts, 'person'));
        const [iso] = await db.query('select status from ptw.isolations where id = $1', [i.id]);
        if (iso.status === 'removed') throw Error(`${i.code} has been removed`);
        if ((await db.query('select 1 from ptw.personal_locks where isolation_id = $1 and person_id = $2 and off_at is null', [i.id, pe.id])).length) throw Error(`${pe.name} already has a lock on ${i.code}`);
        await db.query('insert into ptw.personal_locks (isolation_id, person_id, lock_no, on_at) values ($1, $2, $3, ptw.site_now())', [i.id, pe.id, need(opts, 'lock')]);
        return { isolation: i.code, person: pe.name, lock: opts.lock, on: true };
      });
    }
    case 'lock-off': {
      allow(opts, ['person']); noExtra(pos, 1);
      return tx(db, async () => {
        const i = await resolve(db, 'isolations', pos[0]); const pe = await resolve(db, 'people', need(opts, 'person'));
        const [l] = await db.query('update ptw.personal_locks set off_at = ptw.site_now() where isolation_id = $1 and person_id = $2 and off_at is null returning lock_no', [i.id, pe.id]);
        if (!l) throw Error(`${pe.name} has no lock on ${i.code}`);
        return { isolation: i.code, person: pe.name, lock: l.lock_no, off: true };
      });
    }
    case 'deisolate': {
      allow(opts, ['by']); noExtra(pos, 1);
      return tx(db, async () => {
        const i = await resolve(db, 'isolations', pos[0]); const by = await resolve(db, 'people', need(opts, 'by'));
        const [s] = await db.query('select status, personal_locks_on, open_permits from ptw.isolation_state where id = $1', [i.id]);
        if (s.status === 'removed') throw Error(`${i.code} is already removed`);
        if (s.open_permits) throw Error(`Cannot remove ${i.code}: permits ${s.open_permits} still rely on it. Close them first.`);
        if (s.personal_locks_on) {
          const who = (await db.query('select person from ptw.locks_on where isolation = $1', [i.code])).map((r) => r.person).join(', ');
          throw Error(`Cannot remove ${i.code}: personal locks still on (${who}). Each person takes off their own lock.`);
        }
        if (!(await hasTicket(db, by.id, 'ISOLATOR'))) throw Error(`${by.name} is not a current authorised isolator`);
        await db.query("update ptw.isolations set status = 'removed', removed_at = ptw.site_now(), removed_by = $2 where id = $1", [i.id, by.id]);
        return { isolation: i.code, removed_by: by.name };
      });
    }
    case 'suspend': {
      allow(opts, ['by', 'reason']); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (p.status !== 'issued') throw Error(`${p.code} is ${p.status}; only an issued permit can be suspended`);
        const by = await resolve(db, 'people', need(opts, 'by'));
        const inside = await db.query('select person from ptw.inside_now where permit = $1', [p.code]);
        await db.query("update ptw.permits set status = 'suspended', suspended_reason = $2 where id = $1", [p.id, need(opts, 'reason')]);
        await note(db, 'permit', p.id, by.name, `Suspended: ${opts.reason}`);
        return { permit: p.code, status: 'suspended', still_inside: inside.map((r) => r.person) };
      });
    }
    case 'resume': {
      allow(opts, ['by', 'override-by']); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (p.status !== 'suspended') throw Error(`${p.code} is ${p.status}, not suspended`);
        const by = await resolve(db, 'people', need(opts, 'by'));
        if (!(await hasTicket(db, by.id, 'ISSUER'))) throw Error(`${by.name} is not a current permit issuer`);
        const problems = await readiness(db, p);
        await gate(db, problems, opts, p.id, `resume ${p.code}`);
        await db.query("update ptw.permits set status = 'issued', suspended_reason = null where id = $1", [p.id]);
        await note(db, 'permit', p.id, by.name, 'Resumed');
        return { permit: p.code, status: 'issued' };
      });
    }
    case 'handover': {
      allow(opts, ['from', 'to', 'note']); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (!['issued', 'suspended'].includes(p.status)) throw Error(`${p.code} is ${p.status}`);
        const from = await resolve(db, 'people', need(opts, 'from')); const to = await resolve(db, 'people', need(opts, 'to'));
        if (!(await hasTicket(db, to.id, 'RECEIVER'))) throw Error(`${to.name} is not a current permit receiver`);
        await db.query('insert into ptw.handovers (permit_id, at, from_id, to_id, note) values ($1, ptw.site_now(), $2, $3, $4)', [p.id, from.id, to.id, opts.note || null]);
        await db.query('update ptw.permits set receiver_id = $2 where id = $1', [p.id, to.id]);
        return { permit: p.code, from: from.name, to: to.name };
      });
    }
    case 'finish': {
      allow(opts, ['fire-watch']); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (p.status !== 'issued') throw Error(`${p.code} is ${p.status}`);
        if (!p.needs_fire_watch) throw Error(`${p.code} is ${p.kind_name}; finish is for hot work. Use close.`);
        const fw = await resolve(db, 'people', need(opts, 'fire-watch'));
        const [{ until }] = await db.query(`update ptw.permits set work_ended_at = ptw.site_now(), fire_watch_by = $2 where id = $1
          returning to_char(ptw.site_now() + make_interval(mins => (select fire_watch_minutes from ptw.settings)), 'HH24:MI') until`, [p.id, fw.id]);
        return { permit: p.code, tools_down: true, fire_watch: fw.name, keep_watch_until: until };
      });
    }
    case 'fire-watch-done': {
      allow(opts, []); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (!p.work_ended_at) throw Error(`${p.code} has no tools-down time. Run finish first.`);
        const [r] = await db.query(`update ptw.permits set fire_watch_end_at = ptw.site_now() where id = $1
          returning (extract(epoch from (fire_watch_end_at - work_ended_at)) / 60)::int minutes, (select fire_watch_minutes from ptw.settings) rule`, [p.id]);
        return { permit: p.code, fire_watch_minutes: r.minutes, site_rule: r.rule, short: r.minutes < r.rule };
      });
    }
    case 'close': return close(db, pos, opts);
    case 'cancel': {
      allow(opts, ['reason']); noExtra(pos, 1);
      return tx(db, async () => {
        const p = await permitRow(db, pos[0]);
        if (p.status !== 'requested') throw Error(`${p.code} is ${p.status}. Only a requested permit is cancelled; an issued one is closed.`);
        await db.query("update ptw.permits set status = 'cancelled', cancelled_reason = $2 where id = $1", [p.id, need(opts, 'reason')]);
        return { permit: p.code, status: 'cancelled' };
      });
    }
    case 'ticket': {
      allow(opts, ['kind', 'ref', 'issued', 'expires']); noExtra(pos, 1);
      return tx(db, async () => {
        const pe = await resolve(db, 'people', pos[0]);
        const kind = need(opts, 'kind').toUpperCase();
        if (!(await db.query('select 1 from ptw.ticket_kinds where code = $1', [kind])).length) {
          throw Error(`No ticket kind "${kind}". Kinds: ${(await db.query('select code from ptw.ticket_kinds order by code')).map((r) => r.code).join(', ')}`);
        }
        await db.query(`insert into ptw.tickets (person_id, kind, ref, issued_on, expires_on) values ($1, $2, $3, $4, $5)
          on conflict (person_id, kind) do update set ref = excluded.ref, issued_on = excluded.issued_on, expires_on = excluded.expires_on`,
          [pe.id, kind, opts.ref || null, opts.issued ? date(opts.issued) : null, opts.expires ? date(opts.expires) : null]);
        return { person: pe.name, ticket: kind, expires: opts.expires || 'does not lapse' };
      });
    }
    case 'add': return add(db, pos, opts);
    case 'log': {
      allow(opts, ['author', 'text']); noExtra(pos, 2);
      const kinds = { permit: 'permits', isolation: 'isolations', person: 'people', company: 'companies', asset: 'assets' };
      if (!kinds[pos[0]]) throw Error('log needs permit, isolation, person, company or asset');
      const r = await resolve(db, kinds[pos[0]], pos[1]);
      await note(db, pos[0], r.id, need(opts, 'author'), need(opts, 'text'));
      return { logged: `${pos[0]} ${r.code}` };
    }
    case 'import': return importCsv(db, pos, opts);
    case 'export': {
      allow(opts, ['out']); noExtra(pos, 0);
      const out = { exported_at: new Date().toISOString() };
      for (const tname of TABLES) out[tname] = await db.query(`select * from ptw.${tname}`);
      const file = path.resolve(need(opts, 'out'));
      fs.writeFileSync(file, JSON.stringify(out, null, 2));
      return { file, tables: TABLES.length, rows: TABLES.reduce((n, k) => n + out[k].length, 0) };
    }
    case 'draft-weekly': { allow(opts, []); noExtra(pos, 0); return draftWeekly(db); }
    case 'draft-handover': { allow(opts, []); noExtra(pos, 0); return draftHandover(db); }
    case 'draft-contractor': { allow(opts, []); noExtra(pos, 1); return draftContractor(db, pos[0]); }
    default: throw Error(`Unknown command "${cmd}". Run: npm run permits -- help`);
  }
}

async function permitDetail(db, ref) {
  const p = await permitRow(db, ref);
  return {
    permit: (await db.query(`select p.code, k.name kind, ar.name area, coalesce(a.code || ' ' || a.name, '') asset, p.task, p.risk_ref, p.status,
      iss.name issuer, rq.name receiver, coalesce(sb.name, '') standby, coalesce(p.rescue_plan, '') rescue_plan,
      ${t('p.valid_from')} valid_from, ${t('p.valid_to')} valid_to, ${t('p.issued_at')} issued_at, ${t('p.work_ended_at')} tools_down,
      ${t('p.fire_watch_end_at')} fire_watch_end, ${t('p.closed_at')} closed_at, coalesce(p.handback, '') handback
      from ptw.permits p join ptw.permit_kinds k on k.code = p.kind join ptw.areas ar on ar.id = p.area_id left join ptw.assets a on a.id = p.asset_id
      left join ptw.people iss on iss.id = p.issuer_id left join ptw.people rq on rq.id = p.receiver_id left join ptw.people sb on sb.id = p.standby_id
      where p.id = $1`, [p.id]))[0],
    crew: await db.query(`select pe.name, c.name company, ${t('pc.on_at')} signed_on, ${t('pc.off_at')} signed_off from ptw.permit_crew pc
      join ptw.people pe on pe.id = pc.person_id join ptw.companies c on c.id = pe.company_id where pc.permit_id = $1 order by pc.on_at, pe.name`, [p.id]),
    isolations: await db.query(`select s.code, s.status, s.points || ' of ' || s.asset_points points_locked, s.personal_locks_on from ptw.permit_isolations pi
      join ptw.isolation_state s on s.id = pi.isolation_id where pi.permit_id = $1`, [p.id]),
    gas_tests: await db.query(`select ${t('g.tested_at')} tested_at, pe.name tester, g.location, g.o2_pct o2, g.lel_pct lel, g.h2s_ppm h2s, g.co_ppm co
      from ptw.gas_tests g join ptw.people pe on pe.id = g.tester_id where g.permit_id = $1 order by g.tested_at`, [p.id]),
    entries: await db.query(`select pe.name, ${t('e.in_at')} in_at, ${t('e.out_at')} out_at from ptw.entries e join ptw.people pe on pe.id = e.person_id
      where e.permit_id = $1 order by e.in_at`, [p.id]),
    handovers: await db.query(`select ${t('h.at')} at, f.name from_person, tt.name to_person, coalesce(h.note, '') note from ptw.handovers h
      join ptw.people f on f.id = h.from_id join ptw.people tt on tt.id = h.to_id where h.permit_id = $1 order by h.at`, [p.id]),
    rule_findings: await db.query("select rule, detail from ptw.compliance_findings where ref = 'permit ' || $1 or ref like '%' || $1 || '%'", [p.code]),
    notes: await db.query("select created_at, author, body from ptw.notes where subject_type = 'permit' and subject_id = $1 order by created_at", [p.id]),
  };
}

// What stands between a permit and live work: isolation, gas, standby, receiver ticket and contractor checks.
async function readiness(db, p) {
  const problems = [];
  if (p.isolation_needed && !(await db.query(`select 1 from ptw.permit_isolations pi join ptw.isolations i on i.id = pi.isolation_id
      where pi.permit_id = $1 and i.status = 'verified'`, [p.id])).length) problems.push('no verified isolation is linked');
  const incomplete = await db.query(`select s.code from ptw.permit_isolations pi join ptw.isolation_state s on s.id = pi.isolation_id
    where pi.permit_id = $1 and s.status <> 'removed' and s.points < s.asset_points`, [p.id]);
  if (incomplete.length) problems.push(`isolation ${incomplete.map((r) => r.code).join(', ')} leaves a point unlocked`);
  if (p.needs_gas_test) { const g = await gasProblem(db, p.id); if (g) problems.push(g); }
  if (p.needs_standby && (!p.standby_id || !p.rescue_plan)) problems.push('a confined space entry needs a standby person and a rescue plan');
  if (p.standby_id && !(await hasTicket(db, p.standby_id, 'CS_STANDBY'))) problems.push('the standby has no current standby ticket');
  if (p.receiver_id && !(await hasTicket(db, p.receiver_id, 'RECEIVER'))) problems.push('the receiver is not a current permit receiver');
  if (p.receiver_id) problems.push(...await contractorGaps(db, p.receiver_id));
  const clash = await db.query(`select p.code, k.name from ptw.permits p join ptw.permit_kinds k on k.code = p.kind
    join ptw.conflict_rules r on (r.kind_a = $2 and r.kind_b = p.kind) or (r.kind_b = $2 and r.kind_a = p.kind)
    where p.id <> $1 and p.status = 'issued' and p.valid_from < $5::timestamp and $4::timestamp < p.valid_to
    and ((r.scope = 'area' and p.area_id = $3) or (r.scope = 'asset' and p.asset_id = $6))`,
    [p.id, p.kind, p.area_id, p.valid_from, p.valid_to, p.asset_id]);
  if (clash.length) problems.push(`clashes with ${clash.map((r) => `${r.code} (${r.name.toLowerCase()})`).join(', ')}`);
  return problems;
}

async function request(db, pos, opts) {
  allow(opts, ['kind', 'area', 'asset', 'task', 'receiver', 'from', 'to', 'hours', 'risk', 'requested-by', 'isolation']); noExtra(pos, 0);
  return tx(db, async () => {
    const kind = need(opts, 'kind').toLowerCase().replace(/[\s-]+/g, '_');
    const [k] = await db.query('select * from ptw.permit_kinds where code = $1', [kind]);
    if (!k) throw Error(`No permit kind "${kind}". Kinds: ${(await db.query('select code from ptw.permit_kinds order by code')).map((r) => r.code).join(', ')}`);
    const area = await resolve(db, 'areas', need(opts, 'area'));
    const asset = opts.asset ? await resolve(db, 'assets', String(opts.asset)) : null;
    if (asset && !(await db.query('select 1 from ptw.assets where id = $1 and area_id = $2', [asset.id, area.id])).length) throw Error(`${asset.code} is not in ${area.code}`);
    const receiver = await resolve(db, 'people', need(opts, 'receiver'));
    const requestedBy = opts['requested-by'] ? await resolve(db, 'people', String(opts['requested-by'])) : receiver;
    const from = await at(db, need(opts, 'from'), '--from');
    let to;
    if (opts.to) to = await at(db, String(opts.to), '--to');
    else {
      const h = num(need(opts, 'hours'), '--hours');
      [{ to }] = await db.query("select to_char($1::timestamp + make_interval(mins => $2::int), 'YYYY-MM-DD HH24:MI:SS') as to", [from, Math.round(h * 60)]);
    }
    if (to <= from) throw Error('The permit must end after it starts');
    const hours = (new Date(to.replace(' ', 'T') + 'Z') - new Date(from.replace(' ', 'T') + 'Z')) / 3600000;
    if (hours > k.max_hours) throw Error(`${k.name} permits run at most ${k.max_hours} hours; this one is ${hours}. Split it, or change max_hours with /customise.`);
    const code = await nextCode(db, 'permits', 'P-');
    const [{ id }] = await db.query(`insert into ptw.permits (code, kind, area_id, asset_id, task, risk_ref, requested_by, receiver_id, isolation_required, valid_from, valid_to)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [code, kind, area.id, asset?.id || null, need(opts, 'task'), opts.risk || null, requestedBy.id, receiver.id, opts.isolation === true || k.needs_isolation, from, to]);
    return { permit: code, id, kind: k.name, area: area.code, asset: asset?.code || '', from, to, status: 'requested',
      next: [k.needs_isolation || opts.isolation ? 'isolate and verify, then link the isolation' : null, k.needs_gas_test ? 'gas test' : null,
        k.needs_standby ? 'name a standby and rescue plan when issuing' : null, 'issue'].filter(Boolean) };
  });
}

async function issue(db, pos, opts) {
  allow(opts, ['by', 'standby', 'rescue', 'override-by']); noExtra(pos, 1);
  return tx(db, async () => {
    let p = await permitRow(db, pos[0]);
    if (p.status !== 'requested') throw Error(`${p.code} is ${p.status}; only a requested permit is issued`);
    const by = await resolve(db, 'people', need(opts, 'by'));
    if (by.id === p.receiver_id) throw Error(`${by.name} is the receiver on ${p.code}; a different person issues it`);
    if (!(await hasTicket(db, by.id, 'ISSUER'))) throw Error(`${by.name} is not a current permit issuer`);
    if (opts.standby) await db.query('update ptw.permits set standby_id = $2 where id = $1', [p.id, (await resolve(db, 'people', String(opts.standby))).id]);
    if (opts.rescue) await db.query('update ptw.permits set rescue_plan = $2 where id = $1', [p.id, String(opts.rescue)]);
    p = await permitRow(db, p.code);
    const [{ expired }] = await db.query('select $1::timestamp < ptw.site_now() expired', [p.valid_to]);
    if (expired) throw Error(`${p.code} ran out at ${p.valid_to}. Request a new permit.`);
    await gate(db, await readiness(db, p), opts, p.id, `issue ${p.code}`);
    await db.query("update ptw.permits set status = 'issued', issuer_id = $2, issued_at = ptw.site_now() where id = $1", [p.id, by.id]);
    return { permit: p.code, status: 'issued', issuer: by.name, valid_to: p.valid_to };
  });
}

async function signOn(db, pos, opts) {
  allow(opts, ['person', 'override-by']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    if (p.status !== 'issued') throw Error(`${p.code} is ${p.status}; crew sign on to an issued permit`);
    const pe = await resolve(db, 'people', need(opts, 'person'));
    const problems = [];
    if (p.crew_ticket && !(await hasTicket(db, pe.id, p.crew_ticket))) {
      const [{ name }] = await db.query('select name from ptw.ticket_kinds where code = $1', [p.crew_ticket]);
      problems.push(`${pe.name} has no current ${name} ticket`);
    }
    problems.push(...await contractorGaps(db, pe.id));
    await gate(db, problems, opts, p.id, `sign ${pe.name} on to ${p.code}`);
    await db.query(`insert into ptw.permit_crew (permit_id, person_id, on_at) values ($1, $2, ptw.site_now())
      on conflict (permit_id, person_id) do update set on_at = ptw.site_now(), off_at = null`, [p.id, pe.id]);
    const iso = await db.query(`select i.code from ptw.permit_isolations pi join ptw.isolations i on i.id = pi.isolation_id
      where pi.permit_id = $1 and i.status <> 'removed'`, [p.id]);
    return { permit: p.code, signed_on: pe.name, next: iso.length ? `put a personal lock on ${iso.map((r) => r.code).join(', ')}` : '' };
  });
}

async function signOff(db, pos, opts) {
  allow(opts, ['person']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    const pe = await resolve(db, 'people', need(opts, 'person'));
    if ((await db.query('select 1 from ptw.inside_now where permit = $1 and person = $2', [p.code, pe.name])).length) throw Error(`${pe.name} is still recorded inside. Record the exit first.`);
    const [r] = await db.query('update ptw.permit_crew set off_at = ptw.site_now() where permit_id = $1 and person_id = $2 and off_at is null returning id', [p.id, pe.id]);
    if (!r) throw Error(`${pe.name} is not signed on to ${p.code}`);
    const locks = await db.query(`select pl.lock_no, i.code from ptw.personal_locks pl join ptw.isolations i on i.id = pl.isolation_id
      join ptw.permit_isolations pi on pi.isolation_id = i.id and pi.permit_id = $1 where pl.person_id = $2 and pl.off_at is null`, [p.id, pe.id]);
    return { permit: p.code, signed_off: pe.name, locks_still_on: locks.map((l) => `${l.lock_no} on ${l.code}`) };
  });
}

async function enter(db, pos, opts) {
  allow(opts, ['person', 'override-by']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    if (p.status !== 'issued') throw Error(`${p.code} is ${p.status}; nobody enters on it`);
    const pe = await resolve(db, 'people', need(opts, 'person'));
    if (!(await db.query('select 1 from ptw.permit_crew where permit_id = $1 and person_id = $2 and off_at is null', [p.id, pe.id])).length) throw Error(`${pe.name} is not signed on to ${p.code}`);
    if ((await db.query('select 1 from ptw.entries where permit_id = $1 and person_id = $2 and out_at is null', [p.id, pe.id])).length) throw Error(`${pe.name} is already inside`);
    const problems = [];
    const g = await gasProblem(db, p.id); if (g) problems.push(g);
    if (!p.standby_id) problems.push('no standby person');
    if (p.crew_ticket && !(await hasTicket(db, pe.id, p.crew_ticket))) problems.push(`${pe.name} has no current entry ticket`);
    if ((await db.query('select 1 from ptw.permit_board where id = $1 and minutes_left < 0', [p.id])).length) problems.push('the permit has expired');
    await gate(db, problems, opts, p.id, `let ${pe.name} enter on ${p.code}`);
    await db.query('insert into ptw.entries (permit_id, person_id, in_at) values ($1, $2, ptw.site_now())', [p.id, pe.id]);
    const [{ n }] = await db.query('select count(*)::int n from ptw.entries where permit_id = $1 and out_at is null', [p.id]);
    return { permit: p.code, entered: pe.name, inside_now: n };
  });
}

async function exitSpace(db, pos, opts) {
  allow(opts, ['person']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    const pe = await resolve(db, 'people', need(opts, 'person'));
    const [r] = await db.query('update ptw.entries set out_at = ptw.site_now() where permit_id = $1 and person_id = $2 and out_at is null returning id', [p.id, pe.id]);
    if (!r) throw Error(`${pe.name} is not recorded inside on ${p.code}`);
    const [{ n }] = await db.query('select count(*)::int n from ptw.entries where permit_id = $1 and out_at is null', [p.id]);
    return { permit: p.code, out: pe.name, inside_now: n };
  });
}

async function gas(db, pos, opts) {
  allow(opts, ['by', 'o2', 'lel', 'h2s', 'co', 'location', 'instrument', 'no-bump']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    if (!['requested', 'issued', 'suspended'].includes(p.status)) throw Error(`${p.code} is ${p.status}`);
    const by = await resolve(db, 'people', need(opts, 'by'));
    if (!(await hasTicket(db, by.id, 'GAS_TEST'))) throw Error(`${by.name} has no current gas testing ticket. A competent tester takes the reading.`);
    const o2 = num(need(opts, 'o2'), '--o2'); const lel = num(need(opts, 'lel'), '--lel');
    await db.query(`insert into ptw.gas_tests (permit_id, tested_at, tester_id, location, o2_pct, lel_pct, h2s_ppm, co_ppm, instrument, bump_tested)
      values ($1, ptw.site_now(), $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, by.id, opts.location || null, o2, lel, num(opts.h2s, '--h2s'), num(opts.co, '--co'), opts.instrument || null, opts['no-bump'] !== true]);
    const [g] = await db.query('select failures from ptw.gas_status where permit_id = $1', [p.id]);
    return { permit: p.code, tester: by.name, o2, lel, result: g?.failures ? `FAILED: ${g.failures}` : 'inside limits' };
  });
}

async function isolate(db, pos, opts) {
  allow(opts, ['by', 'points', 'reason', 'lockbox', 'permit']); noExtra(pos, 1);
  return tx(db, async () => {
    const a = await resolve(db, 'assets', pos[0]);
    const by = await resolve(db, 'people', need(opts, 'by'));
    if (!(await hasTicket(db, by.id, 'ISOLATOR'))) throw Error(`${by.name} is not a current authorised isolator`);
    const lines = need(opts, 'points').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [point, lock] = s.split(':').map((x) => x?.trim());
      if (!point || !lock) throw Error(`"${s}" needs POINT:LOCK, for example BE2-E1:L-01`);
      return { point, lock };
    });
    const code = await nextCode(db, 'isolations', 'ISO-');
    const [{ id }] = await db.query(`insert into ptw.isolations (code, asset_id, isolator_id, reason, lockbox, status, applied_at)
      values ($1, $2, $3, $4, $5, 'applied', ptw.site_now()) returning id`, [code, a.id, by.id, opts.reason || null, opts.lockbox || null]);
    for (const l of lines) {
      const pt = await resolve(db, 'points', l.point);
      if (!(await db.query('select 1 from ptw.isolation_points where id = $1 and asset_id = $2', [pt.id, a.id])).length) throw Error(`${pt.code} is not on ${a.code}`);
      await db.query('insert into ptw.isolation_lines (isolation_id, point_id, lock_no) values ($1, $2, $3)', [id, pt.id, l.lock]);
    }
    if (opts.permit) {
      const p = await permitRow(db, String(opts.permit));
      await db.query('insert into ptw.permit_isolations (permit_id, isolation_id) values ($1, $2) on conflict do nothing', [p.id, id]);
    }
    const missing = await db.query(`select pt.code, pt.energy from ptw.isolation_points pt where pt.asset_id = $1
      and not exists (select 1 from ptw.isolation_lines l where l.isolation_id = $2 and l.point_id = pt.id) order by pt.code`, [a.id, id]);
    return { isolation: code, asset: a.code, points_locked: lines.length, still_live: missing.map((m) => `${m.code} (${m.energy})`),
      next: 'prove zero energy, then verify' };
  });
}

async function verify(db, pos, opts) {
  allow(opts, ['by', 'note']); noExtra(pos, 1);
  return tx(db, async () => {
    const i = await resolve(db, 'isolations', pos[0]);
    const by = await resolve(db, 'people', need(opts, 'by'));
    if (!(await hasTicket(db, by.id, 'ISOLATOR'))) throw Error(`${by.name} is not a current authorised isolator`);
    const [s] = await db.query('select status, points, asset_points from ptw.isolation_state where id = $1', [i.id]);
    if (s.status !== 'applied') throw Error(`${i.code} is ${s.status}`);
    if (s.points < s.asset_points) throw Error(`${i.code} locks ${s.points} of ${s.asset_points} points. Lock every point before proving it dead.`);
    await db.query("update ptw.isolations set status = 'verified', verified_at = ptw.site_now(), verified_by = $2, verify_note = $3 where id = $1", [i.id, by.id, need(opts, 'note')]);
    return { isolation: i.code, verified_by: by.name };
  });
}

async function close(db, pos, opts) {
  allow(opts, ['by', 'handback', 'override-by']); noExtra(pos, 1);
  return tx(db, async () => {
    const p = await permitRow(db, pos[0]);
    if (!['issued', 'suspended'].includes(p.status)) throw Error(`${p.code} is ${p.status}`);
    const by = await resolve(db, 'people', need(opts, 'by'));
    const inside = await db.query('select person from ptw.inside_now where permit = $1', [p.code]);
    if (inside.length) throw Error(`Cannot close ${p.code}: ${inside.map((r) => r.person).join(', ')} still recorded inside`);
    const problems = [];
    const crew = await db.query('select pe.name from ptw.permit_crew pc join ptw.people pe on pe.id = pc.person_id where pc.permit_id = $1 and pc.off_at is null', [p.id]);
    if (crew.length) problems.push(`still signed on: ${crew.map((r) => r.name).join(', ')}`);
    if (p.needs_fire_watch) {
      const [fw] = await db.query(`select work_ended_at is null no_end, fire_watch_end_at is null no_watch,
        (extract(epoch from (fire_watch_end_at - work_ended_at)) / 60)::int minutes, (select fire_watch_minutes from ptw.settings) rule from ptw.permits where id = $1`, [p.id]);
      if (fw.no_end || fw.no_watch) problems.push('no fire watch recorded (run finish, then fire-watch-done)');
      else if (fw.minutes < fw.rule) problems.push(`fire watch kept ${fw.minutes} minutes; the site rule is ${fw.rule}`);
    }
    await gate(db, problems, opts, p.id, `close ${p.code}`);
    await db.query("update ptw.permits set status = 'closed', closed_at = ptw.site_now(), closed_by = $2, handback = $3 where id = $1", [p.id, by.id, need(opts, 'handback')]);
    await db.query('update ptw.permit_crew set off_at = ptw.site_now() where permit_id = $1 and off_at is null', [p.id]);
    const iso = await db.query(`select s.code, s.open_permit_count, s.personal_locks_on from ptw.permit_isolations pi join ptw.isolation_state s on s.id = pi.isolation_id
      where pi.permit_id = $1 and s.status <> 'removed'`, [p.id]);
    return { permit: p.code, status: 'closed', handback: opts.handback,
      isolations_to_remove: iso.filter((r) => r.open_permit_count === 0).map((r) => `${r.code}${r.personal_locks_on ? ` (${r.personal_locks_on} personal locks still on)` : ''}`) };
  });
}

async function add(db, pos, opts) {
  allow(opts, ['data']); noExtra(pos, 1);
  const kind = pos[0];
  if (!ADD_FIELDS[kind]) throw Error(`add needs one of: ${Object.keys(ADD_FIELDS).join(', ')}`);
  const raw = JSON.parse(fs.readFileSync(path.resolve(need(opts, 'data')), 'utf8'));
  const rows = Array.isArray(raw) ? raw : [raw];
  return tx(db, async () => {
    let added = 0;
    for (const r of rows) {
      const cols = []; const vals = [];
      for (const f of ADD_FIELDS[kind]) {
        if (r[f] === undefined && !(REFS[f] && r[f.replace(/_id$/, '')] !== undefined)) continue;
        let v = r[f] ?? r[f.replace(/_id$/, '')];
        if (REFS[f]) v = (await resolve(db, REFS[f], String(v))).id;
        cols.push(f); vals.push(v);
      }
      if (!cols.includes('code') || !cols.includes('name')) throw Error(`Each ${kind} row needs a code and a name`);
      await db.query(`insert into ptw.${kind} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
      added++;
    }
    return { added, kind };
  });
}

// ------------------------------------------------------------------ attention
async function attention(db) {
  const rows = [];
  const push = (area, item, why, next) => rows.push({ area, item, why, next });
  for (const r of await db.query('select permit, person, minutes_in, coalesce(standby, \'NONE\') standby from ptw.inside_now order by in_at')) {
    push('inside now', `${r.permit} ${r.person}`, `inside ${r.minutes_in} min, standby ${r.standby}`, 'Know who is in before anything else changes');
  }
  for (const f of await db.query("select rule, ref, detail from ptw.compliance_findings where severity = 'breach' order by rule, ref")) {
    push('breach', `${f.ref}`, `${f.rule}: ${f.detail}`, NEXT[f.rule] || 'Fix the record or stop the work');
  }
  for (const b of await db.query("select code, task, minutes_left from ptw.permit_board where status = 'issued' and state = 'ending soon' order by minutes_left")) {
    push('ending soon', `permit ${b.code}`, `${b.task}: ${b.minutes_left} minutes left`, 'Close it, or request the next permit');
  }
  for (const r of await db.query(READS.requested)) {
    push('to issue', `permit ${r.code}`, `${r.task}, starts ${r.starts}${r.ticket_gaps ? `; ${r.ticket_gaps}` : ''}${r.isolation ? `; ${r.isolation}` : ''}`, 'Line up isolation, gas test and people, then issue');
  }
  for (const f of await db.query("select rule, ref, detail from ptw.compliance_findings where severity = 'warning' order by rule, ref")) {
    push('warning', f.ref, `${f.rule}: ${f.detail}`, NEXT[f.rule] || 'Check it');
  }
  for (const r of await db.query("select person, company, ticket, days_left from ptw.ticket_status where state = 'expiring' order by days_left")) {
    push('renew', r.person, `${r.ticket} (${r.company}) lapses in ${r.days_left} days`, 'Book the refresher');
  }
  for (const r of await db.query(`select name, insurance_expires_on - ptw.site_now()::date days from ptw.companies where kind = 'contractor'
      and insurance_expires_on between ptw.site_now()::date and ptw.site_now()::date + (select ticket_warn_days from ptw.settings)`)) {
    push('renew', r.name, `insurance certificate lapses in ${r.days} days`, 'Ask for the renewed certificate (draft-contractor)');
  }
  return rows;
}
const NEXT = {
  'permit-expired': 'Stop the work: close the permit, or suspend it and issue a new one',
  'isolation-not-verified': 'Stop work until the isolator proves zero energy and runs verify',
  'isolation-incomplete': 'Lock the missing point, or stop the work on it',
  'lock-left-on': 'Find the person; they remove their own lock',
  'gas-test-stale': 'Retest before anyone enters or the work goes on',
  'gas-test-failed': 'Everyone out, ventilate, retest',
  'gas-test-missing': 'Test before anyone enters or the work goes on',
  'standby-missing': 'Name a standby and rescue plan before entry',
  'entry-not-permitted': 'Get them out',
  'ticket-expired': 'Swap the person, or record the renewed ticket',
  'ticket-missing': 'Swap the person, or record their ticket',
  'contractor-induction': 'Induct them before they work',
  'contractor-insurance': 'Get the renewed certificate before more work',
  'permit-conflict': 'Suspend one permit until the other is done',
  'fire-watch-short': 'Talk to the receiver; check the area',
  'handover-missing': 'Record the shift handover',
  'isolation-orphaned': 'Remove it, or link it to the next permit',
  'permit-too-long': 'Split the job into shorter permits',
};

// ------------------------------------------------------------------ import
const KIND_ALIASES = { 'hot work': 'hot_work', 'hot': 'hot_work', 'confined space': 'confined_space', 'confined space entry': 'confined_space', 'cse': 'confined_space',
  'electrical': 'electrical', 'electrical isolation': 'electrical', 'working at height': 'height', 'work at height': 'height', 'height': 'height',
  'excavation': 'excavation', 'ground disturbance': 'excavation', 'lifting': 'lifting', 'mechanical lifting': 'lifting', 'crane': 'lifting',
  'general': 'general', 'cold work': 'general', 'cold': 'general', 'general work': 'general', 'mechanical': 'general' };
const TICKET_ALIASES = { 'permit issuer': 'ISSUER', 'issuer': 'ISSUER', 'permit receiver': 'RECEIVER', 'receiver': 'RECEIVER', 'performing authority': 'RECEIVER',
  'authorised isolator': 'ISOLATOR', 'isolator': 'ISOLATOR', 'isolation': 'ISOLATOR', 'confined space': 'CS_ENTRY', 'confined space entry': 'CS_ENTRY',
  'confined space standby': 'CS_STANDBY', 'standby': 'CS_STANDBY', 'gas test': 'GAS_TEST', 'gas testing': 'GAS_TEST', 'gas detection': 'GAS_TEST',
  'hot work': 'HOT_WORK', 'working at height': 'HEIGHTS', 'work at height': 'HEIGHTS', 'heights': 'HEIGHTS', 'ewp': 'EWP', 'elevating work platform': 'EWP',
  'electrical': 'ELECTRICAL', 'electrical licence': 'ELECTRICAL', 'electrician': 'ELECTRICAL', 'rigging': 'RIGGING', 'dogging': 'RIGGING', 'dogging and rigging': 'RIGGING' };
const STATUS_ALIASES = { open: 'requested', active: 'requested', live: 'requested', issued: 'requested', requested: 'requested', draft: 'requested', pending: 'requested',
  suspended: 'requested', closed: 'closed', complete: 'closed', completed: 'closed', 'handed back': 'closed', cancelled: 'cancelled', canceled: 'cancelled', rejected: 'cancelled' };
const slugCode = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 20) || 'X';

// A permit register or training matrix exported from the incumbent as CSV, mapped by column name.
export function mapPermitRow(r, n) {
  const typeRaw = pick(r, 'Permit Type', 'Type', 'Work Type', 'Certificate Type').trim();
  const kind = KIND_ALIASES[typeRaw.toLowerCase()];
  if (!kind) throw Error(`Row ${n}: permit type "${typeRaw}" is not one of: ${[...new Set(Object.keys(KIND_ALIASES))].join(', ')}`);
  const statusRaw = pick(r, 'Status', 'Permit Status').trim().toLowerCase();
  const status = STATUS_ALIASES[statusRaw];
  if (!status) throw Error(`Row ${n}: status "${statusRaw}" is not recognised`);
  const ts = (v, label) => {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) throw Error(`Row ${n}: ${label} "${s}" is not a date and time (YYYY-MM-DD HH:MM or DD/MM/YYYY HH:MM)`);
    const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2].padStart(2, '0'), m[1].padStart(2, '0')];
    return `${y}-${mo}-${d} ${m[4].padStart(2, '0')}:${m[5]}:00`;
  };
  const code = pick(r, 'Permit No', 'Permit Number', 'Permit ID', 'Number', 'Ref').trim();
  if (!code) throw Error(`Row ${n}: no permit number`);
  return {
    code, kind, status, original_status: statusRaw,
    area: pick(r, 'Area', 'Location', 'Site Area').trim() || 'Imported',
    asset: pick(r, 'Equipment', 'Asset', 'Equipment ID', 'Plant').trim(),
    task: pick(r, 'Description', 'Task', 'Work Description', 'Scope').trim() || '(no description in export)',
    receiver: pick(r, 'Receiver', 'Performing Authority', 'Permit Holder', 'Requested By').trim(),
    issuer: pick(r, 'Issuer', 'Issuing Authority', 'Area Authority', 'Approver').trim(),
    valid_from: ts(pick(r, 'Valid From', 'Start', 'Start Date'), 'start'),
    valid_to: ts(pick(r, 'Valid To', 'End', 'Expiry', 'End Date'), 'end'),
    closed_at: pick(r, 'Closed', 'Closed At', 'Closed Date') ? ts(pick(r, 'Closed', 'Closed At', 'Closed Date'), 'closed') : null,
  };
}
export function mapTicketRow(r, n) {
  const name = pick(r, 'Name', 'Person', 'Employee', 'Worker').trim();
  if (!name) throw Error(`Row ${n}: no name`);
  const ticketRaw = pick(r, 'Ticket', 'Competency', 'Training', 'Course', 'Licence').trim();
  const kind = ticketRaw ? TICKET_ALIASES[ticketRaw.toLowerCase()] || (/^[A-Z_]+$/.test(ticketRaw) ? ticketRaw : null) : null;
  if (ticketRaw && !kind) throw Error(`Row ${n}: ticket "${ticketRaw}" is not mapped. Add it to TICKET_ALIASES or use a ticket kind code.`);
  const d = (v, label) => {
    const s = String(v || '').trim(); if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) throw Error(`Row ${n}: ${label} "${s}" is not a date (YYYY-MM-DD or DD/MM/YYYY)`);
    return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  return { name, company: pick(r, 'Company', 'Employer', 'Contractor').trim(), kind, ref: pick(r, 'Ref', 'Certificate', 'Licence No', 'Number').trim() || null,
    expires_on: d(pick(r, 'Expiry', 'Expires', 'Expiry Date', 'Valid To'), 'expiry'),
    induction_expires_on: d(pick(r, 'Induction Expiry', 'Induction Expires'), 'induction expiry') };
}

async function importCsv(db, pos, opts) {
  allow(opts, ['file', 'dry-run']); noExtra(pos, 1);
  const kind = pos[0];
  if (!['permit-register', 'training-matrix'].includes(kind)) throw Error('import needs permit-register or training-matrix');
  const file = path.resolve(need(opts, 'file'));
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const mapped = rows.map((r, i) => (kind === 'permit-register' ? mapPermitRow : mapTicketRow)(r, i + 2));
  const dryRun = opts['dry-run'] === true;
  return tx(db, async () => {
    const result = { file: path.basename(file), rows: rows.length, inserted: 0, skipped_identical: 0, created_people: 0, created_companies: 0, created_areas: 0, created_assets: 0, dry_run: dryRun };
    const [own] = await db.query("select id from ptw.companies where kind = 'own' order by created_at limit 1");
    const company = async (name) => {
      if (!name) { if (!own) throw Error('No own company yet. Add one first (add companies with kind own).'); return own.id; }
      const hit = await db.query('select id from ptw.companies where lower(name) = lower($1)', [name]);
      if (hit.length) return hit[0].id;
      const code = await uniqueCode(db, 'companies', slugCode(name));
      const [{ id }] = await db.query("insert into ptw.companies (code, name, kind) values ($1, $2, 'contractor') returning id", [code, name]);
      result.created_companies++; return id;
    };
    const person = async (name, companyName) => {
      if (!name) return null;
      const hit = await db.query('select id from ptw.people where lower(name) = lower($1)', [name]);
      if (hit.length) return hit[0].id;
      const code = await uniqueCode(db, 'people', slugCode(name.split(/\s+/).map((w) => w.slice(0, 3)).join('')));
      const [{ id }] = await db.query('insert into ptw.people (code, name, company_id, role) values ($1, $2, $3, $4) returning id', [code, name, await company(companyName), 'imported']);
      result.created_people++; return id;
    };
    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i];
      const hash = crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
      if ((await db.query('select 1 from ptw.import_rows where source = $1 and row_hash = $2', [kind, hash])).length) { result.skipped_identical++; continue; }
      let id;
      if (kind === 'permit-register') {
        if ((await db.query('select 1 from ptw.permits where lower(code) = lower($1)', [m.code])).length) throw Error(`Row ${i + 2}: permit ${m.code} already exists. Nothing was imported.`);
        let area = (await db.query('select id from ptw.areas where lower(code) = lower($1) or lower(name) = lower($1)', [m.area]))[0]?.id;
        if (!area) { [{ id: area }] = await db.query('insert into ptw.areas (code, name) values ($1, $2) returning id', [await uniqueCode(db, 'areas', slugCode(m.area)), m.area]); result.created_areas++; }
        let asset = null;
        if (m.asset) {
          asset = (await db.query('select id from ptw.assets where lower(code) = lower($1) or lower(name) = lower($1)', [m.asset]))[0]?.id;
          if (!asset) { [{ id: asset }] = await db.query('insert into ptw.assets (code, name, area_id) values ($1, $2, $3) returning id', [await uniqueCode(db, 'assets', slugCode(m.asset)), m.asset, area]); result.created_assets++; }
        }
        const receiver = await person(m.receiver); const issuer = await person(m.issuer);
        const closedAt = m.status === 'closed' ? (m.closed_at || m.valid_to) : null;
        [{ id }] = await db.query(`insert into ptw.permits (code, kind, area_id, asset_id, task, status, issuer_id, receiver_id, valid_from, valid_to, issued_at, closed_at, handback, cancelled_reason)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
          [m.code, m.kind, area, asset, m.task, m.status, m.status === 'requested' ? null : issuer, receiver, m.valid_from, m.valid_to,
            m.status === 'closed' ? m.valid_from : null, closedAt, m.status === 'closed' ? 'Imported as closed' : null, m.status === 'cancelled' ? 'Imported as cancelled' : null]);
        if (m.status === 'requested') await note(db, 'permit', id, 'import', `Imported as "${m.original_status}". Brought in as requested: isolate, test and issue it here before work goes on.`);
      } else {
        const pid = await person(m.name, m.company);
        if (m.induction_expires_on) await db.query('update ptw.people set induction_expires_on = $2, inducted_on = coalesce(inducted_on, $2::date - 365) where id = $1', [pid, m.induction_expires_on]);
        if (m.kind) {
          if (!(await db.query('select 1 from ptw.ticket_kinds where code = $1', [m.kind])).length) throw Error(`Row ${i + 2}: no ticket kind ${m.kind}`);
          await db.query(`insert into ptw.tickets (person_id, kind, ref, expires_on) values ($1, $2, $3, $4)
            on conflict (person_id, kind) do update set ref = excluded.ref, expires_on = excluded.expires_on`, [pid, m.kind, m.ref, m.expires_on]);
        }
        id = pid;
      }
      result.inserted++;
      await db.query('insert into ptw.import_rows (source, file_name, row_number, row_hash, target_id) values ($1, $2, $3, $4, $5)', [kind, path.basename(file), i + 2, hash, id]);
    }
    return result;
  }, { dryRun });
}
async function uniqueCode(db, tableName, base) {
  let code = base; let n = 2;
  while ((await db.query(`select 1 from ptw.${tableName} where code = $1`, [code])).length) code = `${base}-${n++}`;
  return code;
}

// ------------------------------------------------------------------ drafts (never sent)
function draftsDir() { const d = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts'); fs.mkdirSync(d, { recursive: true }); return d; }
function md(rows) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]);
  return [`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => String(r[k] ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n') + '\n';
}
async function today(db) { return (await db.query("select to_char(ptw.site_now(), 'YYYY-MM-DD') today"))[0].today; }
async function draftWeekly(db) {
  const d = await today(db);
  const closed = await db.query(`select p.code, p.kind, p.task, to_char(p.closed_at, 'YYYY-MM-DD') closed from ptw.permits p
    where p.status = 'closed' and p.closed_at >= ptw.site_now() - interval '7 days' order by p.closed_at`);
  const body = [`# Permit review, week of ${d}`, '',
    'Draft for the Monday safety meeting. Figures come from the database at the time of writing. Nothing has been sent.', '',
    '## Rule findings', md(await db.query(READS.compliance)),
    '## Open permits', md(await db.query(READS.board)),
    '## Permits closed in the last 7 days', md(closed),
    '## Tickets, inductions and insurance to renew', md(await db.query(READS.expiring)),
    '## Where the isolation hours went, last 90 days', md((await db.query(READS.history)).slice(0, 5))].join('\n');
  const file = path.join(draftsDir(), `weekly-review-${d}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, sections: 5 };
}
async function draftHandover(db) {
  const [{ stamp }] = await db.query("select to_char(ptw.site_now(), 'YYYY-MM-DD-HH24MI') stamp");
  const body = [`# Shift handover, ${stamp.slice(0, 10)} ${stamp.slice(11, 13)}:${stamp.slice(13)}`, '',
    'Draft for the incoming shift. Read it with the permit board. Each open permit still needs its own handover recorded (handover). Nothing has been sent.', '',
    '## Inside confined spaces now', md(await db.query(READS.inside)),
    '## Open permits', md(await db.query(READS.board)),
    '## Isolations in place', md(await db.query(READS.isolations)),
    '## Personal locks on', md(await db.query(READS.locks)),
    '## Gas tests', md(await db.query(READS.gas)),
    '## Breaches to deal with first', md(await db.query("select rule, ref, detail from ptw.compliance_findings where severity = 'breach' order by rule")),
    '## Waiting to be issued', md(await db.query(READS.requested))].join('\n');
  const file = path.join(draftsDir(), `handover-${stamp}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, sections: 7 };
}
async function draftContractor(db, ref) {
  const c = await resolve(db, 'companies', ref);
  const [co] = await db.query(`select c.name, c.contact, c.kind, c.insurance_expires_on, c.insurance_expires_on - ptw.site_now()::date days,
    (select business_name from ptw.settings) site from ptw.companies c where c.id = $1`, [c.id]);
  if (co.kind !== 'contractor') throw Error(`${c.code} is not a contractor`);
  const lapsing = await db.query(`select ts.person, ts.ticket, ts.expires_on, ts.state from ptw.ticket_status ts join ptw.people p on p.id = ts.person_id
    where p.company_id = $1 and ts.state <> 'current' order by ts.expires_on nulls first`, [c.id]);
  const insurance = co.insurance_expires_on === null ? 'We have no insurance certificate on file for you.'
    : co.days < 0 ? `The insurance certificate we hold ran out on ${co.insurance_expires_on}.`
    : co.days <= 30 ? `The insurance certificate we hold runs out on ${co.insurance_expires_on}.` : '';
  if (!lapsing.length && !insurance) throw Error(`${c.code} has nothing lapsing`);
  const body = [`Hi ${String(co.contact || co.name).split(' ')[0]},`, '',
    `Before your team's next job at ${co.site}, we need these brought up to date:`, '',
    insurance, '', lapsing.length ? md(lapsing.map((l) => ({ person: l.person, ticket: l.ticket, expires: l.expires_on || '', state: l.state }))) : '',
    'Send the renewed certificates through and we will update our records. Anyone whose ticket or induction has lapsed cannot sign on to a permit until it is renewed.', '',
    'Thanks,', ''].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const file = path.join(draftsDir(), `contractor-${c.code}-${await today(db)}.md`);
  fs.writeFileSync(file, body);
  return { draft: file, company: co.name, items: lapsing.length + (insurance ? 1 : 0) };
}

// ------------------------------------------------------------------ main
function print(out) {
  if (Array.isArray(out)) {
    if (!out.length) return console.log('  (none)');
    if (typeof out[0] !== 'object') return console.log(out.map((x) => `  ${x}`).join('\n'));
    const keys = Object.keys(out[0]);
    return console.log(table(out, keys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), width: 70,
      align: typeof out[0][k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(out[0][k] ?? '')) ? 'right' : 'left' }))));
  }
  if (out && typeof out === 'object') {
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { console.log(`\n${k.replace(/_/g, ' ')}`); print(v); }
      else if (Array.isArray(v) && !v.length) console.log(`${k.replace(/_/g, ' ')}: (none)`);
      else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) { console.log(`\n${k.replace(/_/g, ' ')}`); for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2.replace(/_/g, ' ')}: ${v2 ?? ''}`); }
      else console.log(`${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v ?? ''}`);
    }
  }
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const db = await getDb();
  try {
    const out = await run(db, args.filter((a) => a !== '--json'));
    if (json) console.log(JSON.stringify(out, null, 2)); else print(out);
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  } finally { await db.close(); }
}
