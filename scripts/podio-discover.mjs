// Discover Podio apps and test authentication
const CLIENT_ID     = 'hatcrm'
const CLIENT_SECRET = '3VQ5Gq8xof81kYsBwj0wZ8jdC0PjollaYv24hl8itXqKDDMlKuth6ndmIUykUoQd'
const EMAIL    = 'hili@magaleygishur.co.il'
const PASSWORD = 'Podio12345%'

// Try to find the Client ID by checking the API key page
// Podio password auth needs client_id + client_secret + username + password
// The key shared is likely the client_secret; we need the client_id too
// Let's try authenticating with the key as client_id first
async function tryAuth(clientId, clientSecret) {
  const res = await fetch('https://podio.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: EMAIL,
      password: PASSWORD,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const data = await res.json()
  return { ok: res.ok, data }
}

// Try key as client_id (some Podio setups use same value)
console.log('Attempting Podio authentication...')
let result = await tryAuth(CLIENT_ID, CLIENT_SECRET)
console.log('Auth attempt 1 (key as both):', result.ok ? '✅' : '❌', result.data.error || 'OK')

if (!result.ok) {
  console.log('\nAuthentication failed. Need both Client ID and Client Secret.')
  console.log('Please go to Podio > Account Settings > API Keys and share:')
  console.log('1. The Client ID (shorter, shown first)')
  console.log('2. The Client Secret (longer, shown second)')
  process.exit(1)
}

const token = result.data.access_token
console.log('✅ Authenticated! Token:', token.slice(0, 20) + '...')

// Get all orgs/spaces to find the app
const orgsRes = await fetch('https://api.podio.com/org/', {
  headers: { Authorization: `Bearer ${token}` }
})
const orgs = await orgsRes.json()
console.log('\nOrganizations:')
for (const org of orgs) {
  console.log(` - ${org.name} (${org.org_id})`)
}

// Get spaces
if (orgs.length > 0) {
  const spacesRes = await fetch(`https://api.podio.com/org/${orgs[0].org_id}/space/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const spaces = await spacesRes.json()
  console.log('\nSpaces:')
  for (const s of spaces) {
    console.log(` - ${s.name} (${s.space_id})`)
    // Get apps in this space
    const appsRes = await fetch(`https://api.podio.com/app/space/${s.space_id}/`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const apps = await appsRes.json()
    for (const a of apps) {
      console.log(`   App: ${a.config?.name || a.name} — ID: ${a.app_id}`)
    }
  }
}
