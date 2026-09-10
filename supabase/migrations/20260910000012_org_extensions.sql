-- ============================================
-- 20260910000012_org_extensions.sql
-- Dedicated screens for departments, teams, customers, services, locations, workflows, report_types
-- All are business-scoped, soft-deletable (is_active), and RLS-protected
-- ============================================

-- DEPARTMENTS
create table if not exists departments (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    name text not null,
    description text default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table departments enable row level security;

drop policy if exists departments_scoped_select on departments;

create policy departments_scoped_select on departments for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists departments_write on departments;

create policy departments_write on departments for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_departments_business on departments (business_id);

-- TEAMS
create table if not exists teams (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    department_id uuid references departments (id) on delete set null,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    description text default '',
    lead_user_id uuid references user_profiles (id) on delete set null,
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table teams enable row level security;

drop policy if exists teams_scoped_select on teams;

create policy teams_scoped_select on teams for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists teams_write on teams;

create policy teams_write on teams for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_teams_business on teams (business_id);

create index if not exists idx_teams_department on teams (department_id);

create index if not exists idx_teams_branch on teams (branch_id);

-- CUSTOMERS
create table if not exists customers (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    email text,
    phone text,
    address text default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now ()
);

alter table customers enable row level security;

drop policy if exists customers_scoped_select on customers;

create policy customers_scoped_select on customers for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists customers_write on customers;

create policy customers_write on customers for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_customers_business on customers (business_id);

alter table customers
add column if not exists branch_id uuid references branches (id) on delete set null;

create index if not exists idx_customers_branch on customers (branch_id);

create index if not exists idx_customers_name on customers (name);

-- SERVICES (business services, not products)
create table if not exists services (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    name text not null,
    sku text,
    description text default '',
    category text default '',
    unit_price numeric(14, 2) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table services enable row level security;

drop policy if exists services_scoped_select on services;

create policy services_scoped_select on services for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists services_write on services;

create policy services_write on services for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_services_business on services (business_id);

alter table services
add column if not exists category_id uuid references categories (id) on delete set null;

alter table services
add column if not exists unit text not null default 'service';

alter table services
add column if not exists price numeric(14, 2) not null default 0;

-- LOCATIONS (physical locations, inventory locations, warehouses)
create table if not exists locations (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    address text default '',
    location_type text not null default 'warehouse' check (
        location_type in (
            'warehouse',
            'store',
            'office',
            'branch',
            'inventory',
            'other'
        )
    ),
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table locations enable row level security;

drop policy if exists locations_scoped_select on locations;

create policy locations_scoped_select on locations for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists locations_write on locations;

create policy locations_write on locations for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_locations_business on locations (business_id);

create index if not exists idx_locations_branch on locations (branch_id);

-- WORKFLOWS (configurable business workflows)
create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  description text default '',
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(business_id, name)
);

alter table workflows enable row level security;

drop policy if exists workflows_scoped_select on workflows;

create policy workflows_scoped_select on workflows for
select to authenticated using (
        business_id is null
        or can_access_business (business_id)
    );

drop policy if exists workflows_write on workflows;

create policy workflows_write on workflows for all to authenticated using (
    business_id is null
    or can_access_business (business_id)
)
with
    check (
        business_id is null
        or can_access_business (business_id)
    );

create index if not exists idx_workflows_business on workflows (business_id);

-- REPORT TYPES (configurable report templates)
create table if not exists report_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  description text default '',
  fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(business_id, name)
);

alter table report_types enable row level security;

drop policy if exists report_types_scoped_select on report_types;

create policy report_types_scoped_select on report_types for
select to authenticated using (
        business_id is null
        or can_access_business (business_id)
    );

drop policy if exists report_types_write on report_types;

create policy report_types_write on report_types for all to authenticated using (
    business_id is null
    or can_access_business (business_id)
)
with
    check (
        business_id is null
        or can_access_business (business_id)
    );

create index if not exists idx_report_types_business on report_types (business_id);

alter table report_types add column if not exists schema_definition jsonb not null default '{}'::jsonb;

alter table report_types add column if not exists fields jsonb not null default '[]'::jsonb;

-- Seed some defaults for demo (idempotent)
insert into
    departments (
        business_id,
        name,
        description
    )
select b.id, 'Operations', 'Core operations & branch management'
from businesses b
where
    b.name = 'Electronics Retail'
on conflict do nothing;

insert into
    departments (
        business_id,
        name,
        description
    )
select b.id, 'Sales', 'Sales & customer relations'
from businesses b
where
    b.name = 'Electronics Retail'
on conflict do nothing;

insert into report_types (business_id, name, description, fields) values (null, 'Weekly Stock & Financials', 'Standard weekly management report (stock, sales, challenges)', '["opening_stock","stock_received","stock_sold","stock_damaged","total_sales_value","activities_notes"]'::jsonb) on conflict do nothing;

insert into workflows (business_id, name, description, steps) values (null, 'Stock Transfer', 'Branch-to-branch stock movement', '["requested","reviewed","approved","dispatched","in_transit","received","completed"]'::jsonb) on conflict do nothing;