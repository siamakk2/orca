-- =====================================================================
-- Orca — parcel/zoning feasibility SaaS
-- Migration 0001: multi-tenant spine
--
-- TRUST BOUNDARY (read this before touching RLS):
--   * Broker end-users are ANONYMOUS visitors on the broker's own website.
--     They never authenticate to Supabase and never touch these tables
--     directly. The embed calls our /api layer with a PUBLIC key; that
--     layer validates key + request origin + quota, then talks to Postgres
--     using the service role.
--   * The BROKER is the tenant. Brokers do not get Supabase logins either
--     (unless we later ship a broker self-serve portal).
--   * YOU (admin) manage everything through /admin using the service role.
--   * Therefore: RLS denies anon/authenticated by default on every table.
--     Access is server-side, behind the key+origin+quota gate. RLS here is
--     defense-in-depth, not the primary auth mechanism.
-- =====================================================================

-- One database, three jobs. Spatial + RAG live here too.
create extension if not exists postgis;      -- parcel geometry, setback math
create extension if not exists vector;       -- pgvector: zoning-code embeddings
create extension if not exists pgcrypto;     -- gen_random_uuid, digest()

-- ---------------------------------------------------------------------
-- tenants  (the brokers who pay us)
-- ---------------------------------------------------------------------
create table tenants (
    id            uuid primary key default gen_random_uuid(),
    slug          text unique not null,             -- url-safe handle, e.g. 'napa-valley-realty'
    company_name  text not null,
    contact_email text,
    status        text not null default 'trialing'  -- trialing | active | suspended | canceled
                  check (status in ('trialing','active','suspended','canceled')),
    -- white-label branding the embed reads at render time
    brand_logo_url text,
    brand_color    text default '#0f172a',
    counties       text[] not null default '{los_angeles,napa}',  -- what this broker may query
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- api_keys  (public embed keys; one broker can rotate/hold several)
-- The public key is safe to expose in the broker's page. Security comes
-- from pairing it with the origin allowlist below + server-side quota.
-- ---------------------------------------------------------------------
create table api_keys (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references tenants(id) on delete cascade,
    public_key   text unique not null,              -- 'pk_live_...' handed to the broker
    label        text,                              -- 'production site', 'staging'
    status       text not null default 'active'
                 check (status in ('active','revoked')),
    last_used_at timestamptz,
    created_at   timestamptz not null default now()
);
create index on api_keys (tenant_id);
create index on api_keys (public_key) where status = 'active';

-- ---------------------------------------------------------------------
-- allowed_origins  (the ONLY domains a key may run on)
-- The /api layer checks the request Origin/Referer against this list.
-- ---------------------------------------------------------------------
create table allowed_origins (
    id         uuid primary key default gen_random_uuid(),
    tenant_id  uuid not null references tenants(id) on delete cascade,
    origin     text not null,                       -- 'https://broker.com' (scheme+host, no path)
    created_at timestamptz not null default now(),
    unique (tenant_id, origin)
);
create index on allowed_origins (tenant_id);

-- ---------------------------------------------------------------------
-- subscriptions  (mirror of Stripe; updated by webhook, never by hand)
-- ---------------------------------------------------------------------
create table subscriptions (
    id                     uuid primary key default gen_random_uuid(),
    tenant_id              uuid not null unique references tenants(id) on delete cascade,
    stripe_customer_id     text unique,
    stripe_subscription_id text unique,
    plan                   text not null default 'starter',   -- starter | pro | agency
    status                 text not null default 'trialing',  -- Stripe status verbatim
    monthly_report_quota   integer not null default 50,       -- plan cap; 0 = unlimited
    current_period_end     timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- usage_events  (append-only meter — one row per billable action)
-- ---------------------------------------------------------------------
create table usage_events (
    id         bigint generated always as identity primary key,
    tenant_id  uuid not null references tenants(id) on delete cascade,
    kind       text not null                        -- 'report' | 'parcel_lookup' | 'zoning_query'
               check (kind in ('report','parcel_lookup','zoning_query')),
    api_key_id uuid references api_keys(id) on delete set null,
    created_at timestamptz not null default now()
);
create index on usage_events (tenant_id, created_at);

-- ---------------------------------------------------------------------
-- reports  (tenant-scoped outputs; the deliverable brokers generate)
-- Geometry stored in 4326; project on read for setback math.
-- ---------------------------------------------------------------------
create table reports (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references tenants(id) on delete cascade,
    county_slug  text not null,                     -- 'los_angeles' | 'napa'
    apn          text,
    address      text,
    acreage      numeric(12,4),
    geom         geometry(Geometry, 4326),          -- parcel footprint (PostGIS)
    payload      jsonb not null default '{}',       -- flood, zoning findings, envelope, etc.
    pdf_url      text,
    created_at   timestamptz not null default now()
);
create index on reports (tenant_id, created_at);
create index on reports using gist (geom);

-- ---------------------------------------------------------------------
-- Convenience: current period usage vs quota (used by the quota gate)
-- ---------------------------------------------------------------------
create or replace function tenant_reports_this_period(t uuid)
returns integer language sql stable as $$
    select count(*)::int
    from usage_events ue
    where ue.tenant_id = t
      and ue.kind = 'report'
      and ue.created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------------
-- keep updated_at honest
-- ---------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_tenants_touch    before update on tenants
    for each row execute function touch_updated_at();
create trigger trg_subs_touch       before update on subscriptions
    for each row execute function touch_updated_at();

-- =====================================================================
-- RLS — deny by default everywhere. Server (service role) bypasses RLS;
-- anon/authenticated get nothing. See TRUST BOUNDARY note at top.
-- =====================================================================
alter table tenants         enable row level security;
alter table api_keys        enable row level security;
alter table allowed_origins enable row level security;
alter table subscriptions   enable row level security;
alter table usage_events    enable row level security;
alter table reports         enable row level security;
-- No permissive policies for anon/authenticated are created on purpose.
-- (If we later add a broker self-serve portal, add tenant-scoped policies
--  keyed to a JWT claim like auth.jwt() ->> 'tenant_id' here.)
