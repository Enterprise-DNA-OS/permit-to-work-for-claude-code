-- Demo data: Harbourside Milling, a fictional flour and stockfeed mill at Mount Maunganui.
-- Every time is relative to now, so the board always has something to say.
-- Deliberate problems: a confined space entry with a stale gas test, done by someone whose gas testing
-- ticket has lapsed, an entrant with a lapsed entry ticket still inside, and an isolation that misses
-- the aeration fan; hot work on the silo top while that entry is open; a welder whose induction has
-- lapsed and whose company's insurance has expired; a bucket elevator job running 20 hours on an
-- isolation nobody tested for dead and with no handover; an electrical permit an hour past its time;
-- a personal lock left on after the roller mill job closed; hot work closed after a 20-minute fire watch.
-- Safe to run twice: rows with codes skip on conflict, and the event history loads once.

update ptw.settings set business_name = 'Harbourside Milling', jurisdiction = 'NZ', timezone = 'Pacific/Auckland'
where id = 1 and business_name = 'Your Site';

create or replace function pg_temp.at(h numeric) returns timestamp language sql stable as $$
  select (ptw.site_now() + make_interval(secs => h * 3600))::timestamp(0) $$;
create or replace function pg_temp.d(n int) returns date language sql stable as $$ select ptw.site_now()::date + n $$;
create or replace function pg_temp.person(c text) returns uuid language sql stable as $$ select id from ptw.people where code = c $$;
create or replace function pg_temp.permit(c text) returns uuid language sql stable as $$ select id from ptw.permits where code = c $$;
create or replace function pg_temp.iso(c text) returns uuid language sql stable as $$ select id from ptw.isolations where code = c $$;
create or replace function pg_temp.point(c text) returns uuid language sql stable as $$ select id from ptw.isolation_points where code = c $$;
create or replace function pg_temp.asset(c text) returns uuid language sql stable as $$ select id from ptw.assets where code = c $$;
create or replace function pg_temp.area(c text) returns uuid language sql stable as $$ select id from ptw.areas where code = c $$;

insert into ptw.areas (code, name, hazards) values
  ('SILO', 'Silo tower', 'Grain dust, confined spaces, work at height, bucket elevators'),
  ('MILL', 'Mill floor', 'Flour dust (combustible), rotating plant, dust collection'),
  ('PACK', 'Packing hall', 'Bagging lines, forklifts, pallet wrapping'),
  ('BOIL', 'Boiler house', 'Steam, hot surfaces, gas burner'),
  ('YARD', 'Yard and intake', 'Trucks, intake pit, weighbridge')
on conflict (code) do nothing;

insert into ptw.assets (code, name, area_id, kind, confined_space) values
  ('SIL3', 'Wheat silo 3', pg_temp.area('SILO'), 'silo', true),
  ('BE2', 'Bucket elevator 2', pg_temp.area('SILO'), 'elevator', false),
  ('GAN1', 'Silo top gantry conveyor', pg_temp.area('SILO'), 'conveyor', false),
  ('RM1', 'Roller mill 1', pg_temp.area('MILL'), 'mill', false),
  ('DC1', 'Dust collector 1', pg_temp.area('MILL'), 'dust collector', false),
  ('PK1', 'Bagging line 1', pg_temp.area('PACK'), 'packing line', false),
  ('BLR1', 'Steam boiler 1', pg_temp.area('BOIL'), 'boiler', true),
  ('INT1', 'Truck intake pit', pg_temp.area('YARD'), 'pit', true)
on conflict (code) do nothing;

