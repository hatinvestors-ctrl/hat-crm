# Distressed Acquisition Source Discovery — Jacksonville / Duval County

**Cycle 3 — Capability #8. Discovery only.** No connector was built, no HatCRM/hat-ai-agents code was
modified, no database was touched, no UI was built. This document verifies real, currently-accessible
Duval County / City of Jacksonville data sources via live web search (August 2026) and cross-references
them against the actual HAT architecture already built in this codebase.

**Verification method — read this before trusting any claim below:**
- Facts about **existing HAT architecture** (Acquisition Engine, NormalizedProperty, Property
  Intelligence, importLead, Action Center) are verified directly from this codebase and the
  `hat-ai-agents` sibling repo — cited to the same files used throughout Cycles 2–3.
- Facts about **external Duval/Jacksonville data sources** are verified via live web search against
  official `.gov`/`.duvalclerk.com`/ArcGIS domains where possible, with source URLs cited inline. Two
  sources (`jacksonville.gov/.../data-offerings` and the Florida statewide cadastral ArcGIS
  FeatureServer) were fetched and their actual field lists/formats confirmed directly, not just
  summarized from search snippets.
- Where a claim could **not** be verified externally (e.g. exact case volumes, whether a portal has an
  unlisted API, exact competitive usage by other investors), it is explicitly marked **[INFERENCE]** or
  **[UNVERIFIED — recommend direct confirmation]**. No URL, dataset, or update frequency below was
  invented — anything not found in search results is stated as unknown.

---

## 1. Executive Recommendation

**Build first: the Property Appraiser Real Estate Tax Roll + Sales Data download, combined with the
Duval County Clerk's Official Records lis pendens/foreclosure search, layered under the existing
NormalizedProperty → Acquisition Engine pipeline.**

This isn't a single "best source" — it's two verified, free, county-official sources that together let
HAT (a) get a reliable universe of Duval County property + ownership + valuation data for enrichment,
and (b) surface genuine motivated-seller signals (pre-foreclosure, absentee probate-adjacent ownership)
that don't already flow through Redfin/Zillow. Full reasoning in §4 and the Final Decision at the end.

---

## 2. Ranked Source Matrix

Scores are 1–10. **Business Value** = expected acquisition value to HAT if fully working.
**Automation Feasibility** = how mechanically ingestible the source is without manual research per
record, given what was actually found about each portal's access method.

| # | Source | Distress Signal | Lead Volume | Data Quality | Automation Difficulty | Competition | Cost | Business Value (1-10) | Automation Feasibility (1-10) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Lis Pendens / Pre-Foreclosure (Duval Clerk Official Records) | VERY HIGH | MEDIUM | HIGH (legal record, but requires PDF parsing) | MEDIUM | Widely used by investors **[INFERENCE]** | Free | 9 | 5 |
| 2 | Tax Delinquent (Duval Tax Collector, pre-certificate) | HIGH | MEDIUM–HIGH | MEDIUM (list exists but no confirmed structured download found) | LOW–MEDIUM | Widely used (tax-sale investing is a well-known niche) **[INFERENCE]** | Free (list) | 8 | 4 |
| 3 | Tax Deed Sales / Certificates (LienHub, duval.realtaxdeed.com) | VERY HIGH | LOW–MEDIUM | HIGH (structured auction listing, posted 30 days out) | MEDIUM–HIGH | Moderately used — real-money auction, filters out casual buyers **[INFERENCE]** | Free to view; deposit to bid | 8 | 6 |
| 4 | Foreclosure Auctions (duval.realforeclose.com) | VERY HIGH | LOW–MEDIUM | HIGH (structured auction listing) | MEDIUM–HIGH | Widely used **[INFERENCE]** | Free to view | 7 | 6 |
| 5 | Property Appraiser Real Estate Tax Roll / Sales Data | LOW (not distress by itself) | HIGH (county-wide) | VERY HIGH (verified: structured TXT/Access files, monthly + annual) | HIGH (bulk file, no scraping) | Low direct competition for automated use — mostly used manually **[INFERENCE]** | Free | 6 (enrichment, not a lead source alone) | 9 |
| 6 | Florida Statewide Cadastral / Parcels (ArcGIS FeatureServer) | LOW (not distress by itself) | HIGH (statewide, verified real API) | VERY HIGH (verified: real REST API, owner/address/parcel/valuation/sales fields, JSON) | VERY HIGH | Low — this is an underused public API **[INFERENCE]** | Free | 6 (enrichment, not a lead source alone) | 10 |
| 7 | Code Enforcement Violations (City of Jacksonville MCCD) | HIGH | UNKNOWN — no public searchable database found | UNKNOWN | LOW (no public bulk/API found; public-records-request only) | Less obvious / underutilized **[INFERENCE]**, precisely because it's hard to access | Free (public records request) | 7 | 2 |
| 8 | Probate Records (Duval Clerk) | HIGH | UNKNOWN | LOW (many fields confidential; requires registered account, some in-person only) | LOW | Widely known concept, but access friction likely limits automated competitors **[INFERENCE]** | Free to search; $2/name for mail requests | 8 | 2 |
| 9 | Eviction Filings (Duval Clerk civil case search) | MEDIUM | UNKNOWN | MEDIUM (case search exists, structured court data) | LOW–MEDIUM | Less commonly automated **[INFERENCE]** | Free | 5 | 3 |
| 10 | Vacant / Foreclosure Property Registry (City of Jacksonville) | MEDIUM–HIGH | UNKNOWN — registry is compliance-driven, not know to be public-searchable | LOW (email-based intake found, `Jacksonville@vacantregistry.com`; no public list found) | LOW | Underutilized — registry isn't built for investor lookup **[INFERENCE]** | Free (if a public list exists) / Unknown | 6 | 2 |
| 11 | Municipal / Nuisance / Demolition Liens (City of Jacksonville) | MEDIUM–HIGH | UNKNOWN | LOW (policy document found; no searchable database found) | LOW | Underutilized **[INFERENCE]** | Free (public records request) | 6 | 2 |
| 12 | Water/Utility Delinquency (JEA) | MEDIUM | UNKNOWN — JEA reports aggregate delinquency ($19M citywide) but no address-level public list found | LOW (no public per-property list found; billing data is customer-private) | LOW (no public access path found) | N/A — likely not accessible at all without a data-sharing agreement | Unknown / likely not public | 4 | 1 |
| 13 | Commercial aggregators (PropStream, BatchLeads) | HIGH (pre-combined: absentee + tax delinquent + vacant + high equity in one pull) | HIGH | HIGH (verified: real products, real feature sets, real pricing found) | HIGH (paid API/export access, not scraping county sites individually) | Widely used by investors — this is their whole business model **[INFERENCE, but strongly evidenced]** | Paid — PropStream from **$99/mo**, BatchLeads CRM+Data from **$299/mo** (verified via search) | 7 | 8 |

