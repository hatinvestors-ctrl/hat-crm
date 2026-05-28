
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/enrich-lead.mjs
var RENTCAST_BASE = "https://api.rentcast.io/v1";
var RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
var SUPABASE_URL = process.env.SUPABASE_URL || "https://pyrgotfotmwazigewlke.supabase.co";
var SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "pyrgotfotmwazigewlke";
var SUPABASE_PAT = process.env.SUPABASE_PAT;
async function rentcastGet(path) {
  const url = `${RENTCAST_BASE}${path}`;
  const r = await fetch(url, { headers: { "X-Api-Key": RENTCAST_API_KEY, Accept: "application/json" } });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
  }
  return { status: r.status, json, raw: text };
}
function normalizeMlsStatusRaw(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[-_\s]+/g, "_");
  if (s.includes("inactive")) return "inactive";
  if (s.includes("withdraw") || s.includes("cancel")) return "withdrawn";
  if (s.includes("expire")) return "expired";
  if (s.includes("sold") || s.includes("closed")) return "sold";
  if (s.includes("conting")) return "contingent";
  if (s.includes("pend")) return "pending";
  if (s.includes("off")) return "off_market";
  if (s.includes("active")) return "active";
  return null;
}
function inferMlsStatus(listing) {
  if (!listing) return null;
  const raw = normalizeMlsStatusRaw(listing.status);
  if (raw && raw !== "inactive") return raw;
  const history = listing.history || {};
  const events = Object.values(history);
  const sortedDates = Object.keys(history).sort().reverse();
  const latest = sortedDates[0] ? history[sortedDates[0]] : null;
  if (events.some((e) => /sold|closed|sale_clos/i.test(e.event || ""))) return "sold";
  if (events.some((e) => /withdraw|expire|cancel/i.test(e.event || ""))) return "withdrawn";
  const removedDate = latest?.removedDate || listing.removedDate;
  if (removedDate) {
    const ageDays = Math.floor((Date.now() - new Date(removedDate).getTime()) / 864e5);
    if (ageDays >= 0 && ageDays <= 45) return "pending";
    if (ageDays > 45) return "off_market";
  }
  return "off_market";
}
function totalDaysOnMarket(history) {
  if (!history || typeof history !== "object") return null;
  let total = 0;
  for (const evt of Object.values(history)) {
    if (evt && evt.event && /list/i.test(evt.event) && typeof evt.daysOnMarket === "number") {
      total += evt.daysOnMarket;
    }
  }
  return total > 0 ? total : null;
}
function normalizePropertyType(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes("single")) return "single_family";
  if (s.includes("multi") || s.includes("duplex") || s.includes("triplex") || s.includes("quad")) return "multi_family";
  if (s.includes("condo")) return "condo";
  if (s.includes("town")) return "townhouse";
  if (s.includes("land") || s.includes("lot")) return "land";
  if (s.includes("commerc")) return "commercial";
  return "other";
}
async function fetchEnrichmentForAddress(address) {
  const enc = encodeURIComponent(address);
  const [propRes, lstRes] = await Promise.all([
    rentcastGet(`/properties?address=${enc}`),
    rentcastGet(`/listings/sale?address=${enc}`)
  ]);
  const property = Array.isArray(propRes.json) ? propRes.json[0] : propRes.status === 200 ? propRes.json : null;
  const listing = Array.isArray(lstRes.json) ? lstRes.json[0] : lstRes.status === 200 ? lstRes.json : null;
  if (!property && !listing) {
    return { found: false, error: "No data found for that address." };
  }
  const src = listing || property;
  const out = {
    address: src.addressLine1 || property?.addressLine1 || null,
    city: src.city || null,
    state: src.state || null,
    zip_code: src.zipCode || null,
    property_type: normalizePropertyType(src.propertyType),
    bedrooms: src.bedrooms ?? property?.bedrooms ?? null,
    bathrooms: src.bathrooms ?? property?.bathrooms ?? null,
    sqft: src.squareFootage ?? property?.squareFootage ?? null,
    lot_size_sqft: src.lotSize ?? property?.lotSize ?? null,
    year_built: src.yearBuilt ?? property?.yearBuilt ?? null,
    has_garage: property?.features?.garage ?? null
  };
  if (listing) {
    out.mls_status = inferMlsStatus(listing);
    out.days_on_market = totalDaysOnMarket(listing.history) ?? listing.daysOnMarket ?? null;
    out.list_price = listing.price ?? null;
    out.asking_price = listing.price ?? null;
    out.list_date = listing.listedDate ? listing.listedDate.slice(0, 10) : null;
    out.mls_number = listing.mlsNumber ?? null;
    out.listing_agent_name = listing.listingAgent?.name ?? null;
    out.listing_agent_phone = listing.listingAgent?.phone ?? null;
    out.listing_agent_email = listing.listingAgent?.email ?? null;
    out.listing_brokerage = listing.listingOffice?.name ?? null;
    out.rentcast_listing_id = listing.id ?? null;
  } else {
    out.mls_status = "off_market";
  }
  if (property) {
    out.rentcast_property_id = property.id ?? null;
    out.owner_name = property.owner?.names?.[0] ?? null;
    out.owner_mailing_address = property.owner?.mailingAddress?.formattedAddress ?? null;
    out.owner_last_sale_date = property.lastSaleDate ? property.lastSaleDate.slice(0, 10) : null;
    out.owner_last_sale_price = property.lastSalePrice ?? null;
  }
  out.enrichment_data = { property: property || null, listing: listing || null, fetched_at: (/* @__PURE__ */ new Date()).toISOString() };
  out.enriched_at = (/* @__PURE__ */ new Date()).toISOString();
  out.mls_last_checked = (/* @__PURE__ */ new Date()).toISOString();
  return { found: true, ...out };
}
async function sql(query) {
  if (!SUPABASE_PAT) throw new Error("SUPABASE_PAT not configured");
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    return [];
  }
}
function sqlString(v) {
  if (v === null || v === void 0) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNumber(v) {
  if (v === null || v === void 0 || v === "") return "NULL";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "NULL";
}
function sqlBool(v) {
  if (v === null || v === void 0) return "NULL";
  return v ? "true" : "false";
}
function sqlJson(v) {
  if (v === null || v === void 0) return "NULL";
  return `${sqlString(JSON.stringify(v))}::jsonb`;
}
async function getLead(leadId) {
  const rows = await sql(`select * from public.leads where id = '${leadId.replace(/'/g, "''")}' limit 1`);
  return rows[0] || null;
}
async function isMlsPaused(workspaceId) {
  if (!workspaceId) return false;
  const safe = workspaceId.replace(/'/g, "''");
  const rows = await sql(`select (settings->>'mls_paused')::boolean as paused from public.workspaces where id = '${safe}' limit 1`);
  return !!rows[0]?.paused;
}
async function patchLeadWithEnrichment(lead, e) {
  const updates = [];
  const setIf = (col, val, mode = "always") => {
    if (val === null || val === void 0) return;
    if (mode === "if_empty" && lead[col] != null && lead[col] !== "") return;
    if (typeof val === "number") updates.push(`${col} = ${sqlNumber(val)}`);
    else if (typeof val === "boolean") updates.push(`${col} = ${sqlBool(val)}`);
    else updates.push(`${col} = ${sqlString(val)}`);
  };
  setIf("mls_status", e.mls_status);
  setIf("mls_last_checked", e.mls_last_checked);
  setIf("list_price", e.list_price);
  setIf("list_date", e.list_date);
  setIf("days_on_market", e.days_on_market);
  setIf("mls_number", e.mls_number);
  setIf("listing_agent_name", e.listing_agent_name);
  setIf("listing_agent_phone", e.listing_agent_phone);
  setIf("listing_agent_email", e.listing_agent_email);
  setIf("listing_brokerage", e.listing_brokerage);
  setIf("rentcast_listing_id", e.rentcast_listing_id);
  setIf("rentcast_property_id", e.rentcast_property_id);
  setIf("enriched_at", e.enriched_at);
  if (e.listing_agent_name) {
    const sellerLabel = e.listing_brokerage ? `${e.listing_agent_name} (${e.listing_brokerage})` : e.listing_agent_name;
    setIf("seller_name", sellerLabel, "if_empty");
  }
  setIf("phone", e.listing_agent_phone, "if_empty");
  setIf("email", e.listing_agent_email, "if_empty");
  if (e.rentcast_listing_id) setIf("lead_source", "mls", "if_empty");
  setIf("city", e.city, "if_empty");
  setIf("state", e.state, "if_empty");
  setIf("zip_code", e.zip_code, "if_empty");
  setIf("property_type", e.property_type, "if_empty");
  setIf("bedrooms", e.bedrooms, "if_empty");
  setIf("bathrooms", e.bathrooms, "if_empty");
  setIf("sqft", e.sqft, "if_empty");
  setIf("lot_size_sqft", e.lot_size_sqft, "if_empty");
  setIf("year_built", e.year_built, "if_empty");
  setIf("has_garage", e.has_garage, "if_empty");
  setIf("asking_price", e.asking_price, "if_empty");
  setIf("owner_name", e.owner_name, "if_empty");
  setIf("owner_mailing_address", e.owner_mailing_address, "if_empty");
  setIf("owner_last_sale_date", e.owner_last_sale_date, "if_empty");
  setIf("owner_last_sale_price", e.owner_last_sale_price, "if_empty");
  if (e.enrichment_data) updates.push(`enrichment_data = ${sqlJson(e.enrichment_data)}`);
  if (updates.length === 0) return lead;
  const setClause = updates.join(", ");
  const updated = await sql(
    `update public.leads set ${setClause} where id = '${lead.id.replace(/'/g, "''")}' returning *`
  );
  return updated[0] || lead;
}
function buildActivityContent(e) {
  const parts = [];
  parts.push(`mls=${e.mls_status || "unknown"}`);
  if (typeof e.days_on_market === "number") parts.push(`DOM=${e.days_on_market}`);
  if (e.list_price) parts.push(`list=$${Number(e.list_price).toLocaleString()}`);
  if (e.listing_agent_name) {
    const agentBlurb = e.listing_brokerage ? `${e.listing_agent_name} (${e.listing_brokerage})` : e.listing_agent_name;
    parts.push(`agent=${agentBlurb}`);
  }
  if (e.listing_agent_phone) parts.push(`\u260E ${e.listing_agent_phone}`);
  return `\u2728 Enriched from RentCast \u2014 ${parts.join(" \xB7 ")}`;
}
async function logEnrichment(leadId, content) {
  const safe = content.replace(/'/g, "''");
  await sql(
    `insert into public.lead_activities (lead_id, type, content) values ('${leadId.replace(/'/g, "''")}', 'enrichment', '${safe}')`
  );
}
async function logStatusChange(leadId, oldStatus, newStatus) {
  const a = oldStatus || "unknown";
  const b = newStatus || "unknown";
  const safe = `\u{1F3F7} MLS status changed: ${a} \u2192 ${b}`.replace(/'/g, "''");
  await sql(
    `insert into public.lead_activities (lead_id, type, content) values ('${leadId.replace(/'/g, "''")}', 'status_change', '${safe}')`
  );
}
async function handleAddressLookup(address, workspaceId) {
  if (await isMlsPaused(workspaceId)) {
    return { status: 200, body: { ok: false, paused: true, error: "RentCast enrichment is paused for this workspace. Re-enable in Settings \u2192 MLS Auto-Refresh." } };
  }
  const e = await fetchEnrichmentForAddress(address);
  if (!e.found) {
    return { status: 404, body: { ok: false, error: e.error } };
  }
  const { enrichment_data, ...rest } = e;
  return { status: 200, body: { ok: true, ...rest } };
}
async function handleLeadEnrich(leadId, force) {
  const lead = await getLead(leadId);
  if (!lead) return { status: 404, body: { ok: false, error: "Lead not found." } };
  if (await isMlsPaused(lead.workspace_id)) {
    return { status: 200, body: { ok: false, paused: true, error: "RentCast enrichment is paused for this workspace. Re-enable in Settings \u2192 MLS Auto-Refresh." } };
  }
  if (!force && lead.enriched_at) {
    const ageMs = Date.now() - new Date(lead.enriched_at).getTime();
    if (ageMs < 24 * 3600 * 1e3) {
      return { status: 200, body: { ok: true, skipped: true, reason: "Enriched within last 24h", lead } };
    }
  }
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(", ");
  if (!addr) return { status: 400, body: { ok: false, error: "Lead has no address to look up." } };
  const e = await fetchEnrichmentForAddress(addr);
  if (!e.found) {
    return { status: 200, body: { ok: false, error: e.error } };
  }
  const oldStatus = lead.mls_status;
  const updated = await patchLeadWithEnrichment(lead, e);
  await logEnrichment(lead.id, buildActivityContent(e));
  if (e.mls_status && oldStatus && e.mls_status !== oldStatus) {
    await logStatusChange(lead.id, oldStatus, e.mls_status);
  }
  return { status: 200, body: { ok: true, lead: updated } };
}
async function handleScheduledSweep() {
  const rows = await sql(`
    select id from public.leads
    where status not in ('sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed')
      and (mls_last_checked is null or mls_last_checked < now() - interval '4 hours')
    order by mls_last_checked asc nulls first
    limit 50
  `);
  const results = { processed: 0, changed: 0, errors: 0 };
  for (const r of rows) {
    try {
      const res = await handleLeadEnrich(r.id, true);
      if (res.body?.ok) results.processed++;
    } catch (e) {
      results.errors++;
    }
  }
  return { status: 200, body: { ok: true, ...results } };
}
var enrich_lead_default = async (req) => {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST,GET,OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  try {
    if (!RENTCAST_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "RENTCAST_API_KEY not configured" }), { status: 500, headers });
    }
    if (req.method === "GET") {
      const res = await handleScheduledSweep();
      return new Response(JSON.stringify(res.body), { status: res.status, headers });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.address && !body.lead_id) {
        const res = await handleAddressLookup(body.address, body.workspace_id);
        return new Response(JSON.stringify(res.body), { status: res.status, headers });
      }
      if (body.lead_id) {
        const res = await handleLeadEnrich(body.lead_id, !!body.force);
        return new Response(JSON.stringify(res.body), { status: res.status, headers });
      }
      return new Response(JSON.stringify({ ok: false, error: "Provide either { address } or { lead_id }" }), { status: 400, headers });
    }
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers });
  }
};
export {
  enrich_lead_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvZW5yaWNoLWxlYWQubWpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBMZWFkIGVucmljaG1lbnQgdmlhIFJlbnRDYXN0LlxuLy9cbi8vIFRIUkVFIGludm9jYXRpb24gbW9kZXM6XG4vL1xuLy8gMS4gT24tZGVtYW5kIGV4aXN0aW5nLWxlYWQgZW5yaWNoOlxuLy8gICAgUE9TVCAvLm5ldGxpZnkvZnVuY3Rpb25zL2VucmljaC1sZWFkXG4vLyAgICBib2R5OiB7IGxlYWRfaWQ6IFwiPHV1aWQ+XCIsIGZvcmNlPzogYm9vbGVhbiB9XG4vLyAgICBcdTIxOTIgZW5yaWNoZXMgdGhhdCBsZWFkLCByZXR1cm5zIHRoZSBwYXRjaGVkIHJvdy5cbi8vXG4vLyAyLiBBZGRyZXNzIGxvb2t1cCAobm8gbGVhZCB5ZXQgXHUyMDE0IHVzZWQgYnkgdGhlIFwiTG9vayB1cFwiIGJ1dHRvbiBpbiBOZXcgTGVhZCBmb3JtKTpcbi8vICAgIFBPU1QgLy5uZXRsaWZ5L2Z1bmN0aW9ucy9lbnJpY2gtbGVhZFxuLy8gICAgYm9keTogeyBhZGRyZXNzOiBcIjE0NTYgVyAyMHRoIFN0LCBKYWNrc29udmlsbGUsIEZMIDMyMjA5XCIgfVxuLy8gICAgXHUyMTkyIHJldHVybnMgc2hhcGVkIGZpZWxkcyByZWFkeSB0byBkcm9wIGludG8gdGhlIGZvcm0gKG5vIERCIHdyaXRlKS5cbi8vXG4vLyAzLiBTY2hlZHVsZWQgYmF0Y2ggc3dlZXAgKE5ldGxpZnkgY3Jvbik6XG4vLyAgICBHRVQgLy5uZXRsaWZ5L2Z1bmN0aW9ucy9lbnJpY2gtbGVhZCAoY2FsbGVkIGJ5IE5ldGxpZnkgU2NoZWR1bGVkIEZ1bmN0aW9ucylcbi8vICAgIFx1MjE5MiByZWZyZXNoZXMgbWxzX3N0YXR1cyBmb3Igbm9uLXRlcm1pbmFsIGxlYWRzIHRoYXQgaGF2ZW4ndCBiZWVuIGNoZWNrZWQgaW4gNGguXG5cbmNvbnN0IFJFTlRDQVNUX0JBU0UgPSAnaHR0cHM6Ly9hcGkucmVudGNhc3QuaW8vdjEnXG5cbi8vIEVudiB2YXJzXG5jb25zdCBSRU5UQ0FTVF9BUElfS0VZID0gcHJvY2Vzcy5lbnYuUkVOVENBU1RfQVBJX0tFWVxuY29uc3QgU1VQQUJBU0VfVVJMID0gcHJvY2Vzcy5lbnYuU1VQQUJBU0VfVVJMIHx8ICdodHRwczovL3B5cmdvdGZvdG13YXppZ2V3bGtlLnN1cGFiYXNlLmNvJ1xuY29uc3QgU1VQQUJBU0VfUFJPSkVDVF9SRUYgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9QUk9KRUNUX1JFRiB8fCAncHlyZ290Zm90bXdhemlnZXdsa2UnXG5jb25zdCBTVVBBQkFTRV9QQVQgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9QQVQgLy8gTWFuYWdlbWVudCBBUEkgUEFUIFx1MjAxNCBieXBhc3NlcyBSTFNcblxuLy8gXHUyNTAwXHUyNTAwIFJlbnRDYXN0IGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbmFzeW5jIGZ1bmN0aW9uIHJlbnRjYXN0R2V0KHBhdGgpIHtcbiAgY29uc3QgdXJsID0gYCR7UkVOVENBU1RfQkFTRX0ke3BhdGh9YFxuICBjb25zdCByID0gYXdhaXQgZmV0Y2godXJsLCB7IGhlYWRlcnM6IHsgJ1gtQXBpLUtleSc6IFJFTlRDQVNUX0FQSV9LRVksIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH0gfSlcbiAgY29uc3QgdGV4dCA9IGF3YWl0IHIudGV4dCgpXG4gIGxldCBqc29uID0gbnVsbFxuICB0cnkgeyBqc29uID0gSlNPTi5wYXJzZSh0ZXh0KSB9IGNhdGNoIChfKSB7fVxuICByZXR1cm4geyBzdGF0dXM6IHIuc3RhdHVzLCBqc29uLCByYXc6IHRleHQgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVNbHNTdGF0dXNSYXcocmF3KSB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBzID0gU3RyaW5nKHJhdykudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bLV9cXHNdKy9nLCAnXycpXG4gIC8vIE9yZGVyIG1hdHRlcnMgXHUyMDE0IGNoZWNrIG1vcmUgc3BlY2lmaWMgdGVybXMgYmVmb3JlIGdlbmVyaWMgb25lcy5cbiAgaWYgKHMuaW5jbHVkZXMoJ2luYWN0aXZlJykpIHJldHVybiAnaW5hY3RpdmUnICAgICAgICAvLyBnZW5lcmljIFwibm8gbG9uZ2VyIGFjdGl2ZVwiIFx1MjAxNCBuZWVkcyBmdXJ0aGVyIGluZmVyZW5jZVxuICBpZiAocy5pbmNsdWRlcygnd2l0aGRyYXcnKSB8fCBzLmluY2x1ZGVzKCdjYW5jZWwnKSkgcmV0dXJuICd3aXRoZHJhd24nXG4gIGlmIChzLmluY2x1ZGVzKCdleHBpcmUnKSkgcmV0dXJuICdleHBpcmVkJ1xuICBpZiAocy5pbmNsdWRlcygnc29sZCcpIHx8IHMuaW5jbHVkZXMoJ2Nsb3NlZCcpKSByZXR1cm4gJ3NvbGQnXG4gIGlmIChzLmluY2x1ZGVzKCdjb250aW5nJykpIHJldHVybiAnY29udGluZ2VudCdcbiAgaWYgKHMuaW5jbHVkZXMoJ3BlbmQnKSkgcmV0dXJuICdwZW5kaW5nJ1xuICBpZiAocy5pbmNsdWRlcygnb2ZmJykpIHJldHVybiAnb2ZmX21hcmtldCdcbiAgaWYgKHMuaW5jbHVkZXMoJ2FjdGl2ZScpKSByZXR1cm4gJ2FjdGl2ZSdcbiAgcmV0dXJuIG51bGxcbn1cblxuLy8gUmVudENhc3QgY29sbGFwc2VzIE1MUyBzdGF0ZSBtYWNoaW5lIHRvIGJpbmFyeSBBY3RpdmUvSW5hY3RpdmUuXG4vLyBXZSBpbmZlciBQZW5kaW5nIHZzIFdpdGhkcmF3biB2cyBTb2xkIGZyb20gcmVtb3ZlZERhdGUgKyBoaXN0b3J5IGNvbnRleHQuXG5mdW5jdGlvbiBpbmZlck1sc1N0YXR1cyhsaXN0aW5nKSB7XG4gIGlmICghbGlzdGluZykgcmV0dXJuIG51bGxcbiAgY29uc3QgcmF3ID0gbm9ybWFsaXplTWxzU3RhdHVzUmF3KGxpc3Rpbmcuc3RhdHVzKVxuICBpZiAocmF3ICYmIHJhdyAhPT0gJ2luYWN0aXZlJykgcmV0dXJuIHJhdyAgIC8vIGhvbmVzdCBzdGF0dXMsIHVzZSBpdFxuXG4gIC8vIHN0YXR1cyBpcyBJbmFjdGl2ZSAob3IgbnVsbCkgXHUyMDE0IGluZmVyIGZyb20gY29udGV4dFxuICBjb25zdCBoaXN0b3J5ID0gbGlzdGluZy5oaXN0b3J5IHx8IHt9XG4gIGNvbnN0IGV2ZW50cyA9IE9iamVjdC52YWx1ZXMoaGlzdG9yeSlcbiAgLy8gTW9zdCByZWNlbnQgZXZlbnQgYnkgZGF0ZVxuICBjb25zdCBzb3J0ZWREYXRlcyA9IE9iamVjdC5rZXlzKGhpc3RvcnkpLnNvcnQoKS5yZXZlcnNlKClcbiAgY29uc3QgbGF0ZXN0ID0gc29ydGVkRGF0ZXNbMF0gPyBoaXN0b3J5W3NvcnRlZERhdGVzWzBdXSA6IG51bGxcblxuICAvLyBBbnkgZXhwbGljaXQgc2FsZSBldmVudCBpbiBoaXN0b3J5IFx1MjE5MiBzb2xkXG4gIGlmIChldmVudHMuc29tZShlID0+IC9zb2xkfGNsb3NlZHxzYWxlX2Nsb3MvaS50ZXN0KGUuZXZlbnQgfHwgJycpKSkgcmV0dXJuICdzb2xkJ1xuICAvLyBBbnkgZXhwbGljaXQgd2l0aGRyYXcvZXhwaXJlIGV2ZW50IFx1MjE5MiB3aXRoZHJhd25cbiAgaWYgKGV2ZW50cy5zb21lKGUgPT4gL3dpdGhkcmF3fGV4cGlyZXxjYW5jZWwvaS50ZXN0KGUuZXZlbnQgfHwgJycpKSkgcmV0dXJuICd3aXRoZHJhd24nXG5cbiAgLy8gTG9vayBhdCBob3cgcmVjZW50bHkgdGhlIGxpc3Rpbmcgd2FzIHJlbW92ZWRcbiAgY29uc3QgcmVtb3ZlZERhdGUgPSBsYXRlc3Q/LnJlbW92ZWREYXRlIHx8IGxpc3RpbmcucmVtb3ZlZERhdGVcbiAgaWYgKHJlbW92ZWREYXRlKSB7XG4gICAgY29uc3QgYWdlRGF5cyA9IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShyZW1vdmVkRGF0ZSkuZ2V0VGltZSgpKSAvIDg2NDAwMDAwKVxuICAgIGlmIChhZ2VEYXlzID49IDAgJiYgYWdlRGF5cyA8PSA0NSkgcmV0dXJuICdwZW5kaW5nJyAgIC8vIHJlY2VudCByZW1vdmFsIHdpdGggbm8gc2FsZSBldmVudCA9IG1vc3QgbGlrZWx5IHBlbmRpbmdcbiAgICBpZiAoYWdlRGF5cyA+IDQ1KSByZXR1cm4gJ29mZl9tYXJrZXQnXG4gIH1cbiAgcmV0dXJuICdvZmZfbWFya2V0J1xufVxuXG4vLyBDb21wdXRlIHRoZSBjdW11bGF0aXZlIGRheXMgYSBwcm9wZXJ0eSB3YXMgb24gdGhlIG1hcmtldCBhY3Jvc3MgYWxsIGxpc3Rpbmdcbi8vIGV2ZW50cyAoUmVudENhc3QncyBgZGF5c09uTWFya2V0YCBvbmx5IHJlZmxlY3RzIHRoZSBtb3N0IHJlY2VudCBldmVudCkuXG5mdW5jdGlvbiB0b3RhbERheXNPbk1hcmtldChoaXN0b3J5KSB7XG4gIGlmICghaGlzdG9yeSB8fCB0eXBlb2YgaGlzdG9yeSAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsXG4gIGxldCB0b3RhbCA9IDBcbiAgZm9yIChjb25zdCBldnQgb2YgT2JqZWN0LnZhbHVlcyhoaXN0b3J5KSkge1xuICAgIGlmIChldnQgJiYgZXZ0LmV2ZW50ICYmIC9saXN0L2kudGVzdChldnQuZXZlbnQpICYmIHR5cGVvZiBldnQuZGF5c09uTWFya2V0ID09PSAnbnVtYmVyJykge1xuICAgICAgdG90YWwgKz0gZXZ0LmRheXNPbk1hcmtldFxuICAgIH1cbiAgfVxuICByZXR1cm4gdG90YWwgPiAwID8gdG90YWwgOiBudWxsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVByb3BlcnR5VHlwZShyYXcpIHtcbiAgaWYgKCFyYXcpIHJldHVybiBudWxsXG4gIGNvbnN0IHMgPSBTdHJpbmcocmF3KS50b0xvd2VyQ2FzZSgpXG4gIGlmIChzLmluY2x1ZGVzKCdzaW5nbGUnKSkgcmV0dXJuICdzaW5nbGVfZmFtaWx5J1xuICBpZiAocy5pbmNsdWRlcygnbXVsdGknKSB8fCBzLmluY2x1ZGVzKCdkdXBsZXgnKSB8fCBzLmluY2x1ZGVzKCd0cmlwbGV4JykgfHwgcy5pbmNsdWRlcygncXVhZCcpKSByZXR1cm4gJ211bHRpX2ZhbWlseSdcbiAgaWYgKHMuaW5jbHVkZXMoJ2NvbmRvJykpIHJldHVybiAnY29uZG8nXG4gIGlmIChzLmluY2x1ZGVzKCd0b3duJykpIHJldHVybiAndG93bmhvdXNlJ1xuICBpZiAocy5pbmNsdWRlcygnbGFuZCcpIHx8IHMuaW5jbHVkZXMoJ2xvdCcpKSByZXR1cm4gJ2xhbmQnXG4gIGlmIChzLmluY2x1ZGVzKCdjb21tZXJjJykpIHJldHVybiAnY29tbWVyY2lhbCdcbiAgcmV0dXJuICdvdGhlcidcbn1cblxuLy8gRmV0Y2ggYm90aCBlbmRwb2ludHMgaW4gcGFyYWxsZWwgYW5kIG1lcmdlIGludG8gYSBmbGF0IGVucmljaG1lbnQgb2JqZWN0LlxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hFbnJpY2htZW50Rm9yQWRkcmVzcyhhZGRyZXNzKSB7XG4gIGNvbnN0IGVuYyA9IGVuY29kZVVSSUNvbXBvbmVudChhZGRyZXNzKVxuICBjb25zdCBbcHJvcFJlcywgbHN0UmVzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICByZW50Y2FzdEdldChgL3Byb3BlcnRpZXM/YWRkcmVzcz0ke2VuY31gKSxcbiAgICByZW50Y2FzdEdldChgL2xpc3RpbmdzL3NhbGU/YWRkcmVzcz0ke2VuY31gKSxcbiAgXSlcblxuICBjb25zdCBwcm9wZXJ0eSA9IEFycmF5LmlzQXJyYXkocHJvcFJlcy5qc29uKSA/IHByb3BSZXMuanNvblswXSA6IChwcm9wUmVzLnN0YXR1cyA9PT0gMjAwID8gcHJvcFJlcy5qc29uIDogbnVsbClcbiAgY29uc3QgbGlzdGluZyA9IEFycmF5LmlzQXJyYXkobHN0UmVzLmpzb24pID8gbHN0UmVzLmpzb25bMF0gOiAobHN0UmVzLnN0YXR1cyA9PT0gMjAwID8gbHN0UmVzLmpzb24gOiBudWxsKVxuXG4gIGlmICghcHJvcGVydHkgJiYgIWxpc3RpbmcpIHtcbiAgICByZXR1cm4geyBmb3VuZDogZmFsc2UsIGVycm9yOiAnTm8gZGF0YSBmb3VuZCBmb3IgdGhhdCBhZGRyZXNzLicgfVxuICB9XG5cbiAgLy8gUHJlZmVyIGxpc3RpbmcgZGF0YSBmb3IgdGhlIGxpdmUtc3RhdHVzIGZpZWxkczsgZmFsbCBiYWNrIHRvIHByb3BlcnR5IGZvciBzdGF0aWMgZmllbGRzLlxuICBjb25zdCBzcmMgPSBsaXN0aW5nIHx8IHByb3BlcnR5XG4gIGNvbnN0IG91dCA9IHtcbiAgICBhZGRyZXNzOiBzcmMuYWRkcmVzc0xpbmUxIHx8IHByb3BlcnR5Py5hZGRyZXNzTGluZTEgfHwgbnVsbCxcbiAgICBjaXR5OiBzcmMuY2l0eSB8fCBudWxsLFxuICAgIHN0YXRlOiBzcmMuc3RhdGUgfHwgbnVsbCxcbiAgICB6aXBfY29kZTogc3JjLnppcENvZGUgfHwgbnVsbCxcbiAgICBwcm9wZXJ0eV90eXBlOiBub3JtYWxpemVQcm9wZXJ0eVR5cGUoc3JjLnByb3BlcnR5VHlwZSksXG4gICAgYmVkcm9vbXM6IHNyYy5iZWRyb29tcyA/PyBwcm9wZXJ0eT8uYmVkcm9vbXMgPz8gbnVsbCxcbiAgICBiYXRocm9vbXM6IHNyYy5iYXRocm9vbXMgPz8gcHJvcGVydHk/LmJhdGhyb29tcyA/PyBudWxsLFxuICAgIHNxZnQ6IHNyYy5zcXVhcmVGb290YWdlID8/IHByb3BlcnR5Py5zcXVhcmVGb290YWdlID8/IG51bGwsXG4gICAgbG90X3NpemVfc3FmdDogc3JjLmxvdFNpemUgPz8gcHJvcGVydHk/LmxvdFNpemUgPz8gbnVsbCxcbiAgICB5ZWFyX2J1aWx0OiBzcmMueWVhckJ1aWx0ID8/IHByb3BlcnR5Py55ZWFyQnVpbHQgPz8gbnVsbCxcbiAgICBoYXNfZ2FyYWdlOiBwcm9wZXJ0eT8uZmVhdHVyZXM/LmdhcmFnZSA/PyBudWxsLFxuICB9XG5cbiAgaWYgKGxpc3RpbmcpIHtcbiAgICBvdXQubWxzX3N0YXR1cyAgICAgID0gaW5mZXJNbHNTdGF0dXMobGlzdGluZylcbiAgICAvLyBQcmVmZXIgdG90YWwtYWNyb3NzLWhpc3RvcnkgaWYgdGhlcmUgYXJlIG11bHRpcGxlIGxpc3RpbmcgZXZlbnRzO1xuICAgIC8vIGZhbGwgYmFjayB0byB0aGUgQVBJJ3MgZGF5c09uTWFya2V0IGZvciB0aGUgbW9zdCByZWNlbnQgb25lLlxuICAgIG91dC5kYXlzX29uX21hcmtldCAgPSB0b3RhbERheXNPbk1hcmtldChsaXN0aW5nLmhpc3RvcnkpID8/IGxpc3RpbmcuZGF5c09uTWFya2V0ID8/IG51bGxcbiAgICBvdXQubGlzdF9wcmljZSAgICAgID0gbGlzdGluZy5wcmljZSA/PyBudWxsXG4gICAgb3V0LmFza2luZ19wcmljZSAgICA9IGxpc3RpbmcucHJpY2UgPz8gbnVsbCAgIC8vIGFsc28gbWlycm9yIHRvIGFza2luZ19wcmljZSBmb3IgVVhcbiAgICBvdXQubGlzdF9kYXRlICAgICAgID0gbGlzdGluZy5saXN0ZWREYXRlID8gbGlzdGluZy5saXN0ZWREYXRlLnNsaWNlKDAsIDEwKSA6IG51bGxcbiAgICBvdXQubWxzX251bWJlciAgICAgID0gbGlzdGluZy5tbHNOdW1iZXIgPz8gbnVsbFxuICAgIG91dC5saXN0aW5nX2FnZW50X25hbWUgID0gbGlzdGluZy5saXN0aW5nQWdlbnQ/Lm5hbWUgPz8gbnVsbFxuICAgIG91dC5saXN0aW5nX2FnZW50X3Bob25lID0gbGlzdGluZy5saXN0aW5nQWdlbnQ/LnBob25lID8/IG51bGxcbiAgICBvdXQubGlzdGluZ19hZ2VudF9lbWFpbCA9IGxpc3RpbmcubGlzdGluZ0FnZW50Py5lbWFpbCA/PyBudWxsXG4gICAgb3V0Lmxpc3RpbmdfYnJva2VyYWdlICAgPSBsaXN0aW5nLmxpc3RpbmdPZmZpY2U/Lm5hbWUgPz8gbnVsbFxuICAgIG91dC5yZW50Y2FzdF9saXN0aW5nX2lkID0gbGlzdGluZy5pZCA/PyBudWxsXG4gIH0gZWxzZSB7XG4gICAgLy8gTm8gYWN0aXZlIGxpc3RpbmcgXHUyMTkyIG9mZi1tYXJrZXRcbiAgICBvdXQubWxzX3N0YXR1cyA9ICdvZmZfbWFya2V0J1xuICB9XG5cbiAgaWYgKHByb3BlcnR5KSB7XG4gICAgb3V0LnJlbnRjYXN0X3Byb3BlcnR5X2lkICAgPSBwcm9wZXJ0eS5pZCA/PyBudWxsXG4gICAgb3V0Lm93bmVyX25hbWUgICAgICAgICAgICAgPSBwcm9wZXJ0eS5vd25lcj8ubmFtZXM/LlswXSA/PyBudWxsXG4gICAgb3V0Lm93bmVyX21haWxpbmdfYWRkcmVzcyAgPSBwcm9wZXJ0eS5vd25lcj8ubWFpbGluZ0FkZHJlc3M/LmZvcm1hdHRlZEFkZHJlc3MgPz8gbnVsbFxuICAgIG91dC5vd25lcl9sYXN0X3NhbGVfZGF0ZSAgID0gcHJvcGVydHkubGFzdFNhbGVEYXRlID8gcHJvcGVydHkubGFzdFNhbGVEYXRlLnNsaWNlKDAsIDEwKSA6IG51bGxcbiAgICBvdXQub3duZXJfbGFzdF9zYWxlX3ByaWNlICA9IHByb3BlcnR5Lmxhc3RTYWxlUHJpY2UgPz8gbnVsbFxuICB9XG5cbiAgLy8gUmF3IHBheWxvYWQgKGZvciBkZWJ1Z2dpbmcgLyBmdXR1cmUgZmllbGRzKSBzdG9yZWQgYXMganNvbmIuXG4gIG91dC5lbnJpY2htZW50X2RhdGEgPSB7IHByb3BlcnR5OiBwcm9wZXJ0eSB8fCBudWxsLCBsaXN0aW5nOiBsaXN0aW5nIHx8IG51bGwsIGZldGNoZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9XG4gIG91dC5lbnJpY2hlZF9hdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICBvdXQubWxzX2xhc3RfY2hlY2tlZCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiB7IGZvdW5kOiB0cnVlLCAuLi5vdXQgfVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgU3VwYWJhc2UgaGVscGVycyAoTWFuYWdlbWVudCBBUEkgXHUyMDE0IGJ5cGFzc2VzIFJMUykgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbmFzeW5jIGZ1bmN0aW9uIHNxbChxdWVyeSkge1xuICBpZiAoIVNVUEFCQVNFX1BBVCkgdGhyb3cgbmV3IEVycm9yKCdTVVBBQkFTRV9QQVQgbm90IGNvbmZpZ3VyZWQnKVxuICBjb25zdCByID0gYXdhaXQgZmV0Y2goYGh0dHBzOi8vYXBpLnN1cGFiYXNlLmNvbS92MS9wcm9qZWN0cy8ke1NVUEFCQVNFX1BST0pFQ1RfUkVGfS9kYXRhYmFzZS9xdWVyeWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtTVVBBQkFTRV9QQVR9YCwgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnkgfSksXG4gIH0pXG4gIGNvbnN0IHRleHQgPSBhd2FpdCByLnRleHQoKVxuICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcihgU1FMIGVycm9yICR7ci5zdGF0dXN9OiAke3RleHR9YClcbiAgdHJ5IHsgcmV0dXJuIEpTT04ucGFyc2UodGV4dCkgfSBjYXRjaCAoXykgeyByZXR1cm4gW10gfVxufVxuXG5mdW5jdGlvbiBzcWxTdHJpbmcodikge1xuICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiAnTlVMTCdcbiAgcmV0dXJuIGAnJHtTdHJpbmcodikucmVwbGFjZSgvJy9nLCBcIicnXCIpfSdgXG59XG5mdW5jdGlvbiBzcWxOdW1iZXIodikge1xuICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQgfHwgdiA9PT0gJycpIHJldHVybiAnTlVMTCdcbiAgY29uc3QgbiA9IE51bWJlcih2KVxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gU3RyaW5nKG4pIDogJ05VTEwnXG59XG5mdW5jdGlvbiBzcWxCb29sKHYpIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ05VTEwnXG4gIHJldHVybiB2ID8gJ3RydWUnIDogJ2ZhbHNlJ1xufVxuZnVuY3Rpb24gc3FsSnNvbih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICdOVUxMJ1xuICByZXR1cm4gYCR7c3FsU3RyaW5nKEpTT04uc3RyaW5naWZ5KHYpKX06Ompzb25iYFxufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRMZWFkKGxlYWRJZCkge1xuICBjb25zdCByb3dzID0gYXdhaXQgc3FsKGBzZWxlY3QgKiBmcm9tIHB1YmxpYy5sZWFkcyB3aGVyZSBpZCA9ICcke2xlYWRJZC5yZXBsYWNlKC8nL2csIFwiJydcIil9JyBsaW1pdCAxYClcbiAgcmV0dXJuIHJvd3NbMF0gfHwgbnVsbFxufVxuXG4vLyBSZXR1cm5zIHRoZSBtbHNfcGF1c2VkIGZsYWcgZm9yIHRoZSB3b3Jrc3BhY2UgKG9yIGZvciB0aGUgbGVhZCdzIHdvcmtzcGFjZSkuXG4vLyBUcnVlIG1lYW5zOiBkbyBub3QgbWFrZSBhbnkgUmVudENhc3QgY2FsbHM7IHJldHVybiBlYXJseSBldmVyeXdoZXJlLlxuYXN5bmMgZnVuY3Rpb24gaXNNbHNQYXVzZWQod29ya3NwYWNlSWQpIHtcbiAgaWYgKCF3b3Jrc3BhY2VJZCkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHNhZmUgPSB3b3Jrc3BhY2VJZC5yZXBsYWNlKC8nL2csIFwiJydcIilcbiAgY29uc3Qgcm93cyA9IGF3YWl0IHNxbChgc2VsZWN0IChzZXR0aW5ncy0+PidtbHNfcGF1c2VkJyk6OmJvb2xlYW4gYXMgcGF1c2VkIGZyb20gcHVibGljLndvcmtzcGFjZXMgd2hlcmUgaWQgPSAnJHtzYWZlfScgbGltaXQgMWApXG4gIHJldHVybiAhIXJvd3NbMF0/LnBhdXNlZFxufVxuXG5hc3luYyBmdW5jdGlvbiBwYXRjaExlYWRXaXRoRW5yaWNobWVudChsZWFkLCBlKSB7XG4gIC8vIE5ldmVyIG92ZXJ3cml0ZSBtYW51YWxseS1lZGl0ZWQgY29udGFjdCBmaWVsZHM7IG9ubHkgZmlsbCBpZiBibGFuay5cbiAgY29uc3QgdXBkYXRlcyA9IFtdXG4gIGNvbnN0IHNldElmID0gKGNvbCwgdmFsLCBtb2RlID0gJ2Fsd2F5cycpID0+IHtcbiAgICBpZiAodmFsID09PSBudWxsIHx8IHZhbCA9PT0gdW5kZWZpbmVkKSByZXR1cm5cbiAgICBpZiAobW9kZSA9PT0gJ2lmX2VtcHR5JyAmJiBsZWFkW2NvbF0gIT0gbnVsbCAmJiBsZWFkW2NvbF0gIT09ICcnKSByZXR1cm5cbiAgICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHVwZGF0ZXMucHVzaChgJHtjb2x9ID0gJHtzcWxOdW1iZXIodmFsKX1gKVxuICAgIGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdib29sZWFuJykgdXBkYXRlcy5wdXNoKGAke2NvbH0gPSAke3NxbEJvb2wodmFsKX1gKVxuICAgIGVsc2UgdXBkYXRlcy5wdXNoKGAke2NvbH0gPSAke3NxbFN0cmluZyh2YWwpfWApXG4gIH1cbiAgLy8gTGl2ZSBmaWVsZHMgXHUyMDE0IGFsd2F5cyByZWZyZXNoXG4gIHNldElmKCdtbHNfc3RhdHVzJywgZS5tbHNfc3RhdHVzKVxuICBzZXRJZignbWxzX2xhc3RfY2hlY2tlZCcsIGUubWxzX2xhc3RfY2hlY2tlZClcbiAgc2V0SWYoJ2xpc3RfcHJpY2UnLCBlLmxpc3RfcHJpY2UpXG4gIHNldElmKCdsaXN0X2RhdGUnLCBlLmxpc3RfZGF0ZSlcbiAgc2V0SWYoJ2RheXNfb25fbWFya2V0JywgZS5kYXlzX29uX21hcmtldClcbiAgc2V0SWYoJ21sc19udW1iZXInLCBlLm1sc19udW1iZXIpXG4gIHNldElmKCdsaXN0aW5nX2FnZW50X25hbWUnLCBlLmxpc3RpbmdfYWdlbnRfbmFtZSlcbiAgc2V0SWYoJ2xpc3RpbmdfYWdlbnRfcGhvbmUnLCBlLmxpc3RpbmdfYWdlbnRfcGhvbmUpXG4gIHNldElmKCdsaXN0aW5nX2FnZW50X2VtYWlsJywgZS5saXN0aW5nX2FnZW50X2VtYWlsKVxuICBzZXRJZignbGlzdGluZ19icm9rZXJhZ2UnLCBlLmxpc3RpbmdfYnJva2VyYWdlKVxuICBzZXRJZigncmVudGNhc3RfbGlzdGluZ19pZCcsIGUucmVudGNhc3RfbGlzdGluZ19pZClcbiAgc2V0SWYoJ3JlbnRjYXN0X3Byb3BlcnR5X2lkJywgZS5yZW50Y2FzdF9wcm9wZXJ0eV9pZClcbiAgc2V0SWYoJ2VucmljaGVkX2F0JywgZS5lbnJpY2hlZF9hdClcbiAgLy8gQ29weSBsaXN0aW5nLWFnZW50IGNvbnRhY3QgaW50byB0aGUgcHJpbWFyeSBDb250YWN0IHNlY3Rpb24sIGJ1dCBPTkxZXG4gIC8vIGlmIHRob3NlIGZpZWxkcyBhcmUgc3RpbGwgYmxhbmsgKHByZXNlcnZlcyB3aG9sZXNhbGVyIC8gRlNCTyBlZGl0cykuXG4gIGlmIChlLmxpc3RpbmdfYWdlbnRfbmFtZSkge1xuICAgIGNvbnN0IHNlbGxlckxhYmVsID0gZS5saXN0aW5nX2Jyb2tlcmFnZVxuICAgICAgPyBgJHtlLmxpc3RpbmdfYWdlbnRfbmFtZX0gKCR7ZS5saXN0aW5nX2Jyb2tlcmFnZX0pYFxuICAgICAgOiBlLmxpc3RpbmdfYWdlbnRfbmFtZVxuICAgIHNldElmKCdzZWxsZXJfbmFtZScsIHNlbGxlckxhYmVsLCAnaWZfZW1wdHknKVxuICB9XG4gIHNldElmKCdwaG9uZScsIGUubGlzdGluZ19hZ2VudF9waG9uZSwgJ2lmX2VtcHR5JylcbiAgc2V0SWYoJ2VtYWlsJywgZS5saXN0aW5nX2FnZW50X2VtYWlsLCAnaWZfZW1wdHknKVxuICAvLyBEZWZhdWx0IGxlYWRfc291cmNlIHRvICdtbHMnIGlmIG5vbmUgc2V0IGFuZCB3ZSBmb3VuZCBhIGxpc3RpbmdcbiAgaWYgKGUucmVudGNhc3RfbGlzdGluZ19pZCkgc2V0SWYoJ2xlYWRfc291cmNlJywgJ21scycsICdpZl9lbXB0eScpXG5cbiAgLy8gU3RhdGljLWlzaCBmaWVsZHMgXHUyMDE0IGZpbGwgaWYgZW1wdHkgKGRvbid0IG92ZXJ3cml0ZSBodW1hbiBlZGl0cylcbiAgc2V0SWYoJ2NpdHknLCBlLmNpdHksICdpZl9lbXB0eScpXG4gIHNldElmKCdzdGF0ZScsIGUuc3RhdGUsICdpZl9lbXB0eScpXG4gIHNldElmKCd6aXBfY29kZScsIGUuemlwX2NvZGUsICdpZl9lbXB0eScpXG4gIHNldElmKCdwcm9wZXJ0eV90eXBlJywgZS5wcm9wZXJ0eV90eXBlLCAnaWZfZW1wdHknKVxuICBzZXRJZignYmVkcm9vbXMnLCBlLmJlZHJvb21zLCAnaWZfZW1wdHknKVxuICBzZXRJZignYmF0aHJvb21zJywgZS5iYXRocm9vbXMsICdpZl9lbXB0eScpXG4gIHNldElmKCdzcWZ0JywgZS5zcWZ0LCAnaWZfZW1wdHknKVxuICBzZXRJZignbG90X3NpemVfc3FmdCcsIGUubG90X3NpemVfc3FmdCwgJ2lmX2VtcHR5JylcbiAgc2V0SWYoJ3llYXJfYnVpbHQnLCBlLnllYXJfYnVpbHQsICdpZl9lbXB0eScpXG4gIHNldElmKCdoYXNfZ2FyYWdlJywgZS5oYXNfZ2FyYWdlLCAnaWZfZW1wdHknKVxuICBzZXRJZignYXNraW5nX3ByaWNlJywgZS5hc2tpbmdfcHJpY2UsICdpZl9lbXB0eScpXG4gIHNldElmKCdvd25lcl9uYW1lJywgZS5vd25lcl9uYW1lLCAnaWZfZW1wdHknKVxuICBzZXRJZignb3duZXJfbWFpbGluZ19hZGRyZXNzJywgZS5vd25lcl9tYWlsaW5nX2FkZHJlc3MsICdpZl9lbXB0eScpXG4gIHNldElmKCdvd25lcl9sYXN0X3NhbGVfZGF0ZScsIGUub3duZXJfbGFzdF9zYWxlX2RhdGUsICdpZl9lbXB0eScpXG4gIHNldElmKCdvd25lcl9sYXN0X3NhbGVfcHJpY2UnLCBlLm93bmVyX2xhc3Rfc2FsZV9wcmljZSwgJ2lmX2VtcHR5JylcblxuICBpZiAoZS5lbnJpY2htZW50X2RhdGEpIHVwZGF0ZXMucHVzaChgZW5yaWNobWVudF9kYXRhID0gJHtzcWxKc29uKGUuZW5yaWNobWVudF9kYXRhKX1gKVxuXG4gIGlmICh1cGRhdGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGxlYWRcbiAgY29uc3Qgc2V0Q2xhdXNlID0gdXBkYXRlcy5qb2luKCcsICcpXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBzcWwoXG4gICAgYHVwZGF0ZSBwdWJsaWMubGVhZHMgc2V0ICR7c2V0Q2xhdXNlfSB3aGVyZSBpZCA9ICcke2xlYWQuaWQucmVwbGFjZSgvJy9nLCBcIicnXCIpfScgcmV0dXJuaW5nICpgXG4gIClcbiAgcmV0dXJuIHVwZGF0ZWRbMF0gfHwgbGVhZFxufVxuXG5mdW5jdGlvbiBidWlsZEFjdGl2aXR5Q29udGVudChlKSB7XG4gIGNvbnN0IHBhcnRzID0gW11cbiAgcGFydHMucHVzaChgbWxzPSR7ZS5tbHNfc3RhdHVzIHx8ICd1bmtub3duJ31gKVxuICBpZiAodHlwZW9mIGUuZGF5c19vbl9tYXJrZXQgPT09ICdudW1iZXInKSBwYXJ0cy5wdXNoKGBET009JHtlLmRheXNfb25fbWFya2V0fWApXG4gIGlmIChlLmxpc3RfcHJpY2UpIHBhcnRzLnB1c2goYGxpc3Q9JCR7TnVtYmVyKGUubGlzdF9wcmljZSkudG9Mb2NhbGVTdHJpbmcoKX1gKVxuICBpZiAoZS5saXN0aW5nX2FnZW50X25hbWUpIHtcbiAgICBjb25zdCBhZ2VudEJsdXJiID0gZS5saXN0aW5nX2Jyb2tlcmFnZSA/IGAke2UubGlzdGluZ19hZ2VudF9uYW1lfSAoJHtlLmxpc3RpbmdfYnJva2VyYWdlfSlgIDogZS5saXN0aW5nX2FnZW50X25hbWVcbiAgICBwYXJ0cy5wdXNoKGBhZ2VudD0ke2FnZW50Qmx1cmJ9YClcbiAgfVxuICBpZiAoZS5saXN0aW5nX2FnZW50X3Bob25lKSBwYXJ0cy5wdXNoKGBcdTI2MEUgJHtlLmxpc3RpbmdfYWdlbnRfcGhvbmV9YClcbiAgcmV0dXJuIGBcdTI3MjggRW5yaWNoZWQgZnJvbSBSZW50Q2FzdCBcdTIwMTQgJHtwYXJ0cy5qb2luKCcgXHUwMEI3ICcpfWBcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9nRW5yaWNobWVudChsZWFkSWQsIGNvbnRlbnQpIHtcbiAgY29uc3Qgc2FmZSA9IGNvbnRlbnQucmVwbGFjZSgvJy9nLCBcIicnXCIpXG4gIGF3YWl0IHNxbChcbiAgICBgaW5zZXJ0IGludG8gcHVibGljLmxlYWRfYWN0aXZpdGllcyAobGVhZF9pZCwgdHlwZSwgY29udGVudCkgdmFsdWVzICgnJHtsZWFkSWQucmVwbGFjZSgvJy9nLCBcIicnXCIpfScsICdlbnJpY2htZW50JywgJyR7c2FmZX0nKWBcbiAgKVxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2dTdGF0dXNDaGFuZ2UobGVhZElkLCBvbGRTdGF0dXMsIG5ld1N0YXR1cykge1xuICBjb25zdCBhID0gb2xkU3RhdHVzIHx8ICd1bmtub3duJ1xuICBjb25zdCBiID0gbmV3U3RhdHVzIHx8ICd1bmtub3duJ1xuICBjb25zdCBzYWZlID0gYFx1RDgzQ1x1REZGNyBNTFMgc3RhdHVzIGNoYW5nZWQ6ICR7YX0gXHUyMTkyICR7Yn1gLnJlcGxhY2UoLycvZywgXCInJ1wiKVxuICBhd2FpdCBzcWwoXG4gICAgYGluc2VydCBpbnRvIHB1YmxpYy5sZWFkX2FjdGl2aXRpZXMgKGxlYWRfaWQsIHR5cGUsIGNvbnRlbnQpIHZhbHVlcyAoJyR7bGVhZElkLnJlcGxhY2UoLycvZywgXCInJ1wiKX0nLCAnc3RhdHVzX2NoYW5nZScsICcke3NhZmV9JylgXG4gIClcbn1cblxuLy8gXHUyNTAwXHUyNTAwIFB1YmxpYyBoYW5kbGVycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQWRkcmVzc0xvb2t1cChhZGRyZXNzLCB3b3Jrc3BhY2VJZCkge1xuICBpZiAoYXdhaXQgaXNNbHNQYXVzZWQod29ya3NwYWNlSWQpKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAyMDAsIGJvZHk6IHsgb2s6IGZhbHNlLCBwYXVzZWQ6IHRydWUsIGVycm9yOiAnUmVudENhc3QgZW5yaWNobWVudCBpcyBwYXVzZWQgZm9yIHRoaXMgd29ya3NwYWNlLiBSZS1lbmFibGUgaW4gU2V0dGluZ3MgXHUyMTkyIE1MUyBBdXRvLVJlZnJlc2guJyB9IH1cbiAgfVxuICBjb25zdCBlID0gYXdhaXQgZmV0Y2hFbnJpY2htZW50Rm9yQWRkcmVzcyhhZGRyZXNzKVxuICBpZiAoIWUuZm91bmQpIHtcbiAgICByZXR1cm4geyBzdGF0dXM6IDQwNCwgYm9keTogeyBvazogZmFsc2UsIGVycm9yOiBlLmVycm9yIH0gfVxuICB9XG4gIC8vIFN0cmlwIHRoZSByYXcgcGF5bG9hZCBmcm9tIHRoZSByZXNwb25zZSAodGhlIGZvcm0gZG9lc24ndCBuZWVkIGl0KVxuICBjb25zdCB7IGVucmljaG1lbnRfZGF0YSwgLi4ucmVzdCB9ID0gZVxuICByZXR1cm4geyBzdGF0dXM6IDIwMCwgYm9keTogeyBvazogdHJ1ZSwgLi4ucmVzdCB9IH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlTGVhZEVucmljaChsZWFkSWQsIGZvcmNlKSB7XG4gIGNvbnN0IGxlYWQgPSBhd2FpdCBnZXRMZWFkKGxlYWRJZClcbiAgaWYgKCFsZWFkKSByZXR1cm4geyBzdGF0dXM6IDQwNCwgYm9keTogeyBvazogZmFsc2UsIGVycm9yOiAnTGVhZCBub3QgZm91bmQuJyB9IH1cbiAgaWYgKGF3YWl0IGlzTWxzUGF1c2VkKGxlYWQud29ya3NwYWNlX2lkKSkge1xuICAgIHJldHVybiB7IHN0YXR1czogMjAwLCBib2R5OiB7IG9rOiBmYWxzZSwgcGF1c2VkOiB0cnVlLCBlcnJvcjogJ1JlbnRDYXN0IGVucmljaG1lbnQgaXMgcGF1c2VkIGZvciB0aGlzIHdvcmtzcGFjZS4gUmUtZW5hYmxlIGluIFNldHRpbmdzIFx1MjE5MiBNTFMgQXV0by1SZWZyZXNoLicgfSB9XG4gIH1cbiAgaWYgKCFmb3JjZSAmJiBsZWFkLmVucmljaGVkX2F0KSB7XG4gICAgY29uc3QgYWdlTXMgPSBEYXRlLm5vdygpIC0gbmV3IERhdGUobGVhZC5lbnJpY2hlZF9hdCkuZ2V0VGltZSgpXG4gICAgaWYgKGFnZU1zIDwgMjQgKiAzNjAwICogMTAwMCkge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAyMDAsIGJvZHk6IHsgb2s6IHRydWUsIHNraXBwZWQ6IHRydWUsIHJlYXNvbjogJ0VucmljaGVkIHdpdGhpbiBsYXN0IDI0aCcsIGxlYWQgfSB9XG4gICAgfVxuICB9XG4gIGNvbnN0IGFkZHIgPSBbbGVhZC5hZGRyZXNzLCBsZWFkLmNpdHksIGxlYWQuc3RhdGUsIGxlYWQuemlwX2NvZGVdLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpXG4gIGlmICghYWRkcikgcmV0dXJuIHsgc3RhdHVzOiA0MDAsIGJvZHk6IHsgb2s6IGZhbHNlLCBlcnJvcjogJ0xlYWQgaGFzIG5vIGFkZHJlc3MgdG8gbG9vayB1cC4nIH0gfVxuXG4gIGNvbnN0IGUgPSBhd2FpdCBmZXRjaEVucmljaG1lbnRGb3JBZGRyZXNzKGFkZHIpXG4gIGlmICghZS5mb3VuZCkge1xuICAgIHJldHVybiB7IHN0YXR1czogMjAwLCBib2R5OiB7IG9rOiBmYWxzZSwgZXJyb3I6IGUuZXJyb3IgfSB9XG4gIH1cbiAgY29uc3Qgb2xkU3RhdHVzID0gbGVhZC5tbHNfc3RhdHVzXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwYXRjaExlYWRXaXRoRW5yaWNobWVudChsZWFkLCBlKVxuICBhd2FpdCBsb2dFbnJpY2htZW50KGxlYWQuaWQsIGJ1aWxkQWN0aXZpdHlDb250ZW50KGUpKVxuICBpZiAoZS5tbHNfc3RhdHVzICYmIG9sZFN0YXR1cyAmJiBlLm1sc19zdGF0dXMgIT09IG9sZFN0YXR1cykge1xuICAgIGF3YWl0IGxvZ1N0YXR1c0NoYW5nZShsZWFkLmlkLCBvbGRTdGF0dXMsIGUubWxzX3N0YXR1cylcbiAgfVxuICByZXR1cm4geyBzdGF0dXM6IDIwMCwgYm9keTogeyBvazogdHJ1ZSwgbGVhZDogdXBkYXRlZCB9IH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlU2NoZWR1bGVkU3dlZXAoKSB7XG4gIC8vIFJlZnJlc2ggbm9uLXRlcm1pbmFsIGxlYWRzIHdob3NlIG1sc19sYXN0X2NoZWNrZWQgaXMgbnVsbCBvciA+NGggYWdvLlxuICAvLyBDYXAgYXQgNTAvcnVuIHRvIHN0YXkgdW5kZXIgdGltZW91dHMgYW5kIGF2b2lkIGJ1cm5pbmcgY3JlZGl0cy5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHNxbChgXG4gICAgc2VsZWN0IGlkIGZyb20gcHVibGljLmxlYWRzXG4gICAgd2hlcmUgc3RhdHVzIG5vdCBpbiAoJ3NvbGQnLCdkZWFkX2xlYWQnLCdyZWplY3RlZF9ub3RfYWNjZXB0ZWQnLCdub3RfaW5fYnV5X2JveCcsJ3NlcXVlbmNlX2NvbXBsZXRlZCcpXG4gICAgICBhbmQgKG1sc19sYXN0X2NoZWNrZWQgaXMgbnVsbCBvciBtbHNfbGFzdF9jaGVja2VkIDwgbm93KCkgLSBpbnRlcnZhbCAnNCBob3VycycpXG4gICAgb3JkZXIgYnkgbWxzX2xhc3RfY2hlY2tlZCBhc2MgbnVsbHMgZmlyc3RcbiAgICBsaW1pdCA1MFxuICBgKVxuICBjb25zdCByZXN1bHRzID0geyBwcm9jZXNzZWQ6IDAsIGNoYW5nZWQ6IDAsIGVycm9yczogMCB9XG4gIGZvciAoY29uc3QgciBvZiByb3dzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGhhbmRsZUxlYWRFbnJpY2goci5pZCwgdHJ1ZSlcbiAgICAgIGlmIChyZXMuYm9keT8ub2spIHJlc3VsdHMucHJvY2Vzc2VkKytcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZXN1bHRzLmVycm9ycysrXG4gICAgfVxuICB9XG4gIHJldHVybiB7IHN0YXR1czogMjAwLCBib2R5OiB7IG9rOiB0cnVlLCAuLi5yZXN1bHRzIH0gfVxufVxuXG4vLyBOZXRsaWZ5IGZ1bmN0aW9ucyBoYW5kbGVyXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxKSA9PiB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiAnKicsICdhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzJzogJ2NvbnRlbnQtdHlwZScsICdhY2Nlc3MtY29udHJvbC1hbGxvdy1tZXRob2RzJzogJ1BPU1QsR0VULE9QVElPTlMnIH1cbiAgaWYgKHJlcS5tZXRob2QgPT09ICdPUFRJT05TJykgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7IHN0YXR1czogMjA0LCBoZWFkZXJzIH0pXG5cbiAgdHJ5IHtcbiAgICBpZiAoIVJFTlRDQVNUX0FQSV9LRVkpIHtcbiAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogZmFsc2UsIGVycm9yOiAnUkVOVENBU1RfQVBJX0tFWSBub3QgY29uZmlndXJlZCcgfSksIHsgc3RhdHVzOiA1MDAsIGhlYWRlcnMgfSlcbiAgICB9XG4gICAgaWYgKHJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgICAvLyBTY2hlZHVsZWQgaW52b2NhdGlvblxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgaGFuZGxlU2NoZWR1bGVkU3dlZXAoKVxuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShyZXMuYm9keSksIHsgc3RhdHVzOiByZXMuc3RhdHVzLCBoZWFkZXJzIH0pXG4gICAgfVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcpIHtcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZXEuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpXG4gICAgICBpZiAoYm9keS5hZGRyZXNzICYmICFib2R5LmxlYWRfaWQpIHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgaGFuZGxlQWRkcmVzc0xvb2t1cChib2R5LmFkZHJlc3MsIGJvZHkud29ya3NwYWNlX2lkKVxuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHJlcy5ib2R5KSwgeyBzdGF0dXM6IHJlcy5zdGF0dXMsIGhlYWRlcnMgfSlcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LmxlYWRfaWQpIHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgaGFuZGxlTGVhZEVucmljaChib2R5LmxlYWRfaWQsICEhYm9keS5mb3JjZSlcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShyZXMuYm9keSksIHsgc3RhdHVzOiByZXMuc3RhdHVzLCBoZWFkZXJzIH0pXG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogJ1Byb3ZpZGUgZWl0aGVyIHsgYWRkcmVzcyB9IG9yIHsgbGVhZF9pZCB9JyB9KSwgeyBzdGF0dXM6IDQwMCwgaGVhZGVycyB9KVxuICAgIH1cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogJ01ldGhvZCBub3QgYWxsb3dlZCcgfSksIHsgc3RhdHVzOiA0MDUsIGhlYWRlcnMgfSlcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIHx8IFN0cmluZyhlcnIpIH0pLCB7IHN0YXR1czogNTAwLCBoZWFkZXJzIH0pXG4gIH1cbn1cblxuLy8gTm90ZTogdGhpcyBpcyBhbiBIVFRQLWNhbGxhYmxlIGZ1bmN0aW9uIFx1MjAxNCBubyBgY29uZmlnLnNjaGVkdWxlYCBoZXJlLlxuLy8gVG8gdHJpZ2dlciB0aGUgYmF0Y2ggc3dlZXAgb24gYSBzY2hlZHVsZSwgZWl0aGVyOlxuLy8gICAxKSBhZGQgYSBzZXBhcmF0ZSBzY2hlZHVsZWQgZnVuY3Rpb24gdGhhdCBQT1NUcyB0byB0aGlzIGVuZHBvaW50LCBvclxuLy8gICAyKSBwb2ludCBhbiBleHRlcm5hbCBjcm9uIChjcm9uLWpvYi5vcmcsIFN1cGFiYXNlIHBnX2Nyb24pIGF0IEdFVCAvZW5yaWNoLWxlYWQuXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBa0JBLElBQU0sZ0JBQWdCO0FBR3RCLElBQU0sbUJBQW1CLFFBQVEsSUFBSTtBQUNyQyxJQUFNLGVBQWUsUUFBUSxJQUFJLGdCQUFnQjtBQUNqRCxJQUFNLHVCQUF1QixRQUFRLElBQUksd0JBQXdCO0FBQ2pFLElBQU0sZUFBZSxRQUFRLElBQUk7QUFJakMsZUFBZSxZQUFZLE1BQU07QUFDL0IsUUFBTSxNQUFNLEdBQUcsYUFBYSxHQUFHLElBQUk7QUFDbkMsUUFBTSxJQUFJLE1BQU0sTUFBTSxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsa0JBQWtCLFFBQVEsbUJBQW1CLEVBQUUsQ0FBQztBQUNyRyxRQUFNLE9BQU8sTUFBTSxFQUFFLEtBQUs7QUFDMUIsTUFBSSxPQUFPO0FBQ1gsTUFBSTtBQUFFLFdBQU8sS0FBSyxNQUFNLElBQUk7QUFBQSxFQUFFLFNBQVMsR0FBRztBQUFBLEVBQUM7QUFDM0MsU0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLE1BQU0sS0FBSyxLQUFLO0FBQzdDO0FBRUEsU0FBUyxzQkFBc0Is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QU8sSUFBSSxTQUFTLE1BQU0sRUFBRSxRQUFRLEtBQUssUUFBUSxDQUFDO0FBRWhGLE1BQUk7QUFDRixRQUFJLENBQUMsa0JBQWtCO0FBQ3JCLGFBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLElBQUksT0FBTyxPQUFPLGtDQUFrQyxDQUFDLEdBQUcsRUFBRSxRQUFRLEtBQUssUUFBUSxDQUFDO0FBQUEsSUFDdkg7QUFDQSxRQUFJLElBQUksV0FBVyxPQUFPO0FBRXhCLFlBQU0sTUFBTSxNQUFNLHFCQUFxQjtBQUN2QyxhQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsSUFBSSxJQUFJLEdBQUcsRUFBRSxRQUFRLElBQUksUUFBUSxRQUFRLENBQUM7QUFBQSxJQUMvRTtBQUNBLFFBQUksSUFBSSxXQUFXLFFBQVE7QUFDekIsWUFBTSxPQUFPLE1BQU0sSUFBSSxLQUFLLEVBQUUsTUFBTSxPQUFPLENBQUMsRUFBRTtBQUM5QyxVQUFJLEtBQUssV0FBVyxDQUFDLEtBQUssU0FBUztBQUNqQyxjQUFNLE1BQU0sTUFBTSxvQkFBb0IsS0FBSyxTQUFTLEtBQUssWUFBWTtBQUNyRSxlQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsSUFBSSxJQUFJLEdBQUcsRUFBRSxRQUFRLElBQUksUUFBUSxRQUFRLENBQUM7QUFBQSxNQUMvRTtBQUNBLFVBQUksS0FBSyxTQUFTO0FBQ2hCLGNBQU0sTUFBTSxNQUFNLGlCQUFpQixLQUFLLFNBQVMsQ0FBQyxDQUFDLEtBQUssS0FBSztBQUM3RCxlQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsSUFBSSxJQUFJLEdBQUcsRUFBRSxRQUFRLElBQUksUUFBUSxRQUFRLENBQUM7QUFBQSxNQUMvRTtBQUNBLGFBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLElBQUksT0FBTyxPQUFPLDRDQUE0QyxDQUFDLEdBQUcsRUFBRSxRQUFRLEtBQUssUUFBUSxDQUFDO0FBQUEsSUFDakk7QUFDQSxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxJQUFJLE9BQU8sT0FBTyxxQkFBcUIsQ0FBQyxHQUFHLEVBQUUsUUFBUSxLQUFLLFFBQVEsQ0FBQztBQUFBLEVBQzFHLFNBQVMsS0FBSztBQUNaLFdBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLElBQUksT0FBTyxPQUFPLElBQUksV0FBVyxPQUFPLEdBQUcsRUFBRSxDQUFDLEdBQUcsRUFBRSxRQUFRLEtBQUssUUFBUSxDQUFDO0FBQUEsRUFDaEg7QUFDRjsiLAogICJuYW1lcyI6IFtdCn0K