insert into ptw.isolation_points (code, asset_id, energy, device, method, verify) values
  ('SIL3-E1', pg_temp.asset('SIL3'), 'electrical', 'MCC-1 bucket 7, discharge auger', 'Open and lock the isolator', 'Press start at the local station; nothing turns'),
  ('SIL3-E2', pg_temp.asset('SIL3'), 'electrical', 'MCC-1 bucket 9, aeration fan', 'Open and lock the isolator', 'Press start at the local station; nothing turns'),
  ('SIL3-P1', pg_temp.asset('SIL3'), 'product', 'Slide gate SG-3 at the fill head', 'Close the gate and pin it, lock the air supply', 'Check the pin is through and the gate cannot move'),
  ('BE2-E1', pg_temp.asset('BE2'), 'electrical', 'MCC-1 bucket 3, elevator drive', 'Open and lock the isolator', 'Press start at the head; nothing turns'),
  ('BE2-G1', pg_temp.asset('BE2'), 'gravity', 'Head pulley', 'Fit the run-back pin through the head pulley', 'Try to turn the leg by hand; it holds'),
  ('GAN1-E1', pg_temp.asset('GAN1'), 'electrical', 'MCC-1 bucket 11, gantry conveyor', 'Open and lock the isolator', 'Press start at the local station; nothing turns'),
  ('RM1-E1', pg_temp.asset('RM1'), 'electrical', 'MCC-2 bucket 4, roller mill drive', 'Open and lock the isolator', 'Press start at the mill; nothing turns'),
  ('RM1-P1', pg_temp.asset('RM1'), 'pneumatic', 'Air valve AV-21, roll engage', 'Close and lock the valve, bleed the line', 'Gauge reads zero, rolls cannot engage'),
  ('DC1-E1', pg_temp.asset('DC1'), 'electrical', 'MCC-2 bucket 9, fan and rotary valve', 'Open and lock the isolator', 'Press start; nothing turns'),
  ('PK1-E1', pg_temp.asset('PK1'), 'electrical', 'DB-P1 circuit 12', 'Open and lock the breaker', 'Test for dead at the sensor terminals'),
  ('PK1-P1', pg_temp.asset('PK1'), 'pneumatic', 'Air valve AV-40, bag clamp', 'Close and lock the valve, bleed the line', 'Gauge reads zero, clamp cannot close'),
  ('BLR1-S1', pg_temp.asset('BLR1'), 'steam', 'Main steam stop valve SV-1', 'Close and chain the valve', 'Drain open, no steam at the drain'),
  ('BLR1-E1', pg_temp.asset('BLR1'), 'electrical', 'Burner control panel isolator', 'Open and lock the isolator', 'Burner will not start'),
  ('INT1-E1', pg_temp.asset('INT1'), 'electrical', 'MCC-1 bucket 1, intake conveyor', 'Open and lock the isolator', 'Press start; nothing turns')
on conflict (code) do nothing;

insert into ptw.companies (code, name, kind, contact, email, phone, insurance_expires_on, prequalified_on) values
  ('HM', 'Harbourside Milling', 'own', 'Ana Rewiti', 'maintenance@harbourside-milling.example', '07 575 0100', null, null),
  ('BSF', 'Bay Steel Fabrication', 'contractor', 'Jake Morrison', 'jake@baysteel.example', '021 455 102', pg_temp.d(-10), pg_temp.d(-300)),
  ('MEC', 'Mount Electrical Contractors', 'contractor', 'Kiri Ngata', 'kiri@mountelectrical.example', '027 300 811', pg_temp.d(200), pg_temp.d(-150)),
  ('TCS', 'Tauranga Confined Space Services', 'contractor', 'Hemi Tane', 'hemi@tcs.example', '022 610 445', pg_temp.d(20), pg_temp.d(-90))
on conflict (code) do nothing;

