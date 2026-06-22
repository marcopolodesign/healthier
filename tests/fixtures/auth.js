/**
 * Test authentication helpers.
 *
 * loginAs() signs in via the real UI login form and waits for the dashboard
 * redirect — most reliable since it goes through actual Supabase auth and
 * avoids the "Failed to fetch" getUser() error in headless Chromium that
 * occurs when sessions are injected directly into localStorage.
 *
 * getSession() is kept for beforeAll hooks that need the user ID without a
 * browser page (e.g. to set up test data before the test runs).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

/**
 * Sign in via the Supabase JS client (no browser). Returns the full session.
 * Used in beforeAll hooks to obtain the user ID for test data setup.
 */
export async function getSession(email, password) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`)
  return data.session
}

/**
 * Sign in via the app's real /login form and wait for the role-based redirect.
 * After this returns, the page is at /profesional/dashboard (or /paciente/...)
 * with the full auth context — profile loaded, React state ready.
 */
export async function loginAs(page, email, password) {
  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  // Wait for the role-based dashboard redirect
  await page.waitForURL(/\/(paciente|profesional|admin|super-admin)\//, { timeout: 15_000 })
}
