import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
// Project ref is the subdomain of the Supabase URL
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

export async function getSession(email, password) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`)
  return data.session
}

// Inject a Supabase session into the page's localStorage and reload
export async function loginAs(page, email, password) {
  const session = await getSession(email, password)
  await page.goto('/')
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(session)]
  )
  await page.reload()
  // Wait for the app shell to mount (auth context resolves)
  await page.waitForSelector('[data-testid="app-ready"], nav, [class*="dashboard"]', { timeout: 8000 }).catch(() => {})
}