insert into ptw.people (code, name, company_id, role, phone, inducted_on, induction_expires_on) values
  ('ANA', 'Ana Rewiti', (select id from ptw.companies where code = 'HM'), 'Maintenance supervisor', '021 700 101', pg_temp.d(-700), pg_temp.d(30)),
  ('DAV', 'Dave Kingi', (select id from ptw.companies where code = 'HM'), 'Shift coordinator', '021 700 102', pg_temp.d(-500), pg_temp.d(200)),
  ('SIO', 'Sione Fifita', (select id from ptw.companies where code = 'HM'), 'Fitter', '021 700 103', pg_temp.d(-400), pg_temp.d(300)),
  ('MEG', 'Megan Hall', (select id from ptw.companies where code = 'HM'), 'Mill operator', '021 700 104', pg_temp.d(-300), pg_temp.d(400)),
  ('RAJ', 'Raj Patel', (select id from ptw.companies where code = 'HM'), 'Site electrician', '021 700 105', pg_temp.d(-600), pg_temp.d(100)),
  ('TOM', 'Tom Baker', (select id from ptw.companies where code = 'HM'), 'Leading hand', '021 700 106', pg_temp.d(-200), pg_temp.d(500)),
  ('JAK', 'Jake Morrison', (select id from ptw.companies where code = 'BSF'), 'Welder fabricator', '021 455 102', pg_temp.d(-200), pg_temp.d(160)),
  ('LIA', 'Liam Ward', (select id from ptw.companies where code = 'BSF'), 'Welder', '021 455 109', pg_temp.d(-368), pg_temp.d(-3)),
  ('KIR', 'Kiri Ngata', (select id from ptw.companies where code = 'MEC'), 'Electrician', '027 300 811', pg_temp.d(-100), pg_temp.d(260)),
  ('PAU', 'Paul Anders', (select id from ptw.companies where code = 'TCS'), 'Confined space technician', '022 610 447', pg_temp.d(-60), pg_temp.d(300)),
  ('HEM', 'Hemi Tane', (select id from ptw.companies where code = 'TCS'), 'Confined space supervisor', '022 610 445', pg_temp.d(-345), pg_temp.d(20))
on conflict (code) do nothing;

insert into ptw.tickets (person_id, kind, ref, issued_on, expires_on)
select pg_temp.person(p), k, r, pg_temp.d(i), pg_temp.d(e) from (values
  ('ANA', 'ISSUER', 'HM-AUTH-01', -300, 430), ('ANA', 'RECEIVER', 'HM-AUTH-01', -300, 430), ('ANA', 'ISOLATOR', 'HM-ISO-01', -300, 430), ('ANA', 'GAS_TEST', 'GT-2291', -200, 530),
  ('DAV', 'ISSUER', 'HM-AUTH-02', -500, 230), ('DAV', 'GAS_TEST', 'GT-1876', -735, -5),
  ('SIO', 'RECEIVER', 'HM-AUTH-03', -100, 630), ('SIO', 'ISOLATOR', 'HM-ISO-03', -100, 630), ('SIO', 'CS_ENTRY', 'CS-4410', -150, 580), ('SIO', 'HEIGHTS', 'WH-7781', -150, 580),
  ('MEG', 'CS_STANDBY', 'CS-3902', -718, 12), ('MEG', 'CS_ENTRY', 'CS-3902', -718, 12),
  ('RAJ', 'ELECTRICAL', 'EW 123456', -300, 430), ('RAJ', 'ISOLATOR', 'HM-ISO-02', -300, 430), ('RAJ', 'RECEIVER', 'HM-AUTH-04', -300, 430),
  ('TOM', 'RECEIVER', 'HM-AUTH-05', -60, 670), ('TOM', 'HEIGHTS', 'WH-8120', -60, 670),
  ('JAK', 'HOT_WORK', 'HW-5521', -200, 530), ('JAK', 'RECEIVER', 'HM-CON-11', -200, 530),
  ('LIA', 'HOT_WORK', 'HW-5530', -190, 540),
  ('KIR', 'ELECTRICAL', 'EW 987654', -705, 25), ('KIR', 'ISOLATOR', 'HM-CON-12', -100, 630), ('KIR', 'RECEIVER', 'HM-CON-12', -100, 630),
  ('PAU', 'CS_ENTRY', 'CS-2117', -738, -8),
  ('HEM', 'CS_ENTRY', 'CS-2101', -100, 630), ('HEM', 'CS_STANDBY', 'CS-2101', -100, 630), ('HEM', 'GAS_TEST', 'GT-3001', -100, 630)
) v(p, k, r, i, e)
on conflict (person_id, kind) do nothing;