**Overall Priority (highest expected value × feasible automation, in order):**
1. Property Appraiser Real Estate Tax Roll + Florida Statewide Cadastral API (enrichment backbone — do this regardless of which distress source comes first, because every other source needs it)
2. Lis Pendens / Pre-Foreclosure (Duval Clerk Official Records)
3. Tax Deed Sales (structured, predictable, verified auction calendar)
4. Commercial aggregator (PropStream/BatchLeads) as a fast-follow if in-house parsing of #2 proves too slow to build
5. Code Violations / Probate / Vacant Registry — real signal, but no confirmed automatable access path today; revisit after a manual records request clarifies what's actually obtainable

---

## 3. Source Detail — A Through K

### 3.1 Lis Pendens / Pre-Foreclosure
- **A. Data owner:** Duval County Clerk of Courts.
- **B. Access method:** Web search portal at `or.duvalclerk.com` — searchable by grantor/grantee name, document type, date, book/page, instrument number. Verified: portal exists and supports document-type filtering (lis pendens is a recordable document type). **[UNVERIFIED]** whether an API or bulk export exists — search results describe search-portal UI only; a direct fetch of the portal timed out/was refused in this session, so its exact query mechanics (pagination, rate limits, JS-rendering) were not confirmed and need direct manual verification.
- **C. Automation potential:** MEDIUM. Public search UI is real and free, but likely requires either scraping a search-results page or a public-records-request relationship for structured exports — needs direct verification before committing engineering time.
- **D. Update frequency: [UNVERIFIED]** — recordings happen continuously (court filings), but no stated refresh cadence for the search portal was found.
- **E. Available fields:** party name (grantor/grantee), instrument number, document type, record date, book/page. Full lis pendens document (PDF) presumably contains case number, property description — **[UNVERIFIED]** whether structured fields beyond the index are exposed without opening each PDF.
- **F. Matching:** By grantor/grantee name (owner) primarily; property address typically must be extracted from the underlying PDF, not the index itself — this is a real enrichment/parsing requirement, not a given.
- **G. Distress value: VERY HIGH.** A lis pendens is the single clearest legal signal of active pre-foreclosure distress — this is the textbook "motivated seller" moment investors chase.
- **H. Lead volume:** UNKNOWN — not stated anywhere found; do not invent a number.
- **I. Competition:** **[INFERENCE]** Widely used — pre-foreclosure lists are one of the most common wholesaler lead sources nationally.
- **J. Cost:** Free to search/view.
- **K. Legal/access considerations:** Public record, but the portal's terms of use for automated/bulk access were not found and should be checked before building a scraper — the mission explicitly prohibits proposing any bypass of technical restrictions, so if the portal has bot protection or requires manual CAPTCHA, that is itself the answer (need a different access path, e.g. a paid aggregator that already licenses this data, or a formal data-sharing request to the Clerk).

