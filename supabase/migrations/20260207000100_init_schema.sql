-- Core schema for inventory + sales + BOM
create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'unit_type') then
    create type public.unit_type as enum ('g', 'oz', 'lb', 'each');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventory_txn_type') then
    create type public.inventory_txn_type as enum ('RECEIVE', 'COUNT', 'CONSUME');
  end if;
end $$;

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  name text not null,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  name text not null,
  unit public.unit_type not null,
  reorder_point numeric(12,3) not null default 0,
  lead_time_days integer not null default 0,
  unit_cost numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bom (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  qty_per_item numeric(12,3) not null,
  primary key (menu_item_id, ingredient_id)
);

create table if not exists public.sales_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  business_date date not null,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  qty numeric(12,3) not null,
  net_sales numeric(12,2) not null default 0,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_on_hand (
  ingredient_id uuid primary key references public.ingredients(id) on delete cascade,
  org_id uuid,
  qty_on_hand numeric(12,3) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_txns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  txn_type public.inventory_txn_type not null,
  qty_delta numeric(12,3) not null,
  created_at timestamptz not null default now(),
  note text
);

create index if not exists sales_line_items_business_date_idx
  on public.sales_line_items (business_date);

create unique index if not exists sales_line_items_daily_unique_idx
  on public.sales_line_items (business_date, menu_item_id);

create index if not exists inventory_txns_ingredient_created_idx
  on public.inventory_txns (ingredient_id, created_at desc);

create index if not exists bom_ingredient_idx
  on public.bom (ingredient_id);

alter table public.menu_items enable row level security;
alter table public.ingredients enable row level security;
alter table public.bom enable row level security;
alter table public.sales_line_items enable row level security;
alter table public.inventory_on_hand enable row level security;
alter table public.inventory_txns enable row level security;

create policy menu_items_select_authenticated
  on public.menu_items for select
  using (auth.role() = 'authenticated');

create policy menu_items_insert_authenticated
  on public.menu_items for insert
  with check (auth.role() = 'authenticated');

create policy menu_items_update_authenticated
  on public.menu_items for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy ingredients_select_authenticated
  on public.ingredients for select
  using (auth.role() = 'authenticated');

create policy ingredients_insert_authenticated
  on public.ingredients for insert
  with check (auth.role() = 'authenticated');

create policy ingredients_update_authenticated
  on public.ingredients for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy bom_select_authenticated
  on public.bom for select
  using (auth.role() = 'authenticated');

create policy bom_insert_authenticated
  on public.bom for insert
  with check (auth.role() = 'authenticated');

create policy bom_update_authenticated
  on public.bom for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy sales_line_items_select_authenticated
  on public.sales_line_items for select
  using (auth.role() = 'authenticated');

create policy sales_line_items_insert_authenticated
  on public.sales_line_items for insert
  with check (auth.role() = 'authenticated');

create policy sales_line_items_update_authenticated
  on public.sales_line_items for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy inventory_on_hand_select_authenticated
  on public.inventory_on_hand for select
  using (auth.role() = 'authenticated');

create policy inventory_on_hand_insert_authenticated
  on public.inventory_on_hand for insert
  with check (auth.role() = 'authenticated');

create policy inventory_on_hand_update_authenticated
  on public.inventory_on_hand for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy inventory_txns_select_authenticated
  on public.inventory_txns for select
  using (auth.role() = 'authenticated');

create policy inventory_txns_insert_authenticated
  on public.inventory_txns for insert
  with check (auth.role() = 'authenticated');

create policy inventory_txns_update_authenticated
  on public.inventory_txns for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
