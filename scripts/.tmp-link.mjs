import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const e = Object.fromEntries(fs.readFileSync('/Users/mataldao/Local/.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(e.HEALTHIER_STAGING_SUPABASE_URL, e.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: process.argv[2],
  options: { redirectTo: 'https://gethealthier-staging.vercel.app' + (process.argv[3] ?? '/profesional/dashboard') },
})
if (error) { console.error(error.message); process.exit(1) }
console.log(data.properties.action_link)