### 3.2 Tax Delinquent Properties (pre-certificate-sale)
- **A. Data owner:** Duval County Tax Collector.
- **B. Access method:** Tax Collector publishes information on the certificate-sale process at `taxcollector.jacksonville.gov`; actual certificate sale bidding runs through **LienHub.com** (`lienhub.com/duval`), a third-party platform Duval County uses for its online tax certificate auction. **[UNVERIFIED]** whether LienHub exposes a raw delinquent-property list (pre-auction) in a structured/downloadable format, or only the live auction interface.
- **C. Automation potential:** LOW–MEDIUM — real auction platform exists (good sign), but no confirmed bulk-download/API found in this pass; needs direct portal inspection.
- **D. Update frequency:** Annual cycle — taxes delinquent April 1, certificates sold by June 1 each year (verified). Not a daily/real-time feed.
- **E. Available fields (typical for this type of list, not all individually confirmed):** property address, parcel/APN, amount owed, owner name — **[UNVERIFIED]** exact field list on LienHub specifically.
- **F. Matching:** Parcel/APN is the standard join key for tax data — reliable if exposed.
- **G. Distress value: HIGH** — non-payment of property tax is a strong, quantifiable distress signal, though many delinquent owners cure before certificate sale.
- **H. Lead volume: [UNVERIFIED]** — county-wide delinquency counts weren't found in this pass; Duval is a large county (~350K+ parcels **[INFERENCE, general county-size knowledge, not confirmed this cycle]**) so plausibly hundreds to low thousands annually, but do not treat that as a verified figure.
- **I. Competition: [INFERENCE]** Widely used — "tax delinquent list" is one of the best-known distressed-lead categories among investors nationally, including in Jacksonville specifically (multiple SEO-targeted investor sites already reference "Duval County Tax Delinquent Property List").
- **J. Cost:** Free to view the process/list; bidding requires a deposit.
- **K. Legal/access considerations:** Public process; LienHub's terms of use for automated access weren't found and should be checked directly.

