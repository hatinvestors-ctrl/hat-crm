import fetch from 'node-fetch';

const SUPABASE_PAT = 'sbp_05434f76c664e2ed394f7e128cd22eb78058bcc1';
const SUPABASE_PROJECT_REF = 'pyrgotfotmwazigewlke';
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d';

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  try { return JSON.parse(text); } catch { return []; }
}

function s(v) { return v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; }
function n(v) { const x = Number(v); return isNaN(x) ? 'NULL' : String(x); }

const leads = [
  { address: '2071 Courtney Dr', zip: '32208', beds: 3, baths: 2, sqft: 1561, price: 220000, list: 225000, type: 'price_drop', hot: true, notes: 'All-brick 3/2 home in northern Jacksonville on 0.38 acre lot. Dropped $5K from $225K.' },
  { address: '4645 Kingsbury St', zip: '32205', beds: 2, baths: 1, sqft: 884, price: 205000, list: 210000, type: 'price_drop', hot: true, notes: 'Fully remodeled 2/1 in Murray Hill area. Dropped $5K from $210K. Easy interstate access.' },
  { address: '3536 College Pl', zip: '32205', beds: 3, baths: 2, sqft: 1472, price: 335000, list: 340000, type: 'price_drop', hot: true, notes: '1924 bungalow in Murray Hill, seller motivated with open house 5/31. Dropped $5K.' },
  { address: '2233 Schumacher Ave', zip: '32207', beds: 4, baths: 3.5, sqft: 2168, price: 279000, list: 300000, type: 'price_drop', hot: true, notes: '4BR/3.5BA on 0.48 acre lot. Dropped $21K from $300K. Strong price reduction.' },
  { address: '11714 Harts Rd', zip: '32218', beds: 4, baths: 2.5, sqft: 2252, price: 347999, list: 360000, type: 'price_drop', hot: true, notes: 'Spacious 4BR/2.5BA with 2-car garage. Dropped $12K from $360K.' },
  { address: '3052 College St', zip: '32205', beds: 2, baths: 1, sqft: 926, price: 239900, list: 249900, type: 'price_drop', hot: true, notes: 'Charming remodeled 2/1 with separate garage/workshop. Dropped $10K from $249,900.' },
  { address: '3859 Abby Ln', zip: '32207', beds: 4, baths: 3, sqft: 1880, price: 338660, list: 345000, type: 'price_drop', hot: true, notes: 'Fully renovated 4BR/3BA investment property. Rental income potential $3000+/mo. Dropped $6.34K.' },
  { address: '2224 W 44th St', zip: '32209', beds: 2, baths: 1, sqft: 888, price: 90000, list: 110000, type: 'price_drop', hot: true, notes: 'Affordable investor/cash flow opportunity. Dropped $20K from $110K. Ideal for investors.' },
  { address: '5754 Royalty Rd', zip: '32254', beds: 4, baths: 2, sqft: 1843, price: 274900, list: 279900, type: 'price_drop', hot: true, notes: '4BR/2BA open-concept home. Dropped $5K from $279,900.' },
  { address: '6786 W Gaspar Cir', zip: '32219', beds: 3, baths: 1, sqft: 1068, price: 185000, list: 190000, type: 'price_drop', hot: true, notes: 'Fully renovated concrete block home. Dropped $5K from $190K. Move-in ready.' },
  { address: '2822 Flanders St', zip: '32206', beds: 3, baths: 1, sqft: 1133, price: 153000, list: 154500, type: 'price_drop', hot: true, notes: 'Fully renovated gem in Jacksonville. Dropped $1.5K.' },
  { address: '6212 Leona St', zip: '32219', beds: 3, baths: 2, sqft: 1391, price: 237000, list: 240000, type: 'price_drop', hot: true, notes: 'Like-new 3/2 with premium solid surface flooring. Dropped $3K.' },
  { address: '6420 Diamond Leaf Ct N', zip: '32244', beds: 3, baths: 2, sqft: 1773, price: 315000, list: 325000, type: 'price_drop', hot: true, notes: '3/2 on quiet cul-de-sac, Westside. Vaulted ceilings, fireplace. Dropped $10K.' },
  { address: '8032 Lourdes Dr S', zip: '32210', beds: 3, baths: 2, sqft: 1254, price: 225000, list: 229000, type: 'price_drop', hot: true, notes: '3/2 Westside home. Dropped $4K from $229K.' },
  { address: '3252 Thomas St', zip: '32254', beds: 3, baths: 1, sqft: 768, price: 69000, list: 75000, type: 'price_drop', hot: true, notes: 'Highly motivated seller, investor special. Previously rented $1000/mo. AS-IS, dropped $6K from $75K.' },
  { address: '3165 Broadway Ave', zip: '32254', beds: 3, baths: 2, sqft: 1446, price: 139999, list: 150000, type: 'price_drop', hot: true, notes: 'Investor special, priced to sell. Dropped $10K from $150K.' },
  { address: '2212 W 12th St', zip: '32209', beds: 3, baths: 1, sqft: 891, price: 115000, list: 125000, type: 'price_drop', hot: true, notes: 'Grand Park area, 3/1 affordable home for investors. Dropped $10K from $125K.' },
  { address: '5519 River Forest Dr', zip: '32211', beds: 3, baths: 2, sqft: 1574, price: 240000, list: 245000, type: 'price_drop', hot: true, notes: 'Short sale, completely renovated 1950s home with fenced backyard. Cash/Conv/FHA/VA. Dropped $5K.' },
  { address: '3596 Cypress St', zip: '32205', beds: 3, baths: 2, sqft: 1342, price: 330000, list: 339000, type: 'price_drop', hot: true, notes: 'Renovated Murray Hill home, new roof, updated interiors. Dropped $9K from $339K.' },
  { address: '2520 Larsen Rd', zip: '32207', beds: 3, baths: 2, sqft: 1195, price: 229900, list: 229900, type: 'back_on_market', hot: true, notes: 'Back on market, 3/2, 1195 sqft. Open houses Sat-Sun 5/30-5/31.' },
  { address: '6810 Rhapsody Rd', zip: '32244', beds: 3, baths: 2.5, sqft: 1970, price: 292997, list: 292997, type: 'back_on_market', hot: true, notes: 'Back on market, 3/2.5, 1970 sqft.' },
  { address: '4977 Connors St', zip: '32207', beds: 2, baths: 1, sqft: 870, price: 200000, list: 200000, type: 'back_on_market', hot: true, notes: 'Back on market, 2/1, 870 sqft in 32207.' },
  { address: '3216 Claremont Rd', zip: '32207', beds: 3, baths: 1, sqft: 1316, price: 229000, list: 229000, type: 'back_on_market', hot: true, notes: 'Back on market, 3/1, 1316 sqft in 32207.' },
];

