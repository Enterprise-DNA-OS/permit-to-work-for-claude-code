-- The views the commands read. Every figure the CLI prints comes from one of these.

-- A permit is open while it is requested, issued or suspended.
create or replace function ptw.is_open(p_status text) returns boolean language sql immutable as $$
  select p_status in ('requested', 'issued', 'suspended')
$$;

-- The latest gas test on each permit, and whether every reading sits inside the limits.
create or replace view ptw.gas_status as
select p.id permit_id, p.code permit, p.kind, p.status, g.tested_at, g.tester_id, g.o2_pct, g.lel_pct, g.h2s_ppm, g.co_ppm,
  case when g.tested_at is null then null else (extract(epoch from (ptw.site_now() - g.tested_at)) / 60)::int end minutes_ago,
  case when g.tested_at is null then null else
    concat_ws(', ',
      case when g.o2_pct is null then 'oxygen not read'
           when g.o2_pct < o2.min_value or g.o2_pct > o2.max_value then 'oxygen ' || g.o2_pct || '%' end,
      case when g.lel_pct is null then 'flammable gas not read'
           when g.lel_pct > lel.max_value then 'flammable gas ' || g.lel_pct || '% LEL' end,
      case when g.h2s_ppm > h2s.max_value then 'H2S ' || g.h2s_ppm || ' ppm' end,
      case when g.co_ppm > co.max_value then 'CO ' || g.co_ppm || ' ppm' end,
      case when not g.bump_tested then 'monitor not bump tested' end)
  end failures
from ptw.permits p
join ptw.permit_kinds k on k.code = p.kind and k.needs_gas_test
left join lateral (select * from ptw.gas_tests t where t.permit_id = p.id order by t.tested_at desc limit 1) g on true
left join ptw.gas_limits o2 on o2.gas = 'o2'
left join ptw.gas_limits lel on lel.gas = 'lel'
left join ptw.gas_limits h2s on h2s.gas = 'h2s'
left join ptw.gas_limits co on co.gas = 'co';

-- Each isolation with its points, locks and the permits that rely on it.
create or replace view ptw.isolation_state as
select i.id, i.code, a.code asset, a.name asset_name, ar.code area, i.status, i.applied_at, i.verified_at, i.removed_at,
  iso.name isolator, ver.name verified_by, i.lockbox,
  (select count(*) from ptw.isolation_lines l where l.isolation_id = i.id)::int points,
  (select count(*) from ptw.isolation_points pt where pt.asset_id = i.asset_id)::int asset_points,
  (select count(*) from ptw.personal_locks pl where pl.isolation_id = i.id and pl.off_at is null)::int personal_locks_on,
  (select string_agg(p.code, ', ' order by p.code) from ptw.permit_isolations pi join ptw.permits p on p.id = pi.permit_id
     where pi.isolation_id = i.id and ptw.is_open(p.status)) open_permits,
  (select count(*) from ptw.permit_isolations pi join ptw.permits p on p.id = pi.permit_id
     where pi.isolation_id = i.id and ptw.is_open(p.status))::int open_permit_count,
  round(extract(epoch from (coalesce(i.removed_at, ptw.site_now()) - i.applied_at)) / 3600.0, 1) hours_isolated
from ptw.isolations i
join ptw.assets a on a.id = i.asset_id
join ptw.areas ar on ar.id = a.area_id
join ptw.people iso on iso.id = i.isolator_id
left join ptw.people ver on ver.id = i.verified_by;

-- The live board: every open permit with its state.
create or replace view ptw.permit_board as
select p.id, p.code, p.kind, k.name kind_name, ar.code area, a.code asset, p.task, p.status,
  rq.name receiver, c.name company, iss.name issuer, sb.name standby,
  p.valid_from, p.valid_to,
  (extract(epoch from (p.valid_to - ptw.site_now())) / 60)::int minutes_left,
  (select count(*) from ptw.permit_crew pc where pc.permit_id = p.id and pc.off_at is null)::int crew_on,
  (select count(*) from ptw.entries e where e.permit_id = p.id and e.out_at is null)::int inside,
  p.isolation_required or k.needs_isolation isolation_needed,
  exists (select 1 from ptw.permit_isolations pi join ptw.isolations i on i.id = pi.isolation_id
    where pi.permit_id = p.id and i.status = 'verified') isolation_verified,
  gs.minutes_ago gas_minutes_ago, gs.failures gas_failures,
  coalesce((select max(h.at) from ptw.handovers h where h.permit_id = p.id), p.issued_at) last_handover_at,
  case when p.status = 'requested' then 'waiting to be issued'
       when p.status = 'suspended' then 'suspended'
       when p.valid_to < ptw.site_now() then 'EXPIRED'
       when p.valid_to < ptw.site_now() + make_interval(mins => (select ending_minutes from ptw.settings)) then 'ending soon'
       else 'live' end state