### 3.3 Tax Deed Sales (duval.realtaxdeed.com)
- **A. Data owner:** Duval County Clerk of Courts (auction hosted on RealAuction's `realtaxdeed.com` platform).
- **B. Access method:** Public auction website; Clerk posts the sale date and property list **30 days before the auction** (verified).
- **C. Automation potential:** MEDIUM–HIGH — this is a structured, third-party auction platform (RealAuction runs these for many Florida counties), which typically means a consistent page structure, making list extraction more tractable than a generic county PDF archive. **[UNVERIFIED]** whether RealAuction exposes any feed/export beyond the browsable list.
- **D. Update frequency:** Per-auction (verified: typically Wednesdays), with the property list posted 30 days ahead — effectively a predictable weekly/bi-weekly cadence.
- **E. Available fields:** opening bid (= back taxes + interest + fees, verified formula), sale date — property address/parcel presumably listed per auction item, redemption status.
- **F. Matching:** Parcel/APN, standard for tax deed records.
- **G. Distress value: VERY HIGH** — by definition, a tax deed sale is a property about to change ownership due to unresolved debt; the ultimate distress signal, though by auction day the "motivated seller" negotiation window has closed (this is more of a direct-acquisition source than a seller-outreach source).
- **H. Lead volume: [UNVERIFIED]** — no count found.
- **I. Competition: [INFERENCE]** Moderately competitive — real capital and deposit requirements filter out casual actors, but experienced tax-deed investors (the LegalClarity/TedThomas-style content found suggests an active education/investor niche around this) are actively watching this exact calendar.
- **J. Cost:** Free to view; 5% deposit (or $200 minimum) required to bid, per Florida statute (verified).
- **K. Legal/access considerations:** Public auction; scraping a public sale list is generally lower-risk than scraping an authenticated portal, but RealAuction's specific terms of use should be checked before automating.

### 3.4 Foreclosure Auctions (duval.realforeclose.com)
Same platform family as tax deeds (RealAuction), same access-method profile. **G. Distress value: VERY HIGH** for the underlying property, but similarly late-stage (auction day, not pre-negotiation) — better suited to direct-acquisition monitoring than "reach the seller before anyone else" outreach. Case-level detail available via the Clerk's **CORE** (Clerk Online Resource ePortal) per search results — **[UNVERIFIED]** exact CORE access mechanics.

### 3.5 Property Appraiser Real Estate Tax Roll / Sales Data — Verified Directly
- **A. Data owner:** Duval County Property Appraiser (`jacksonville.gov/departments/property-appraiser`).
- **B. Access method: VERIFIED by direct fetch.** Structured downloadable files: Real Estate Tax Roll (Access Database + pipe-delimited TXT), Tangible Personal Property Tax Roll (pipe-delimited TXT), GIS Data (Shapefiles), Sales Data (fixed-format + pipe-delimited TXT). Layout documentation provided for every format. **No public API found** — this is a file-download model, not a query endpoint.
- **C. Automation potential: HIGH** — structured flat files with documented layouts are straightforward to parse programmatically; this is exactly the kind of source a batch ingestion job (not an AI agent) should handle.
- **D. Update frequency: VERIFIED** — monthly uncertified snapshots, one annual certified tax roll (most recent certified data found was dated 10/13/2025).
- **E. Available fields:** full tax roll (owner, address, valuation, land/building characteristics) and sales history — exact column list not enumerated on the page itself (layout docs would need to be downloaded separately), but this is the county's own authoritative record, so field richness should meet or exceed the statewide cadastral fields listed in §3.6 below.
- **F. Matching:** Parcel ID is the master key, consistent across every county dataset (tax roll, sales, GIS).
- **G. Distress value: LOW on its own** — this is baseline property/ownership data, not a distress signal. Its value is as the **enrichment backbone** every distress source above needs (owner mailing address for outreach, valuation for equity estimates, sale history for absentee-owner detection).
- **H. Lead volume:** County-wide — effectively the entire Duval parcel universe.
- **I. Competition: [INFERENCE]** Low direct competition for *automated* use specifically — most investors use this manually via the search UI or through a paid aggregator, not by parsing the raw files.
- **J. Cost:** Free.
- **K. Legal/access considerations:** Public record, explicitly published for download — lowest-risk source on this entire list.

### 3.6 Florida Statewide Cadastral / Parcels (ArcGIS FeatureServer) — Verified Directly
- **A. Data owner:** Florida Department of Revenue (aggregates all 67 county property appraisers), published via the Florida Geospatial Open Data Portal / ArcGIS Online.
- **B. Access method: VERIFIED by direct fetch — this is a real, queryable REST API**, not just a downloadable file: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer`. Standard Esri `Query`/`Extract` REST operations (JSON responses), max 2,000 records per query (32,000 without geometry).
- **C. Automation potential: VERY HIGH** — this is the single most automation-ready source found in this entire discovery. No file parsing, no scraping, no auth found required for read queries — a standard paginated REST client can pull records directly.
- **D. Update frequency: VERIFIED** — annual (county appraisers submit to FDOR every July, per search results), snapshot exported August 2025 for the version fetched.
- **E. Available fields — VERIFIED, full list:** owner name/address/city/state/zip (`OWN_NAME`, `OWN_ADDR1/2`, `OWN_CITY`, `OWN_STATE`, `OWN_ZIPCD`), fiduciary contact fields, physical property address (`PHY_ADDR1/2`, `PHY_CITY`, `PHY_ZIPCD`), parcel ID (`PARCEL_ID`, `ALT_KEY`), legal description, land value/sqft, building characteristics (`EFF_YR_BLT`, `ACT_YR_BLT`, `TOT_LVG_AR`, `NO_BULDNG`, `NO_RES_UNT`), just/assessed/taxable values (`JV`, `AV_SD`, `TV_SD`, homestead variants), **two most recent sales** (`SALE_PRC1/2`, `SALE_YR1/2`, `SALE_MO1/2`, book/page/clerk number), land-use classification, market area, neighborhood code.
- **F. Matching:** `PARCEL_ID` and `PHY_ADDR1` both present on every record — directly joinable to HatCRM's existing `address`/`parcel` concepts without any fuzzy matching.
- **G. Distress value: LOW on its own** (same reasoning as §3.5) — but the **owner mailing address ≠ property address** comparison this dataset enables is itself a real, free **absentee-owner detector** (see Combination Signals, §6) — arguably the single highest-leverage free enrichment field found in this discovery.
- **H. Lead volume:** Statewide, all 67 counties — effectively unlimited for Duval specifically once filtered.
- **I. Competition: [INFERENCE]** Low — this specific statewide ArcGIS endpoint is not the well-known "PropStream" of the industry; it appears to be an underused public resource relative to its data richness.
- **J. Cost:** Free.
- **K. Legal/access considerations:** Explicitly published as open geospatial data with a stated confidentiality carve-out (excludes SSNs and statutorily-exempt owner records, per the portal's own description) — lowest-risk source found, alongside §3.5.

### 3.7 Code Enforcement Violations (City of Jacksonville MCCD)
- **A. Data owner:** City of Jacksonville, Municipal Code Compliance Division (Neighborhoods Department).
- **B. Access method:** No public searchable violations database was found. The verified path is a **public records request** via `records.coj.net`, or phone (904-630-CITY) for case-specific lookups. A separate **Building Inspection Division Online Property Search** exists for permits/COs/building-code details (guest sign-in, address search) — **[UNVERIFIED]** whether this building-permit tool also surfaces MCCD nuisance/property-maintenance violations specifically, since the search results describe it as permit/inspection-focused, and one source explicitly stated city code violations are "not appearing in the county records" and are tracked separately at the city level.
- **C. Automation potential: LOW** — no confirmed bulk/API/download path; would currently require either a recurring public-records-request relationship (not real-time, not self-serve) or manual case-by-case lookup, which does not scale as an automated feed today.
- **D–J:** Mostly UNKNOWN pending direct outreach to MCCD — do not estimate volume or frequency without it.
- **G. Distress value: HIGH** — a documented code violation (especially combined with non-payment/absentee ownership) is a strong neglect/motivation signal.
- **K. Legal/access considerations:** Public record by law, but the *access mechanism* is the bottleneck — worth a direct call/records request to MCCD to ask specifically whether they can provide a recurring structured export, before assuming this is unautomatable.

### 3.8 Probate Records
- **A. Data owner:** Duval County Clerk of Courts, Probate Department.
- **B. Access method:** Online access requires a **registered user account** on the Clerk's portal; some records (inventories, accountings, death certificates) are confidential by statute; older cases (pre-1977) are archive-only/in-person; mail requests cost $2/name searched (all verified).
- **C. Automation potential: LOW** — registration requirement + confidentiality carve-outs + per-search fee structure make this a poor fit for a fully automated recurring pull; more realistic as a periodic, rate-limited, possibly-paid batch process.
- **G. Distress value: HIGH** — inherited property is one of the most reliable "seller has no emotional attachment / wants a fast, low-hassle sale" signals in the industry.
- **H–J:** UNKNOWN volume/frequency; cost is nominal per-search ($2) but that implies this is not designed for bulk pulls.
- **K.** Confidential sub-records must never be requested/exposed — only the public case index (case number, party names, filing dates) is appropriate for an automated feed.

### 3.9 Eviction Filings
- **A. Data owner:** Duval County Clerk of Courts (County Civil division).
- **B. Access method:** Civil case search is described as publicly available (verified: "civil case searches are available for public access to court records, including landlord/tenant actions"), presumably through the same Official Records / CORE search infrastructure used for foreclosure case lookups.
- **C. Automation potential: LOW–MEDIUM** — plausible via the same portal as §3.1, same caveats about unconfirmed API/bulk access.
- **G. Distress value: MEDIUM** — signals landlord (not owner-occupant) distress specifically; useful for identifying burned-out small landlords who may want to exit a portfolio, a distinct and valuable seller profile from owner-occupant distress.
- **H–J:** UNKNOWN.

### 3.10 Vacant / Foreclosure Property Registry (City of Jacksonville)
- **A. Data owner:** City of Jacksonville Neighborhoods Department.
- **B. Access method:** This is a **compliance registry** (mortgagees/owners of vacant or foreclosed property must register and pay a $250 fee, per Ordinance 2018-104-E, verified) — not a public lookup tool. Contact is via `Jacksonville@vacantregistry.com`; no public search/download interface was found.
- **C. Automation potential: LOW** — no public data-access path found; the registry exists to compel compliance from *owners*, not to inform investors.
- **G. Distress value: MEDIUM–HIGH** — vacancy is a strong signal, but this specific registry's data doesn't appear publicly queryable; a records request would be needed to determine if the city can share it.
- **K.** Worth a direct inquiry to the Neighborhoods Department about data-sharing, but do not assume access exists.

### 3.11 Municipal / Nuisance / Demolition Liens
Same profile as §3.7/§3.10 — real, legally significant (a documented "Lien Abatement Policy" was found, confirming liens are actively tracked), but **no public searchable database or bulk-export mechanism was found**. Best handled as a manual/records-request source until proven otherwise.

### 3.12 Water/Utility Delinquency (JEA)
- **Verified:** JEA is the city-owned electric/water/sewer utility; aggregate customer delinquency has been reported publicly (~$19M citywide, one case of a landlord owing ~$498K) via news coverage — but this is **aggregate reporting**, not an address-level public dataset.
- **B. Access method:** **No public per-property delinquency list or API was found.** Billing/account data is customer-private by default; JEA's own published pages describe disconnection policy, not data disclosure.
- **C. Automation potential: LOW**, likely **NOT ACCESSIBLE** without a formal data-sharing agreement with JEA (a public utility, not a court/property-records office) — do not plan around this source without direct confirmation from JEA that any such list is legally shareable.
- **K.** This is the source most likely to run into real legal/privacy limits — utility billing data is generally treated differently from property/court records under Florida public-records law, and this discovery found no evidence it's exposed the way tax/court data is.

### 3.13 Commercial Aggregators (PropStream, BatchLeads) — Verified Directly
- **A. Data owner:** Private data companies (not government) who license/aggregate county-level public records nationally.
- **B. Access method: VERIFIED** — subscription web platforms with list-building, filtering, and (per search results) skip-tracing; BatchLeads specifically advertises a "list stacking" workflow that pre-combines absentee ownership + tax delinquent + vacant + high equity + long ownership tenure into one export — i.e., **someone else has already built several of the Combination Signals in §6**.
- **C. Automation potential: HIGH** — these are commercial products explicitly built for exactly this use case; likely offer CSV export at minimum, and given the existing generic **CSV Import** path already built in HatCRM (Capability #6/#6.1's `importLead()` SDK, source-agnostic by design), a PropStream/BatchLeads export could plug into the existing pipeline with comparatively little new engineering.
- **G. Distress value: HIGH** — pre-combined, pre-filtered, ready to underwrite.
- **J. Cost — VERIFIED:** PropStream starts at **$99/mo**; BatchLeads CRM+Data plan starts at **$299/mo**.
- **K.** Standard commercial terms of service apply (per-seat/per-export licensing); no public-records legal risk since the vendor has already handled sourcing compliance — this shifts risk from "is this legal to scrape" to "is this a good subscription to buy," a much simpler decision.

---

## 4. Top 3 Recommended Sources — Fit With Existing HAT Architecture

The existing pipeline, confirmed from the codebase:

```
Email Source Parser (per-source) → NormalizedProperty (lib/property-schema.md)
  → lib/acquisition-engine.mjs (screen/underwrite, source-independent)
  → routing decision (INSERT_HOT/INSERT/SECOND_CHANCE/MONITOR/REJECT)
  → crm-agent.md CRM insert (lead_source, Property Intelligence step — Capability #7)
  → HatCRM: Inbox, Lead Detail, Action Center (all already source-agnostic)
```

**Critical constraint to respect (explicitly called out in the mission):** the acquisition engine's
`screen()`/`underwrite()` functions expect listing-shaped fields — `asking_price`, `bedrooms`,
`bathrooms`, `sqft`, `days_on_market`, `alert_type`, etc. (per `lib/property-schema.md`, verified
Cycle 3). **A raw lis pendens or tax-delinquent record has none of these.** Forcing it through
`screen()` unenriched would either crash on missing required-shaped input or silently produce garbage
scores from nulls. This is the single most important architectural finding of this discovery.

### 4.1 Property Appraiser Tax Roll + Statewide Cadastral API — the enrichment layer, not a lead source
**Fits as:** a new, source-independent **enrichment step inserted between raw distress record and
NormalizedProperty** — not a Stage-0 parser producing leads on its own. Given owner name/address +
parcel ID from any distress source (§4.2/§4.3), this layer supplies: property address confirmation,
building characteristics (beds/baths/sqft equivalents — `TOT_LVG_AR`, `NO_RES_UNT`), valuation
(`JV`/assessed value, usable as an ARV proxy or cross-check), sale history (absentee-owner detection),
and land-use classification (feeds the engine's existing property-type hard-reject check). This is what
makes it possible to build a legitimate NormalizedProperty for an off-market record at all.
**No acquisition-engine changes needed** — it only ever receives a properly-shaped NormalizedProperty,
regardless of whether that shape came from a listing email or from this enrichment step.

### 4.2 Lis Pendens / Pre-Foreclosure — the strongest new distress lead source
**Fits as:** a **new Stage-0 source parser**, structurally identical in role to the existing Redfin/Zillow
parsers in `gmail-summary-agent.md` — except its input is a court-records search result, not an email,
and its raw fields (party names, instrument number, filing date) must first pass through the §4.1
enrichment layer to acquire the listing-shaped fields the engine needs. Concretely:
`Lis Pendens record → [enrich via Property Appraiser/Cadastral by owner name+county match] →
NormalizedProperty (source: 'lis_pendens_auto' or similar) → acquisition-engine.mjs → same routing →
same crm-agent.md insert + Property Intelligence step (Capability #7) → same HatCRM UI`.
**Nothing downstream of NormalizedProperty needs to change** — this is exactly the "Adding a new
source" pattern already documented and proven twice (Redfin, then Zillow) in
`docs/architecture/acquisition-engine.md`.
**One real gap:** `alert_type`/`redfin_trigger_type` has no lis-pendens-shaped value yet (it's Redfin/Zillow
listing-alert vocabulary) — a new value (e.g. `'pre_foreclosure_filed'`) would need to be added to that
column's accepted values, mirroring exactly how Capability #6.1 already generalized `lead_source`.

### 4.3 Tax Deed Sales (structured auction calendar) — the most mechanically tractable distress source
**Fits the same pattern as §4.2.** Its advantage over lis pendens specifically: the auction list is
posted as one structured batch, 30 days ahead, on a predictable (weekly) cadence — closer in shape to
"one email, multiple properties" (already a handled case in Stage 0) than to parsing a continuous
court-records stream. **Same enrichment requirement** as §4.2 (owner/parcel → Property Appraiser data)
since a tax-deed listing itself contains opening bid and parcel, not beds/baths/ARV.
**Caveat carried over from §3.3/§3.4:** by auction day, the negotiation window with the ownermay
already be closed — this source is better suited to **MONITOR-first routing** (track it, don't expect
immediate seller outreach) or to a downstream "won at auction, now list as a HAT-owned flip" workflow,
which is a different use case than the seller-outreach model Redfin/Zillow/lis-pendens serve. Worth an
explicit product decision before building, not just an engineering one.

---

## 5. Best Multi-Signal Combinations

Ranked by expected proprietary value to HAT specifically (i.e., signal combinations unlikely to already
be fully exploited by every other Jacksonville wholesaler):

1. **Tax Delinquent + Absentee Owner (via §4.1 owner-address ≠ property-address check).** Very strong —
   an absentee owner behind on taxes is both financially motivated and not living in the property, removing
   the emotional-attachment objection. The absentee check itself is free and mechanical once §4.1 is built.
2. **Lis Pendens + High Equity (via §4.1 assessed value vs. estimated mortgage balance/sale history).**
   A pre-foreclosure owner with real equity remaining is a far better acquisition target than one who's
   underwater — this combination filters out the (common) pre-foreclosure cases where there's nothing
   left for HAT to offer the seller.
3. **Code Violation + Vacant.** **[Cannot currently be built — both source access paths are unconfirmed
   per §3.7/§3.10]**, but flagged because it's a textbook "neglected property, distant/uninterested owner"
   signal if the access-path questions get resolved via a direct MCCD/Neighborhoods records request.
4. **Probate + Absentee Owner.** Inherited property where the heir doesn't live locally (common — heirs
   often live out of state) is one of the highest-conversion investor lead types industry-wide
   **[INFERENCE, general industry knowledge, not Jacksonville-specific data]** — same enrichment
   dependency as #1.
5. **Redfin/Zillow Long-DOM Listing + Public Distress Record (any of the above).** A property already
   sitting in HAT's own Inbox/Monitor queue (Capability #4/#5's Rediscovery/Action Center) that *also*
   turns up a lis pendens or tax-delinquent record is a very strong "act now" signal — and this one
   requires **zero new ingestion work**, only a lookup against records HAT would already hold once §4.2
   exists, joined by address via the same `normalizeAddressForDB()`/Property Intelligence matching
   already built (Capability #3/#4).
6. **Tax Deed Sale + Redfin/Zillow History.** If a property scheduled for tax deed auction was previously
   seen (and rejected/monitored) via Redfin/Zillow, HAT already has prior underwriting on file — Property
   Intelligence (Capability #3/#4) already resolves this automatically once both sources feed the same
   `leads`/`properties` tables, per the same-property-history requirement established in Capability #7.

---

## 6. Required Enrichment (Top Sources)

| From (raw distress record fields) | To (NormalizedProperty needs) | Enrichment source |
|---|---|---|
| Owner name, property address (partial), parcel/case number | Confirmed parcel ID, full address, beds/baths/sqft-equivalent, land use | Property Appraiser Tax Roll / Statewide Cadastral (§4.1) |
| Owner name, owner mailing address | Absentee-owner flag (owner address ≠ property address) | Statewide Cadastral `OWN_ADDR1` vs `PHY_ADDR1` comparison |
| Parcel ID, assessed value | ARV proxy / equity estimate | Statewide Cadastral `JV`/`AV_SD` fields, cross-checked against sale history (`SALE_PRC1/2`) |
| Amount owed (tax/lien) | Distress magnitude / motivation score input | Source-native field, already present on tax delinquent/tax deed records |
| Property address only, no listing status | Confirm not already under contract/listed | Cross-check against existing `leads`/`mls_status` (already-built RentCast enrichment, `enrich-lead.mjs`) before treating an off-market record as "new" |
| No beds/baths/sqft at all (e.g. bare parcel/lien record) | Minimum viable NormalizedProperty | If Property Appraiser data is also thin (rare, but possible for some parcel types), fall back to the engine's existing "Unknown condition → $50K default" screening path — already built, no new logic needed |

**No enrichment build was done in this capability — this table only identifies what future connector
work would need**, per the mission's explicit instruction.

---

## 7. Source Performance Measurement (Recommendation Only — Not Built)

When a future capability builds this, measure per source, mirroring the funnel already implicit in
`gmail-summary-agent.md`'s Stage 6 summary (Capability #7 already added Extracted/Failed
Parsing/Inserted HOT counters there) and Action Center's existing categories:

1. **Records ingested** (raw count pulled from the source)
2. **Enriched successfully** (passed through §4.1 with usable NormalizedProperty fields) vs. **enrichment failed** (new metric this introduces — a raw distress record that couldn't be matched to Property Appraiser data at all)
3. **Properties matched to existing HAT history** (Property Intelligence re-encounter, Capability #3/#4)
4. **Qualified opportunities** (engine routed INSERT/INSERT_HOT/SECOND_CHANCE-KEEP)
5. **ACT NOW** (Capability #5 Action Center bucket — ties source performance directly to the existing prioritization UI, not a new dashboard)
6. **Agent/owner contacts made**
7. **Offers extended**
8. **Contracts signed**
9. **Purchases closed**

Recommended grouping dimension: `lead_source` value (already the existing, source-agnostic column,
generalized in Capability #6.1) — no new schema needed to eventually build this, only new values in that
same column per new source, exactly like `zillow_auto` was added.

---

## 8. Risks / Access Restrictions

- **Several sources (Code Violations, Vacant Registry, Municipal Liens, JEA) have no confirmed public
  bulk-access path today.** Treat these as "verify via direct records request before committing engineering
  time," not as ready-to-build.
- **Do not scrape past bot protection, CAPTCHAs, or authentication walls** — if `or.duvalclerk.com` or
  LienHub turn out to require this, the correct response is a formal data request or a paid aggregator,
  never a bypass, per the mission's explicit constraint.
- **Probate records have real confidentiality carve-outs** (inventories, accountings, death certificates)
  — any future connector must only ever touch the public case index, never attempt to access sealed
  sub-records.
- **JEA utility data is very likely legally distinct from property/court records** — treat as effectively
  inaccessible without a formal agreement; do not plan a near-term connector around it.
- **The Property Appraiser/Cadastral data is annual/monthly, not real-time** — a property's ownership or
  valuation could be stale by the time HAT acts; existing enrichment (`enrich-lead.mjs`/RentCast) already
  handles current-listing-status freshness, and that pattern should carry over rather than trusting the
  parcel snapshot as current-day truth.
- **Auction-based sources (tax deed, foreclosure) are late-stage** — the seller-outreach opportunity may
  already be gone by auction day; product decision needed on whether HAT wants these as direct-bid
  opportunities, monitor-only signals, or skipped entirely in favor of earlier-stage sources like lis
  pendens.

---

## 9. Recommended Implementation Sequence

1. **Build the Property Appraiser / Statewide Cadastral enrichment layer first** (§4.1) — every other
   source in this report depends on it, and it's the lowest-risk, highest-automation-feasibility item
   found (structured files + a real REST API, both free, both verified).
2. **Manually verify `or.duvalclerk.com`'s actual query/access mechanics** (rate limits, JS rendering, any
   ToS on automated use) before writing a lis pendens parser — this is the one unresolved technical
   question standing between "recommended" and "buildable" for the #2-ranked source.
3. **Build the lis pendens Stage-0 parser + enrichment join**, following the exact "new source" pattern
   already proven twice (Redfin → Zillow) in this codebase.
4. **Add the two Combination Signals that require zero new ingestion** (absentee-owner flag, and
   cross-referencing existing Redfin/Zillow leads against new distress records via Property Intelligence)
   as soon as §4.1 exists — these are nearly free once the enrichment layer is live.
5. **Evaluate a PropStream/BatchLeads subscription in parallel** as a fast-follow or fallback — if manual
   parsing of Duval's court/tax portals proves slower to build than expected, a $99–299/mo commercial
   feed already does the enrichment + combination-signal work and could plug into the existing generic
   CSV import path (`importLead()`) with comparatively little engineering.
6. **Revisit Code Violations / Vacant Registry / Municipal Liens after a direct records request** clarifies
   what the city can actually provide on a recurring basis — do not build against assumptions.

---

## 10. Exact Recommendation for Capability #9

**Capability #9 should be: "Property Appraiser & Statewide Cadastral Enrichment Layer V1"** — build the
enrichment step (§4.1) as a standalone, source-independent utility (mirroring how `lib/acquisition-engine.mjs`
is source-independent), callable from any future Stage-0 parser, before building any single new lead
source's ingestion. This unlocks lis pendens, tax delinquent, tax deed, and probate sources equally, is the
lowest-risk item in this entire report (two free, verified, government-published data sources), and directly
enables the two highest-value Combination Signals (§6, #1 and #2) at near-zero additional cost.

---

## FINAL DECISION

**BUILD FIRST:**
Property Appraiser Real Estate Tax Roll + Florida Statewide Cadastral API (enrichment layer) — followed
immediately by the Lis Pendens / Pre-Foreclosure Stage-0 source once §2 in the implementation sequence
(manual portal verification) is complete.

**WHY:**
Every distressed-property source investigated shares the same blocker: raw records (owner name, parcel,
case number, amount owed) cannot pass through the existing acquisition engine without listing-shaped
fields (address, beds/baths/sqft, valuation) first. Two real, free, verified Florida/Duval sources already
solve that problem for the entire county. Building the enrichment layer first means every subsequent
distress source (lis pendens, tax delinquent, tax deed, probate) becomes buildable using the exact same
proven "new source" pattern already used for Redfin and Zillow — instead of building one-off enrichment
logic per source.

**EXPECTED BUSINESS IMPACT:**
Unlocks HAT's first genuinely off-market, pre-Redfin/Zillow acquisition channel, plus a free absentee-owner
and equity-estimate signal usable across every future source — without any new architecture, without
touching the acquisition engine's scoring logic, and using entirely free, publicly-published government
data sources with the lowest legal/access risk of everything investigated.

**CAPABILITY #9 SHOULD BE:**
**Property Appraiser & Statewide Cadastral Enrichment Layer V1**

---

*End of discovery report. No code was written. No connector was built. Awaiting review before any
implementation.*