const now = new Date().toISOString();
const inserted = [];
const failed = [];

for (const l of leads) {
  try {
    const rows = await query(`
      INSERT INTO public.leads
        (workspace_id, address, city, state, zip_code, property_type,
         bedrooms, bathrooms, sqft, asking_price, list_price,
         lead_source, redfin_trigger_type, status, auto_imported,
         mls_status, is_hot, notes, created_at, updated_at)
      VALUES (
        ${s(WORKSPACE_ID)}, ${s(l.address)}, 'Jacksonville', 'FL', ${s(l.zip)},
        'single_family', ${n(l.beds)}, ${n(l.baths)}, ${n(l.sqft)},
        ${n(l.price)}, ${n(l.list)},
        'redfin_auto', ${s(l.type)}, 'triage', true, 'active',
        ${l.hot ? 'true' : 'false'}, ${s(l.notes)}, ${s(now)}, ${s(now)}
      )
      RETURNING id, address
    `);
    console.log('OK', l.address, rows[0]?.id);
    inserted.push({ ...l, id: rows[0]?.id });
  } catch (e) {
    console.log('FAIL', l.address, e.message.substring(0, 120));
    failed.push(l);
  }
}

console.log(`\nDONE: ${inserted.length} inserted, ${failed.length} failed`);
console.log(JSON.stringify({ inserted, failed }));