from ptw.permits p
join ptw.permit_kinds k on k.code = p.kind
join ptw.areas ar on ar.id = p.area_id
left join ptw.assets a on a.id = p.asset_id
left join ptw.people rq on rq.id = p.receiver_id
left join ptw.companies c on c.id = rq.company_id
left join ptw.people iss on iss.id = p.issuer_id
left join ptw.people sb on sb.id = p.standby_id
left join ptw.gas_status gs on gs.permit_id = p.id
where ptw.is_open(p.status);

-- Personal locks still on, and whether the person still has a reason to have one.
create or replace view ptw.locks_on as
select pl.id, i.code isolation, a.code asset, pe.code person_code, pe.name person, c.name company, pl.lock_no, pl.on_at,
  round(extract(epoch from (ptw.site_now() - pl.on_at)) / 3600.0, 1) hours_on,
  (select string_agg(p.code, ', ' order by p.code) from ptw.permit_crew pc join ptw.permits p on p.id = pc.permit_id
     join ptw.permit_isolations pi on pi.permit_id = p.id and pi.isolation_id = i.id
     where pc.person_id = pe.id and pc.off_at is null and ptw.is_open(p.status)) working_under,
  case when not exists (select 1 from ptw.permit_crew pc join ptw.permits p on p.id = pc.permit_id
     join ptw.permit_isolations pi on pi.permit_id = p.id and pi.isolation_id = i.id
     where pc.person_id = pe.id and pc.off_at is null and ptw.is_open(p.status))
     then 'no open permit for this person' else '' end flag
from ptw.personal_locks pl
join ptw.isolations i on i.id = pl.isolation_id
join ptw.assets a on a.id = i.asset_id
join ptw.people pe on pe.id = pl.person_id
join ptw.companies c on c.id = pe.company_id
where pl.off_at is null;

-- Who is inside a confined space right now.
create or replace view ptw.inside_now as
select e.id, p.code permit, a.code asset, a.name asset_name, pe.name person, c.name company, e.in_at,
  (extract(epoch from (ptw.site_now() - e.in_at)) / 60)::int minutes_in, sb.name standby, p.status permit_status
from ptw.entries e
join ptw.permits p on p.id = e.permit_id
left join ptw.assets a on a.id = p.asset_id
join ptw.people pe on pe.id = e.person_id
join ptw.companies c on c.id = pe.company_id
left join ptw.people sb on sb.id = p.standby_id
where e.out_at is null;

-- Every ticket, induction and insurance certificate with the days left on it.
create or replace view ptw.ticket_status as
select pe.id person_id, pe.code person_code, pe.name person, c.name company, t.kind, k.name ticket, t.ref, t.expires_on,
  (t.expires_on - ptw.site_now()::date) days_left,
  case when t.expires_on is null then 'current'
       when t.expires_on < ptw.site_now()::date then 'EXPIRED'
       when t.expires_on <= ptw.site_now()::date + (select ticket_warn_days from ptw.settings) then 'expiring'
       else 'current' end state
from ptw.tickets t
join ptw.people pe on pe.id = t.person_id and pe.active
join ptw.companies c on c.id = pe.company_id
join ptw.ticket_kinds k on k.code = t.kind
union all
select pe.id, pe.code, pe.name, c.name, 'INDUCTION', 'Site induction', null, pe.induction_expires_on,
  (pe.induction_expires_on - ptw.site_now()::date),
  case when pe.inducted_on is null or pe.induction_expires_on < ptw.site_now()::date then 'EXPIRED'
       when pe.induction_expires_on <= ptw.site_now()::date + (select ticket_warn_days from ptw.settings) then 'expiring'
       else 'current' end
