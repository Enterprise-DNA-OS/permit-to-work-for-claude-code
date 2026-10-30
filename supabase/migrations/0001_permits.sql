-- Permit to Work for Claude Code: the records a site runs its permits and isolations on.
-- Permits by kind (hot work, confined space, electrical, height, excavation, lifting, general),
-- the people on them and the tickets they hold, isolations with their points, lock numbers and
-- personal locks, gas tests, confined space entries, shift handovers and contractor companies.
-- Plain Postgres. Runs the same on PGlite (no extensions) and on any hosted Postgres.
-- Times are site wall-clock (timestamp without zone) in the timezone named in ptw.settings.

create schema if not exists ptw;

create or replace function ptw.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- One row: how this site runs permits. Change it with /customise or a direct update.
create table ptw.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Your Site',
  jurisdiction text not null default 'NZ' check (jurisdiction in ('NZ', 'AU')),
  timezone text not null default 'Pacific/Auckland',
  gas_retest_minutes int not null default 120,      -- a gas test older than this is stale for entry or hot work
  fire_watch_minutes int not null default 60,       -- hot work: fire watch kept this long after the work stops
  ticket_warn_days int not null default 30,         -- warn this many days before a ticket, induction or insurance lapses
  shift_hours int not null default 12,              -- an open permit with no handover for this long needs one
  ending_minutes int not null default 120,          -- permits ending within this many minutes show on the attention list
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into ptw.settings (id) values (1) on conflict do nothing;

-- Site wall-clock now, in the site's timezone.
create or replace function ptw.site_now() returns timestamp language sql stable as $$
  select (now() at time zone (select timezone from ptw.settings where id = 1))::timestamp(0)
$$;

create table ptw.areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  hazards text,                                     -- what lives here: dust, steam, traffic, a hazardous area zone
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.assets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  area_id uuid not null references ptw.areas(id),
  kind text,                                        -- conveyor, silo, boiler, mill, switchboard
  confined_space boolean not null default false,    -- entry needs a confined space permit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Where each energy source on an asset is isolated, and how to prove it is dead.
create table ptw.isolation_points (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  asset_id uuid not null references ptw.assets(id),
  energy text not null check (energy in ('electrical', 'mechanical', 'pneumatic', 'hydraulic', 'steam', 'chemical', 'gravity', 'thermal', 'product')),
  device text not null,                             -- MCC-2 bucket 14, steam valve SV-12
  method text not null,                             -- open and lock the breaker, close and chain the valve
  verify text not null,                             -- how to prove zero energy: try the start button, test for dead, bleed and read the gauge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'contractor' check (kind in ('own', 'contractor')),
  contact text,
  email text,
  phone text,
  insurance_expires_on date,                        -- public liability certificate on file
  prequalified_on date,                             -- health and safety prequalification accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.people (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  company_id uuid not null references ptw.companies(id),
  role text,
  phone text,
  email text,
  inducted_on date,                                 -- site induction
  induction_expires_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tickets, authorisations and licences. The operator owns this list; docs/compliance.md cites each source.
create table ptw.ticket_kinds (
  code text primary key,
  name text not null,
  renew_months int,                                 -- null: does not lapse
  source text not null
);

create table ptw.tickets (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references ptw.people(id),
  kind text not null references ptw.ticket_kinds(code),
  ref text,                                         -- certificate or licence number
  issued_on date,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, kind)
);

-- What each permit kind needs. The operator owns this table.
create table ptw.permit_kinds (
  code text primary key,
  name text not null,
  crew_ticket text references ptw.ticket_kinds(code),   -- every crew member signed on holds this
  needs_isolation boolean not null default false,       -- a verified isolation must be linked before work
  needs_gas_test boolean not null default false,        -- a gas test inside limits within gas_retest_minutes
  needs_standby boolean not null default false,         -- a standby person and a rescue plan
  needs_fire_watch boolean not null default false,      -- fire watch for fire_watch_minutes after the work stops
  max_hours int not null default 12                     -- longest validity one permit may carry
);

-- Permit pairs that must not run at the same time in the same area (or on the same asset).
create table ptw.conflict_rules (
  kind_a text not null references ptw.permit_kinds(code),
  kind_b text not null references ptw.permit_kinds(code),
  scope text not null check (scope in ('area', 'asset')),
  reason text not null,
  primary key (kind_a, kind_b, scope)
);

-- Gas test limits, owned by the operator. A reading outside min to max fails.
create table ptw.gas_limits (
  gas text primary key check (gas in ('o2', 'lel', 'h2s', 'co')),
  name text not null,
  unit text not null,
  min_value numeric,
  max_value numeric,
  source text not null
);

create table ptw.permits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null references ptw.permit_kinds(code),
  area_id uuid not null references ptw.areas(id),
  asset_id uuid references ptw.assets(id),
  task text not null,
  risk_ref text,                                    -- the job safety analysis, SWMS or task risk assessment
  status text not null default 'requested' check (status in ('requested', 'issued', 'suspended', 'closed', 'cancelled')),
  requested_by uuid references ptw.people(id),
  issuer_id uuid references ptw.people(id),         -- the permit issuer (area authority)
  receiver_id uuid references ptw.people(id),       -- the person in charge of the work
  standby_id uuid references ptw.people(id),        -- confined space standby
  rescue_plan text,
  isolation_required boolean not null default false,
  valid_from timestamp not null,
  valid_to timestamp not null,
  issued_at timestamp,
  work_ended_at timestamp,                          -- when the tools stopped (starts the fire watch)
  fire_watch_by uuid references ptw.people(id),
  fire_watch_end_at timestamp,
  suspended_reason text,
  closed_at timestamp,
  closed_by uuid references ptw.people(id),
  handback text,                                    -- the state the area was handed back in
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to > valid_from)
);