-- Permits. History first (closed), then today's board.
insert into ptw.permits (code, kind, area_id, asset_id, task, risk_ref, status, requested_by, issuer_id, receiver_id, standby_id, rescue_plan,
  isolation_required, valid_from, valid_to, issued_at, work_ended_at, fire_watch_by, fire_watch_end_at, closed_at, closed_by, handback, cancelled_reason)
select code, kind, pg_temp.area(area), pg_temp.asset(asset), task, risk, status, pg_temp.person(req), pg_temp.person(iss), pg_temp.person(rec), pg_temp.person(sb), rescue,
  iso_req, pg_temp.at(vf), pg_temp.at(vt), case when issued is null then null else pg_temp.at(issued) end,
  case when ended is null then null else pg_temp.at(ended) end, pg_temp.person(fw), case when fwe is null then null else pg_temp.at(fwe) end,
  case when closed is null then null else pg_temp.at(closed) end, pg_temp.person(cb), handback, cancelled
from (values
  ('P-2031', 'general', 'SILO', 'BE2', 'Replace elevator boot bearings', 'JSA-BE-04', 'closed', 'ANA', 'ANA', 'SIO', null, null, true,
     -1440.0, -1430.0, -1440.0, null, null, null, -1431.0, 'SIO', 'Guards back on, test run done, area clean', null),
  ('P-2032', 'general', 'MILL', 'RM1', 'Re-corrugate and reset rolls on roller mill 1', 'JSA-RM-02', 'closed', 'ANA', 'DAV', 'SIO', null, null, true,
     -1080.0, -1072.0, -1080.0, null, null, null, -1072.5, 'SIO', 'Rolls set, guards on, mill handed back to milling', null),
  ('P-2033', 'general', 'SILO', 'BE2', 'Replace belt on bucket elevator 2', 'JSA-BE-05', 'closed', 'ANA', 'ANA', 'TOM', null, null, true,
     -720.0, -696.0, -720.0, null, null, null, -690.0, 'TOM', 'Belt tracked, test run 30 minutes', null),
  ('P-2034', 'confined_space', 'SILO', 'SIL3', 'Inspect silo 3 cone and level probe', 'JSA-SI-01', 'closed', 'ANA', 'ANA', 'HEM', 'MEG', 'Tripod and winch at the top hatch; TCS rescue team on call; 111 then site first aid', true,
     -336.0, -326.0, -336.0, null, null, null, -326.0, 'HEM', 'Hatch closed, probe working, all out and counted', null),
  ('P-2035', 'general', 'SILO', 'BE2', 'Replace head pulley lagging', 'JSA-BE-06', 'closed', 'ANA', 'DAV', 'SIO', null, null, true,
     -168.0, -162.0, -168.0, null, null, null, -162.0, 'SIO', 'Guards on, test run done', null),
  ('P-2036', 'hot_work', 'MILL', 'RM1', 'Weld new feed hopper bracket', 'JSA-HW-02', 'closed', 'ANA', 'ANA', 'JAK', null, null, false,
     -200.0, -194.0, -200.0, -196.0, 'TOM', -195.0, -194.5, 'JAK', 'Hot work area checked after an hour, extinguishers back', null),
  ('P-2037', 'lifting', 'YARD', null, 'Lift new filter housing onto the mill roof', 'JSA-LF-01', 'cancelled', 'ANA', null, 'TOM', null, null, false,
     -72.0, -64.0, null, null, null, null, null, null, null, 'Crane booked for the wrong day; rebooked'),
  ('P-2038', 'hot_work', 'MILL', 'DC1', 'Weld new bracket on the dust collector inlet', 'JSA-HW-03', 'closed', 'ANA', 'ANA', 'JAK', null, null, false,
     -30.0, -24.0, -30.0, -26.0, 'LIA', -25.66, -25.6, 'JAK', 'Done, area swept', null),
  ('P-2039', 'general', 'MILL', 'RM1', 'Replace roll bearings on roller mill 1', 'JSA-RM-03', 'closed', 'ANA', 'DAV', 'SIO', null, null, true,
     -32.0, -6.0, -32.0, null, null, null, -6.0, 'SIO', 'Bearings in, mill turned by hand. Run-up test tomorrow', null),
  ('P-2041', 'confined_space', 'SILO', 'SIL3', 'Clear caked wheat from the silo 3 cone', 'JSA-SI-02', 'issued', 'ANA', 'DAV', 'SIO', 'MEG', 'Tripod and winch at the bottom hatch; TCS rescue team on site; 111 then site first aid', true,
     -4.0, 6.0, -4.0, null, null, null, null, null, null, null),
  ('P-2042', 'hot_work', 'SILO', 'GAN1', 'Weld split in the silo top gantry conveyor chute', 'JSA-HW-04', 'issued', 'JAK', 'ANA', 'JAK', null, null, false,
     -1.0, 5.0, -1.0, null, null, null, null, null, null, null),
  ('P-2044', 'general', 'SILO', 'BE2', 'Replace worn buckets and splice the belt on bucket elevator 2', 'JSA-BE-07', 'issued', 'ANA', 'ANA', 'TOM', null, null, true,
     -20.0, 4.0, -20.0, null, null, null, null, null, null, null),
  ('P-2045', 'electrical', 'PACK', 'PK1', 'Replace the infeed photo-eye and rewire the sensor', 'JSA-EL-09', 'issued', 'RAJ', 'DAV', 'KIR', null, null, true,
     -6.0, -1.0, -6.0, null, null, null, null, null, null, null),
  ('P-2046', 'confined_space', 'BOIL', 'BLR1', 'Drain boiler 1 and open the manhole for the annual inspection', 'JSA-BL-01', 'requested', 'ANA', null, 'RAJ', null, null, true,
     17.0, 27.0, null, null, null, null, null, null, null, null),
  ('P-2047', 'height', 'MILL', 'DC1', 'Replace filter bags from the dust collector roof', 'JSA-WH-03', 'requested', 'TOM', null, 'TOM', null, null, true,
     18.0, 26.0, null, null, null, null, null, null, null, null)
) v(code, kind, area, asset, task, risk, status, req, iss, rec, sb, rescue, iso_req, vf, vt, issued, ended, fw, fwe, closed, cb, handback, cancelled)
on conflict (code) do nothing;