from ptw.people pe join ptw.companies c on c.id = pe.company_id
where pe.active and c.kind = 'contractor';

-- Each person on an open permit, in each role, against the ticket that role needs.
create or replace view ptw.role_needs as
with roles as (
  select p.id permit_id, p.issuer_id person_id, 'issuer' role, 'ISSUER' needs from ptw.permits p where ptw.is_open(p.status) and p.issuer_id is not null
  union all
  select p.id, p.receiver_id, 'receiver', 'RECEIVER' from ptw.permits p where ptw.is_open(p.status) and p.receiver_id is not null
  union all
  select p.id, p.standby_id, 'standby', 'CS_STANDBY' from ptw.permits p join ptw.permit_kinds k on k.code = p.kind
    where ptw.is_open(p.status) and k.needs_standby and p.standby_id is not null
  union all
  select p.id, pc.person_id, 'crew', k.crew_ticket from ptw.permits p join ptw.permit_kinds k on k.code = p.kind
    join ptw.permit_crew pc on pc.permit_id = p.id and pc.off_at is null
    where ptw.is_open(p.status) and k.crew_ticket is not null
  union all
  select p.id, gs.tester_id, 'gas tester', 'GAS_TEST' from ptw.permits p join ptw.gas_status gs on gs.permit_id = p.id
    where ptw.is_open(p.status) and gs.tester_id is not null
  union all
  select p.id, i.isolator_id, 'isolator', 'ISOLATOR' from ptw.permits p join ptw.permit_isolations pi on pi.permit_id = p.id
    join ptw.isolations i on i.id = pi.isolation_id where ptw.is_open(p.status) and i.status <> 'removed'
)
select r.permit_id, p.code permit, r.role, pe.code person_code, pe.name person, c.name company, r.needs, k.name ticket,
  t.expires_on,
  case when t.id is null then 'missing' when t.expires_on < ptw.site_now()::date then 'expired' else 'ok' end state
from roles r
join ptw.permits p on p.id = r.permit_id
join ptw.people pe on pe.id = r.person_id
join ptw.companies c on c.id = pe.company_id
join ptw.ticket_kinds k on k.code = r.needs
left join ptw.tickets t on t.person_id = r.person_id and t.kind = r.needs;

-- Open permits that clash, by the operator's conflict rules.
create or replace view ptw.conflicts as
select a.code permit_a, a.kind kind_a, b.code permit_b, b.kind kind_b, ar.code area,
  case when r.scope = 'asset' then ast.code else null end asset, r.reason,
  greatest(a.valid_from, b.valid_from) overlap_from, least(a.valid_to, b.valid_to) overlap_to
from ptw.permits a
join ptw.permits b on b.id <> a.id
join ptw.conflict_rules r on (r.kind_a = a.kind and r.kind_b = b.kind)
join ptw.areas ar on ar.id = a.area_id
left join ptw.assets ast on ast.id = a.asset_id
where ptw.is_open(a.status) and a.status <> 'requested'
  and b.id <> a.id and ptw.is_open(b.status) and b.status <> 'requested'
  and a.valid_from < b.valid_to and b.valid_from < a.valid_to
  and ((r.scope = 'area' and a.area_id = b.area_id) or (r.scope = 'asset' and a.asset_id is not null and a.asset_id = b.asset_id))
  and (r.kind_a <> r.kind_b or a.code < b.code);

-- Hours each asset spent isolated in the last 90 days: the maintenance load, from the permit records.
create or replace view ptw.asset_isolation_history as
select a.code asset, a.name, ar.code area,
  count(i.id)::int isolations,
  coalesce(round(sum(extract(epoch from (coalesce(i.removed_at, ptw.site_now()) - greatest(i.applied_at, ptw.site_now() - interval '90 days'))) / 3600.0)
    filter (where i.id is not null), 1), 0) hours_isolated,
  (select count(*) from ptw.permits p where p.asset_id = a.id and p.valid_from >= ptw.site_now() - interval '90 days')::int permits,
  max(i.applied_at) last_isolated_at
from ptw.assets a
join ptw.areas ar on ar.id = a.area_id
left join ptw.isolations i on i.asset_id = a.id and coalesce(i.removed_at, ptw.site_now()) >= ptw.site_now() - interval '90 days'
group by a.id, a.code, a.name, ar.code;

