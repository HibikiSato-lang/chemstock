-- ChemStock production model, for a clean Supabase database.
-- The legacy supabase/setup.sql is a separate demo seed and must not be run here.
-- This migration establishes the data and read boundaries. Command RPCs follow in
-- later migrations; client roles have no direct write permission.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.valid_setting_value(p_key text, p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key = 'dq_arm_over' then
    return p_value in ('true', 'false');
  end if;

  if p_value is null or length(p_value) > 32 or p_value !~ '^[0-9]+(\.[0-9]+)?$' then
    return false;
  end if;

  case p_key
    when 'warning_ratio' then
      return p_value::numeric > 0 and p_value::numeric < 1;
    when 'forecast_window_days' then
      return p_value ~ '^[0-9]{1,3}$' and p_value::integer between 1 and 365;
    when 'unit_gal_to_l' then
      return p_value::numeric = 3.8;
    when 'unit_tokan_to_l' then
      return p_value::numeric = 18;
    else
      return false;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;
revoke all on function private.valid_setting_value(text, text) from public, anon, authenticated;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key references auth.users(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  login_id text not null unique check (btrim(login_id) <> ''),
  role text not null check (role in ('lab', 'solvent_room_admin', 'global_admin')),
  email text,
  created_at timestamptz not null default now(),
  constraint accounts_room_matches_role check (
    (role = 'global_admin' and room_id is null)
    or (role in ('lab', 'solvent_room_admin') and room_id is not null)
  )
);

create table public.solvents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  cas_number text unique,
  formula text,
  molecular_weight text,
  hazard_class text,
  designated_quantity numeric(10, 2) check (designated_quantity > 0),
  base_unit text not null default 'L' check (base_unit = 'L'),
  created_at timestamptz not null default now()
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  solvent_id uuid not null references public.solvents(id) on delete restrict,
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  opening_amount numeric(10, 2) not null default 0 check (opening_amount >= 0),
  opened_at timestamptz not null default now(),
  low_stock_threshold numeric(10, 2) check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  last_updated timestamptz not null default now(),
  unique (room_id, solvent_id),
  constraint inactive_inventory_is_empty check (is_active or amount = 0)
);

create function private.touch_inventory_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_updated := now();
  return new;
end;
$$;
revoke all on function private.touch_inventory_timestamp() from public, anon, authenticated;
create trigger touch_inventory_timestamp
before update on public.inventory
for each row execute function private.touch_inventory_timestamp();

create table public.command_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (btrim(operation) <> ''),
  target_id text not null check (btrim(target_id) <> ''),
  arguments jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

-- The reservation can be incomplete within a transaction, but never at commit.
create function private.ensure_command_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.command_requests
    where id = new.id and result is not null
  ) then
    raise exception 'command request result is required at commit'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.ensure_command_result() from public, anon, authenticated;
create constraint trigger command_result_required
after insert on public.command_requests
deferrable initially deferred
for each row execute function private.ensure_command_result();

create function private.protect_command_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.account_id, new.idempotency_key, new.operation, new.target_id,
      new.arguments, new.created_at) is distinct from
     (old.account_id, old.idempotency_key, old.operation, old.target_id,
      old.arguments, old.created_at)
     or (old.result is not null and new.result is distinct from old.result) then
    raise exception 'command request identity and completed result are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_command_request() from public, anon, authenticated;
create trigger protect_command_request
before update on public.command_requests
for each row execute function private.protect_command_request();

create table public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  command_request_id uuid not null references public.command_requests(id) on delete restrict,
  created_by_account_id uuid not null references public.accounts(id) on delete restrict,
  change_amount numeric(10, 2) not null check (change_amount <> 0),
  operator_name text not null check (char_length(btrim(operator_name)) between 1 and 100),
  purpose text check (char_length(purpose) <= 500),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_logs_inventory_occurred_idx
  on public.inventory_logs (inventory_id, occurred_at, created_at, id);

create table public.operation_audits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  command_request_id uuid not null references public.command_requests(id) on delete restrict,
  target_type text not null check (target_type in ('log', 'inventory', 'solvent', 'setting', 'notification')),
  target_id text not null check (btrim(target_id) <> ''),
  action text not null check (btrim(action) <> ''),
  operator_name text not null check (char_length(btrim(operator_name)) between 1 and 100),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 200),
  before_value jsonb not null,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type = 'designated_quantity_exceeded'),
  ratio numeric(10, 3) not null check (ratio >= 0),
  message text not null,
  status text not null default 'unread' check (status in ('unread', 'acknowledged', 'resolved')),
  notified_at timestamptz not null default now()
);
create unique index notifications_one_open_designated
  on public.notifications (type)
  where type = 'designated_quantity_exceeded' and status <> 'resolved';

create table public.settings (
  key text primary key,
  value text not null,
  description text,
  constraint settings_valid_value check (private.valid_setting_value(key, value))
);
insert into public.settings (key, value, description) values
  ('warning_ratio', '0.8', '接近表示の倍率。通知の発火条件ではない'),
  ('forecast_window_days', '30', '欠品予測の参照日数'),
  ('unit_gal_to_l', '3.8', '既存の1 galボタンと同じ操作単位'),
  ('unit_tokan_to_l', '18', '既存の1斗缶ボタンと同じ操作単位'),
  ('dq_arm_over', 'true', '指定数量超過通知の再アーム状態');

-- Explicit grants are needed because older Supabase projects can have broad
-- default privileges on new public tables.
revoke all on public.rooms, public.accounts, public.solvents, public.inventory,
  public.command_requests, public.inventory_logs, public.operation_audits,
  public.notifications, public.settings from public, anon, authenticated;

alter table public.rooms enable row level security;
alter table public.accounts enable row level security;
alter table public.solvents enable row level security;
alter table public.inventory enable row level security;
alter table public.command_requests enable row level security;
alter table public.inventory_logs enable row level security;
alter table public.operation_audits enable row level security;
alter table public.notifications enable row level security;
alter table public.settings enable row level security;

grant select on public.accounts, public.rooms, public.inventory,
  public.inventory_logs to authenticated;
grant select (id, name, cas_number, formula, molecular_weight, base_unit, created_at)
  on public.solvents to authenticated;

create policy accounts_read_own on public.accounts
  for select to authenticated
  using (id = (select auth.uid()));

create policy rooms_read_scoped on public.rooms
  for select to authenticated
  using (exists (
    select 1 from public.accounts a
    where a.id = (select auth.uid())
      and (a.role = 'global_admin' or a.room_id = rooms.id)
  ));

create policy solvents_read_signed_in on public.solvents
  for select to authenticated
  using (exists (
    select 1 from public.accounts a where a.id = (select auth.uid())
  ));

create policy inventory_read_scoped on public.inventory
  for select to authenticated
  using (exists (
    select 1 from public.accounts a
    where a.id = (select auth.uid())
      and (a.role = 'global_admin' or a.room_id = inventory.room_id)
  ));

create policy inventory_logs_read_scoped on public.inventory_logs
  for select to authenticated
  using (exists (
    select 1 from public.inventory i where i.id = inventory_logs.inventory_id
  ));