insert into ptw.isolations (code, asset_id, isolator_id, reason, lockbox, status, applied_at, verified_at, verified_by, verify_note, removed_at, removed_by)
select code, pg_temp.asset(asset), pg_temp.person(isolator), reason, box, status, pg_temp.at(ap),
  case when vf is null then null else pg_temp.at(vf) end, pg_temp.person(vb), note,
  case when rm is null then null else pg_temp.at(rm) end, pg_temp.person(rb)
from (values
  ('ISO-301', 'BE2', 'SIO', 'Boot bearings', 'LB-1', 'removed', -1440.5, -1440.3, 'SIO', 'Start pressed at head, nothing', -1430.5, 'SIO'),
  ('ISO-302', 'RM1', 'SIO', 'Re-corrugate rolls', 'LB-2', 'removed', -1080.5, -1080.3, 'SIO', 'Start pressed, gauge zero', -1072.0, 'SIO'),
  ('ISO-303', 'BE2', 'RAJ', 'Belt change', 'LB-1', 'removed', -720.5, -720.3, 'RAJ', 'Start pressed at head, nothing', -690.5, 'RAJ'),
  ('ISO-304', 'SIL3', 'ANA', 'Cone inspection', 'LB-3', 'removed', -336.5, -336.3, 'ANA', 'Start pressed at auger and fan, gate pinned', -325.5, 'ANA'),
  ('ISO-306', 'BE2', 'SIO', 'Head pulley lagging', 'LB-1', 'removed', -168.5, -168.3, 'SIO', 'Start pressed at head, nothing', -161.5, 'SIO'),
  ('ISO-305', 'RM1', 'SIO', 'Roll bearings', 'LB-2', 'verified', -32.5, -32.3, 'SIO', 'Start pressed, gauge zero', null, null),
  ('ISO-310', 'BE2', 'RAJ', 'Buckets and belt splice', 'LB-1', 'applied', -20.5, null, null, null, null, null),
  ('ISO-311', 'SIL3', 'SIO', 'Cone clean out', 'LB-3', 'verified', -4.5, -4.2, 'SIO', 'Start pressed at the auger, gate pinned', null, null),
  ('ISO-312', 'PK1', 'KIR', 'Photo-eye and sensor wiring', 'LB-4', 'verified', -6.3, -6.1, 'KIR', 'Tested dead at the sensor terminals, gauge zero', null, null)
) v(code, asset, isolator, reason, box, status, ap, vf, vb, note, rm, rb)
on conflict (code) do nothing;