-- Every rule check in one place. Each rule and its source is in docs/compliance.md.
create or replace view ptw.compliance_findings as
-- A permit still open past its validity.
select 'permit-expired' rule, 'breach' severity, 'permit ' || b.code ref, b.task subject,
  'Expired ' || -b.minutes_left || ' minutes ago and still ' || b.status || '. Close it, or suspend the work and issue a new permit.' detail
from ptw.permit_board b where b.status = 'issued' and b.minutes_left < 0
union all
-- A permit issued for longer than its kind allows.
select 'permit-too-long', 'warning', 'permit ' || p.code, p.task,
  'Valid for ' || round(extract(epoch from (p.valid_to - p.valid_from)) / 3600.0, 1) || ' hours; ' || k.name || ' permits run at most ' || k.max_hours || '.'
from ptw.permits p join ptw.permit_kinds k on k.code = p.kind
where ptw.is_open(p.status) and p.valid_to - p.valid_from > make_interval(hours => k.max_hours)
union all
-- Work under a permit that needs isolation, without a verified isolation.
select 'isolation-not-verified', 'breach', 'permit ' || b.code, b.task,
  case when not exists (select 1 from ptw.permit_isolations pi where pi.permit_id = b.id)
    then 'Needs an isolation and none is linked.'
    else 'The linked isolation is applied but nobody has proved zero energy (try the start, test for dead).' end
from ptw.permit_board b where b.status = 'issued' and b.isolation_needed and not b.isolation_verified
union all
-- An isolation that does not cover every point on the asset.
select 'isolation-incomplete', 'breach', 'isolation ' || s.code, s.asset || ' ' || s.asset_name,
  s.points || ' of ' || s.asset_points || ' isolation points locked: ' ||
  (select string_agg(pt.code || ' (' || pt.energy || ')', ', ' order by pt.code) from ptw.isolation_points pt
    join ptw.isolations i on i.asset_id = pt.asset_id where i.id = s.id
    and not exists (select 1 from ptw.isolation_lines l where l.isolation_id = s.id and l.point_id = pt.id)) || ' still live.'
from ptw.isolation_state s where s.status <> 'removed' and s.points < s.asset_points
union all
-- A personal lock left on by someone with no open permit on that isolation.
select 'lock-left-on', 'breach', 'isolation ' || l.isolation, l.person,
  'Personal lock ' || l.lock_no || ' on for ' || l.hours_on || ' hours; ' || l.person || ' is not signed on to an open permit for ' || l.asset || '.'
from ptw.locks_on l where l.flag <> ''
union all
-- An isolation still in place with no open permit relying on it.
select 'isolation-orphaned', 'warning', 'isolation ' || s.code, s.asset || ' ' || s.asset_name,
  'Applied ' || s.hours_isolated || ' hours and no open permit relies on it. Remove it or link the next permit.'
from ptw.isolation_state s where s.status <> 'removed' and s.open_permit_count = 0
union all
-- Gas tests: none, stale, or out of limits.
select case when b.gas_minutes_ago is null then 'gas-test-missing' when b.gas_failures <> '' then 'gas-test-failed' else 'gas-test-stale' end,
  'breach', 'permit ' || b.code, b.task,
  case when b.gas_minutes_ago is null then 'No gas test recorded.'
       when b.gas_failures <> '' then 'Last test ' || b.gas_minutes_ago || ' minutes ago failed: ' || b.gas_failures || '.'
       else 'Last test ' || b.gas_minutes_ago || ' minutes ago; retest every ' || (select gas_retest_minutes from ptw.settings) || '.' end
from ptw.permit_board b join ptw.permit_kinds k on k.code = b.kind and k.needs_gas_test
where b.status = 'issued' and (b.gas_minutes_ago is null or b.gas_failures <> '' or b.gas_minutes_ago > (select gas_retest_minutes from ptw.settings))
union all
-- Confined space without a standby or rescue plan.
select 'standby-missing', 'breach', 'permit ' || p.code, p.task,
  concat_ws(' and ', case when p.standby_id is null then 'no standby person' end, case when coalesce(p.rescue_plan, '') = '' then 'no rescue plan' end) || '.'
