/**
 * One-time Gmail OAuth setup.
 * Run once: node setup-oauth.mjs
 * Saves refresh token to .env so the daily script can run unattended.
 *
 * Prerequisites: fill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.
 */

import { google } from 'googleapis'
import { createServer } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { parse } from 'url'
import 'dotenv/config'

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first')
  process.exit(1)
}

const REDIRECT_URI = 'http://localhost:3737/oauth/callback'

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
})

console.log('\n✅  Open this URL in your browser:\n')
console.log(authUrl)
console.log('\nWaiting for redirect...\n')

const server = createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true)
  if (pathname !== '/oauth/callback') { res.end(); return }

  const code = query.code
  if (!code) {
    res.end('No code received')
    server.close()
    return
  }

  const { tokens } = await oauth2Client.getToken(code)

  // Append refresh token to .env
  let env = readFileSync('.env', 'utf8')
  env = env
    .replace(/^GOOGLE_REFRESH_TOKEN=.*/m, '')
    .trimEnd()
  env += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`
  writeFileSync('.env', env)

  res.end('<h2>✅ Auth complete — you can close this tab</h2>')
  server.close()

  console.log('✅  Refresh token saved to .env')
  console.log('    Run "node index.mjs" to test the import.')
})

server.listen(3737)