insert into ptw.isolation_lines (isolation_id, point_id, lock_no)
select pg_temp.iso(i), pg_temp.point(p), l from (values
  ('ISO-301', 'BE2-E1', 'L-01'), ('ISO-301', 'BE2-G1', 'L-02'),
  ('ISO-302', 'RM1-E1', 'L-05'), ('ISO-302', 'RM1-P1', 'L-06'),
  ('ISO-303', 'BE2-E1', 'L-01'), ('ISO-303', 'BE2-G1', 'L-02'),
  ('ISO-304', 'SIL3-E1', 'L-09'), ('ISO-304', 'SIL3-E2', 'L-10'), ('ISO-304', 'SIL3-P1', 'L-11'),
  ('ISO-306', 'BE2-E1', 'L-01'), ('ISO-306', 'BE2-G1', 'L-02'),
  ('ISO-305', 'RM1-E1', 'L-05'), ('ISO-305', 'RM1-P1', 'L-06'),
  ('ISO-310', 'BE2-E1', 'L-01'), ('ISO-310', 'BE2-G1', 'L-02'),
  ('ISO-311', 'SIL3-E1', 'L-09'), ('ISO-311', 'SIL3-P1', 'L-11'),
  ('ISO-312', 'PK1-E1', 'L-14'), ('ISO-312', 'PK1-P1', 'L-15')
) v(i, p, l)
on conflict (isolation_id, point_id) do nothing;

insert into ptw.permit_isolations (permit_id, isolation_id)
select pg_temp.permit(p), pg_temp.iso(i) from (values
  ('P-2031', 'ISO-301'), ('P-2032', 'ISO-302'), ('P-2033', 'ISO-303'), ('P-2034', 'ISO-304'), ('P-2035', 'ISO-306'),
  ('P-2039', 'ISO-305'), ('P-2044', 'ISO-310'), ('P-2041', 'ISO-311'), ('P-2045', 'ISO-312')
) v(p, i)
on conflict do nothing;

insert into ptw.permit_crew (permit_id, person_id, on_at, off_at)
select pg_temp.permit(p), pg_temp.person(w), pg_temp.at(onh), case when offh is null then null else pg_temp.at(offh) end from (values
  ('P-2031', 'SIO', -1440.0, -1431.0), ('P-2032', 'SIO', -1080.0, -1072.5), ('P-2033', 'TOM', -720.0, -690.0), ('P-2033', 'SIO', -720.0, -690.0),
  ('P-2034', 'HEM', -336.0, -326.0), ('P-2034', 'PAU', -336.0, -326.0), ('P-2035', 'SIO', -168.0, -162.0),
  ('P-2036', 'JAK', -200.0, -194.5), ('P-2038', 'JAK', -30.0, -25.6), ('P-2038', 'LIA', -30.0, -25.6),
  ('P-2039', 'SIO', -32.0, -6.0),
  ('P-2041', 'SIO', -4.0, null), ('P-2041', 'PAU', -4.0, null), ('P-2041', 'HEM', -4.0, null),
  ('P-2042', 'JAK', -1.0, null), ('P-2042', 'LIA', -1.0, null),
  ('P-2044', 'TOM', -20.0, null),
  ('P-2045', 'KIR', -6.0, null)
) v(p, w, onh, offh)
on conflict (permit_id, person_id) do nothing;