from ptw.permits p join ptw.permit_kinds k on k.code = p.kind and k.needs_standby
where p.status = 'issued' and (p.standby_id is null or coalesce(p.rescue_plan, '') = '')
union all
-- Someone still inside on a permit that is not issued.
select 'entry-not-permitted', 'breach', 'permit ' || i.permit, i.person,
  i.person || ' recorded inside ' || coalesce(i.asset, '') || ' for ' || i.minutes_in || ' minutes on a ' || i.permit_status || ' permit.'
from ptw.inside_now i where i.permit_status <> 'issued'
union all
-- People on open permits without the ticket their role needs.
select 'ticket-' || r.state, 'breach', 'permit ' || r.permit, r.person,
  r.person || ' (' || r.company || ') is ' || r.role || ' and has ' ||
  case when r.state = 'missing' then 'no ' || r.ticket || ' on record.' else r.ticket || ' that expired ' || r.expires_on || '.' end
from ptw.role_needs r where r.state <> 'ok'
union all
-- Contractors on open permits: induction and insurance.
select 'contractor-induction', 'breach', 'permit ' || p.code, pe.name,
  pe.name || ' (' || c.name || ') ' || case when pe.inducted_on is null then 'has no site induction.' else 'induction expired ' || pe.induction_expires_on || '.' end
from ptw.permits p
join lateral (select p.receiver_id person_id union select pc.person_id from ptw.permit_crew pc where pc.permit_id = p.id and pc.off_at is null) w on true
join ptw.people pe on pe.id = w.person_id
join ptw.companies c on c.id = pe.company_id and c.kind = 'contractor'
where ptw.is_open(p.status) and (pe.inducted_on is null or pe.induction_expires_on < ptw.site_now()::date)
union all
select 'contractor-insurance', 'breach', 'company ' || c.code, c.name,
  c.name || ' has work on ' || string_agg(distinct p.code, ', ') || ' and ' ||
  case when c.insurance_expires_on is null then 'no insurance certificate on file.' else 'its insurance certificate expired ' || max(c.insurance_expires_on) || '.' end
from ptw.companies c
join ptw.people pe on pe.company_id = c.id
join ptw.permits p on ptw.is_open(p.status) and (p.receiver_id = pe.id or exists (select 1 from ptw.permit_crew pc where pc.permit_id = p.id and pc.person_id = pe.id and pc.off_at is null))
where c.kind = 'contractor' and (c.insurance_expires_on is null or c.insurance_expires_on < ptw.site_now()::date)
group by c.id, c.code, c.name, c.insurance_expires_on
union all
-- Clashing permits.
select 'permit-conflict', 'breach', 'permit ' || x.permit_a || ' / ' || x.permit_b, coalesce(x.asset, x.area),
  (select name from ptw.permit_kinds where code = x.kind_a) || ' and ' || lower((select name from ptw.permit_kinds where code = x.kind_b)) || ' in ' || x.area || coalesce(' on ' || x.asset, '') || ' at the same time: ' || x.reason || '.'
from ptw.conflicts x
union all
-- Hot work closed before the fire watch ran its time.
select 'fire-watch-short', 'breach', 'permit ' || p.code, p.task,
  case when p.fire_watch_end_at is null then 'Closed with no fire watch recorded.'
    else 'Fire watch kept ' || (extract(epoch from (p.fire_watch_end_at - p.work_ended_at)) / 60)::int || ' minutes after the work stopped; the site rule is ' ||
      (select fire_watch_minutes from ptw.settings) || '.' end
from ptw.permits p join ptw.permit_kinds k on k.code = p.kind and k.needs_fire_watch
where p.status = 'closed' and p.closed_at >= ptw.site_now() - interval '30 days'
  and (p.fire_watch_end_at is null or p.work_ended_at is null
       or p.fire_watch_end_at < p.work_ended_at + make_interval(mins => (select fire_watch_minutes from ptw.settings)))
union all
-- Long jobs with no shift handover.
select 'handover-missing', 'warning', 'permit ' || b.code, b.task,
  'No handover for ' || round(extract(epoch from (ptw.site_now() - b.last_handover_at)) / 3600.0, 1) || ' hours; the shift is ' ||
  (select shift_hours from ptw.settings) || '.'
from ptw.permit_board b
where b.status in ('issued', 'suspended') and b.last_handover_at < ptw.site_now() - make_interval(hours => (select shift_hours from ptw.settings));
