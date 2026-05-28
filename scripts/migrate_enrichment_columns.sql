-- Enrichment v1: columns for RentCast (and future sources) to populate.
-- mls_status and mls_last_checked already exist; we keep them.

alter table public.leads
  add column if not exists list_price             numeric,
  add column if not exists list_date              date,
  add column if not exists days_on_market         integer,
  add column if not exists mls_number             text,
  add column if not exists listing_agent_name     text,
  add column if not exists listing_agent_phone    text,
  add column if not exists listing_agent_email    text,
  add column if not exists listing_brokerage      text,
  add column if not exists owner_name             text,
  add column if not exists owner_mailing_address  text,
  add column if not exists owner_last_sale_date   date,
  add column if not exists owner_last_sale_price  numeric,
  add column if not exists rentcast_property_id   text,
  add column if not exists rentcast_listing_id    text,
  add column if not exists enrichment_data        jsonb,
  add column if not exists enriched_at            timestamptz;

create index if not exists leads_enriched_at_idx on public.leads (enriched_at);
create index if not exists leads_mls_status_idx  on public.leads (mls_status);