-- The event history (locks, gas tests, entries, handovers, notes) loads once.
do $$
begin
  if exists (select 1 from ptw.gas_tests) then return; end if;

  insert into ptw.personal_locks (isolation_id, person_id, lock_no, on_at, off_at)
  select pg_temp.iso(i), pg_temp.person(w), l, pg_temp.at(onh), case when offh is null then null else pg_temp.at(offh) end from (values
    ('ISO-301', 'SIO', 'P-SF', -1440.2, -1431.0), ('ISO-302', 'SIO', 'P-SF', -1080.2, -1072.5), ('ISO-303', 'TOM', 'P-TB', -720.2, -690.0),
    ('ISO-304', 'HEM', 'P-HT', -336.2, -326.0), ('ISO-304', 'PAU', 'P-PA', -336.2, -326.0), ('ISO-306', 'SIO', 'P-SF', -168.2, -162.0),
    ('ISO-305', 'SIO', 'P-SF', -32.2, null),
    ('ISO-311', 'SIO', 'P-SF', -4.0, null), ('ISO-311', 'PAU', 'P-PA', -4.0, null), ('ISO-311', 'HEM', 'P-HT', -4.0, null),
    ('ISO-310', 'TOM', 'P-TB', -20.0, null),
    ('ISO-312', 'KIR', 'P-KN', -6.0, null)
  ) v(i, w, l, onh, offh);

  insert into ptw.gas_tests (permit_id, tested_at, tester_id, location, o2_pct, lel_pct, h2s_ppm, co_ppm, instrument, bump_tested)
  select pg_temp.permit(p), pg_temp.at(h), pg_temp.person(t), loc, o2, lel, h2s, co, 'Four-gas monitor GM-2', true from (values
    ('P-2034', -336.2, 'HEM', 'Silo 3 bottom hatch', 19.0, 0.0, 0.0, 3.0),
    ('P-2034', -336.0, 'HEM', 'Silo 3 bottom hatch, after 20 minutes of forced air', 20.8, 0.0, 0.0, 1.0),
    ('P-2034', -334.0, 'HEM', 'Silo 3 cone', 20.9, 0.0, 0.0, 1.0),
    ('P-2036', -200.0, 'ANA', 'Mill floor, hopper', 20.9, 0.0, 0.0, 0.0),
    ('P-2038', -30.0, 'ANA', 'Dust collector inlet', 20.9, 0.0, 0.0, 0.0),
    ('P-2041', -3.85, 'DAV', 'Silo 3 bottom hatch', 20.9, 0.0, 0.0, 2.0),
    ('P-2041', -2.7, 'DAV', 'Silo 3 cone', 20.7, 1.0, 0.0, 4.0),
    ('P-2042', -0.85, 'ANA', 'Gantry chute, silo top', 20.9, 0.0, 0.0, 0.0)
  ) v(p, h, t, loc, o2, lel, h2s, co);

  insert into ptw.entries (permit_id, person_id, in_at, out_at)
  select pg_temp.permit(p), pg_temp.person(w), pg_temp.at(i), case when o is null then null else pg_temp.at(o) end from (values
    ('P-2034', 'HEM', -334.0, -333.0), ('P-2034', 'PAU', -334.0, -332.5),
    ('P-2041', 'HEM', -3.5, -2.0), ('P-2041', 'SIO', -2.5, -1.5), ('P-2041', 'PAU', -0.6, null)
  ) v(p, w, i, o);

  insert into ptw.handovers (permit_id, at, from_id, to_id, note)
  select pg_temp.permit('P-2033'), pg_temp.at(-708), pg_temp.person('ANA'), pg_temp.person('DAV'), 'Old belt off, new belt on the floor ready to lift. Isolation and locks unchanged.';

  insert into ptw.notes (subject_type, subject_id, author, body)
  select 'permit', pg_temp.permit('P-2041'), 'Dave Kingi', 'Cone bridged about two metres up. Working from the bottom hatch only, no one above the bridge.'
  union all
  select 'company', (select id from ptw.companies where code = 'BSF'), 'Ana Rewiti', 'Asked Jake for the renewed insurance certificate. Says the broker is sending it.';
end $$;