-- People working under a permit. Signing on means they read it and accept its controls.
create table ptw.permit_crew (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references ptw.permits(id) on delete cascade,
  person_id uuid not null references ptw.people(id),
  on_at timestamp not null,
  off_at timestamp,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (permit_id, person_id)
);

-- An isolation certificate: one asset made safe, by an authorised isolator.
create table ptw.isolations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  asset_id uuid not null references ptw.assets(id),
  isolator_id uuid not null references ptw.people(id),
  reason text,
  lockbox text,                                     -- the group lockbox the isolation keys go into
  status text not null default 'applied' check (status in ('applied', 'verified', 'removed')),
  applied_at timestamp not null,
  verified_at timestamp,
  verified_by uuid references ptw.people(id),
  verify_note text,                                 -- what was tried: start button, test for dead, gauge at zero
  removed_at timestamp,
  removed_by uuid references ptw.people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.isolation_lines (
  id uuid primary key default gen_random_uuid(),
  isolation_id uuid not null references ptw.isolations(id) on delete cascade,
  point_id uuid not null references ptw.isolation_points(id),
  lock_no text not null,                            -- the isolation lock on the point
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (isolation_id, point_id)
);

create table ptw.permit_isolations (
  permit_id uuid not null references ptw.permits(id) on delete cascade,
  isolation_id uuid not null references ptw.isolations(id),
  primary key (permit_id, isolation_id)
);

