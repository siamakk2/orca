# Orca

Parcel + zoning feasibility engine, delivered as an embeddable SaaS for real-estate brokers.

## Structure
- `app/` — Next.js (App Router). Serves the broker embed, the admin backend, and the tenant API.
- `supabase/migrations/` — Postgres schema (multi-tenant + PostGIS + pgvector). `0001` is the tenancy spine.
- `spatial/` — Python spatial engine: ArcGIS parcel fetcher (LA + Napa), envelope math, zoning RAG.

## Getting started
```bash
npm install          # restore Next.js deps
npm run dev          # http://localhost:3000
```

Spatial service:
```bash
cd spatial
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Status
- LA parcel fetch: live/verified. Napa: host + CRS (EPSG:2226) confirmed, exact service path pending `discover_services("napa")`.
- Counties in scope: Los Angeles (06037), Napa (06055) — unincorporated first.
