-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Rooms Table
create table rooms (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Solvents Table
create table solvents (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  cas_number text not null,
  formula text,
  molecular_weight text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Inventory Table (Join Table)
create table inventory (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references rooms(id) on delete cascade not null,
  solvent_id uuid references solvents(id) on delete cascade not null,
  amount numeric(10, 2) default 0.00 not null,
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(room_id, solvent_id)
);

-- Seed Data: Rooms
insert into rooms (name) values
  ('D105学生実験室'),
  ('D106学生実験室'),
  ('D201共同利用化学実験室'),
  ('溶媒庫'),
  ('F108実験室'),
  ('F109実験室'),
  ('F110実験室');

-- Seed Data: Solvents
insert into solvents (name, cas_number, formula, molecular_weight) values
  ('メタノール', '67-56-1', 'CH3OH', '32.04'),
  ('エタノール', '64-17-5', 'C2H5OH', '46.07'),
  ('イソプロパノール', '67-63-0', 'C3H8O', '60.10'),
  ('アセトン', '67-64-1', 'C3H6O', '58.08'),
  ('トルエン', '108-88-3', 'C7H8', '92.14');

-- MIGRATION: Run these if table already exists
-- alter table solvents add column if not exists formula text;
-- alter table solvents add column if not exists molecular_weight text;
-- update solvents set formula = 'CH3OH', molecular_weight = '32.04' where name = 'メタノール';
-- update solvents set formula = 'C2H5OH', molecular_weight = '46.07' where name = 'エタノール';
-- update solvents set formula = 'C3H8O', molecular_weight = '60.10' where name = 'イソプロパノール';
-- update solvents set formula = 'C3H6O', molecular_weight = '58.08' where name = 'アセトン';
-- update solvents set formula = 'C7H8', molecular_weight = '92.14' where name = 'トルエン';

-- Seed Data: Inventory (Initialize 0 for all combinations)
-- Cross join to create an entry for every solvent in every room
insert into inventory (room_id, solvent_id, amount)
select 
  r.id, 
  s.id, 
  0.0
from rooms r
cross join solvents s;

-- 4. Inventory Logs Table
create table inventory_logs (
  id uuid default uuid_generate_v4() primary key,
  inventory_id uuid references inventory(id) on delete cascade not null,
  change_amount numeric(10, 2) not null,
  user_name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for faster history lookups
create index idx_inventory_logs_inventory_id on inventory_logs(inventory_id);