-- Each worker's own lock on the lockbox. Off only by its owner.
create table ptw.personal_locks (
  id uuid primary key default gen_random_uuid(),
  isolation_id uuid not null references ptw.isolations(id),
  person_id uuid not null references ptw.people(id),
  lock_no text not null,
  on_at timestamp not null,
  off_at timestamp,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.gas_tests (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references ptw.permits(id) on delete cascade,
  tested_at timestamp not null,
  tester_id uuid not null references ptw.people(id),
  location text,
  o2_pct numeric(4,1),
  lel_pct numeric(4,1),
  h2s_ppm numeric(6,1),
  co_ppm numeric(6,1),
  instrument text,
  bump_tested boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Confined space entry log: who went in and when they came out.
create table ptw.entries (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references ptw.permits(id) on delete cascade,
  person_id uuid not null references ptw.people(id),
  in_at timestamp not null,
  out_at timestamp,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.handovers (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references ptw.permits(id) on delete cascade,
  at timestamp not null,
  from_id uuid not null references ptw.people(id),
  to_id uuid not null references ptw.people(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ptw.notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('permit', 'isolation', 'person', 'company', 'asset')),
  subject_id uuid not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every imported row, by content hash, so a repeat import skips what it already brought in.
create table ptw.import_rows (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text not null,
  row_number int not null,
  row_hash text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, row_hash)
);

create index on ptw.permits (status);
create index on ptw.permits (area_id);
create index on ptw.permit_crew (person_id);
create index on ptw.personal_locks (isolation_id) where off_at is null;
create index on ptw.gas_tests (permit_id, tested_at);
create index on ptw.entries (permit_id) where out_at is null;
create index on ptw.tickets (person_id);

do $$
declare t text;
begin
  foreach t in array array['settings', 'areas', 'assets', 'isolation_points', 'companies', 'people', 'tickets', 'permits', 'permit_crew',
    'isolations', 'isolation_lines', 'personal_locks', 'gas_tests', 'entries', 'handovers', 'notes', 'import_rows'] loop
    execute format('create trigger touch before update on ptw.%I for each row execute function ptw.touch()', t);
  end loop;
end $$;

-- Reference rows the rules read. The operator can change them; docs/compliance.md says where each comes from.
insert into ptw.ticket_kinds (code, name, renew_months, source) values
  ('ISSUER', 'Permit issuer authorisation', 24, 'Site permit to work procedure: named people authorised to issue permits for an area'),
  ('RECEIVER', 'Permit receiver (person in charge of the work)', 24, 'Site permit to work procedure'),
  ('ISOLATOR', 'Authorised isolator', 24, 'Site isolation procedure; WorkSafe NZ Safe use of machinery; Safe Work Australia Code of Practice: Managing the risks of plant in the workplace'),
  ('CS_ENTRY', 'Confined space entry', 24, 'AS/NZS 2865:2009 Confined spaces (training of entrants); Safe Work Australia Code of Practice: Confined spaces'),
  ('CS_STANDBY', 'Confined space standby and rescue', 24, 'AS/NZS 2865:2009 Confined spaces (standby person); Safe Work Australia Code of Practice: Confined spaces'),
  ('GAS_TEST', 'Gas testing (atmospheric monitoring)', 24, 'AS/NZS 2865:2009 Confined spaces (atmospheric testing by a competent person)'),
  ('HOT_WORK', 'Hot work and fire watch', 24, 'AS 1674.1 Safety in welding and allied processes, fire precautions; site hot work procedure'),
  ('HEIGHTS', 'Working at height', 24, 'WorkSafe NZ Working at height guidance; Safe Work Australia Code of Practice: Managing the risk of falls at workplaces'),
  ('EWP', 'Elevating work platform operator', 60, 'WorkSafe NZ Elevating work platforms guidance; AU high risk work licence (WP) for booms of 11 metres or more'),
  ('ELECTRICAL', 'Electrical worker licence', 24, 'NZ: Electricity Act 1992 and the Electrical Workers Registration Board practising licence. AU: state electrical licence'),
  ('RIGGING', 'Dogging and rigging', 60, 'AU: high risk work licence (DG, RB). NZ: site lifting procedure and unit standards')
on conflict (code) do nothing;

insert into ptw.permit_kinds (code, name, crew_ticket, needs_isolation, needs_gas_test, needs_standby, needs_fire_watch, max_hours) values
  ('general', 'General (cold) work', null, false, false, false, false, 24),
  ('hot_work', 'Hot work', 'HOT_WORK', false, true, false, true, 12),
  ('confined_space', 'Confined space entry', 'CS_ENTRY', true, true, true, false, 12),
  ('electrical', 'Electrical work', 'ELECTRICAL', true, false, false, false, 12),
  ('height', 'Work at height', 'HEIGHTS', false, false, false, false, 12),
  ('excavation', 'Excavation and ground disturbance', null, false, false, false, false, 24),
  ('lifting', 'Lifting operation', 'RIGGING', false, false, false, false, 12)
on conflict (code) do nothing;

insert into ptw.conflict_rules (kind_a, kind_b, scope, reason) values
  ('hot_work', 'confined_space', 'area', 'Sparks and heat near an open confined space, or fumes drawn into it'),
  ('hot_work', 'hot_work', 'asset', 'Two hot work crews on one asset share one fire watch and one gas test'),
  ('lifting', 'height', 'area', 'A load swung over people working at height'),
  ('lifting', 'confined_space', 'area', 'A suspended load over an open entry point'),
  ('excavation', 'lifting', 'area', 'Crane outriggers near an open excavation'),
  ('electrical', 'general', 'asset', 'Two crews on one asset, one of them working on its electrics')
on conflict do nothing;

insert into ptw.gas_limits (gas, name, unit, min_value, max_value, source) values
  ('o2', 'Oxygen', '%', 19.5, 23.5, 'Safe oxygen range for entry: AS/NZS 2865:2009 and the Safe Work Australia Code of Practice: Confined spaces'),
  ('lel', 'Flammable gas', '% LEL', null, 5, 'Entry only below 5% of the lower explosive limit: AS/NZS 2865:2009 and the Safe Work Australia Code of Practice: Confined spaces'),
  ('h2s', 'Hydrogen sulphide', 'ppm', null, 5, 'Operator limit. Check it against the current workplace exposure standard (WorkSafe NZ WES, Safe Work Australia WES) before relying on it'),
  ('co', 'Carbon monoxide', 'ppm', null, 25, 'Operator limit. Check it against the current workplace exposure standard (WorkSafe NZ WES, Safe Work Australia WES) before relying on it')
on conflict do nothing;
