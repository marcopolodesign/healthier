import { urlLimpia } from './flowUrl.js'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content']
const STORAGE_KEY = 'healthier_utms'
const TS_KEY = 'healthier_utms_ts'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function isExpired() {
  const ts = localStorage.getItem(TS_KEY)
  return ts ? (Date.now() - parseInt(ts)) > TTL_MS : false
}

// Call on every landing page load — only writes if UTM params are present in URL
export function captureUtms() {
  const params = new URLSearchParams(window.location.search)
  const found = {}
  UTM_KEYS.forEach(k => { if (params.get(k)) found[k] = params.get(k) })
  if (Object.keys(found).length > 0) {
    clearUtms()
    // Sin la query entera: un link de remarketing trae `email=`, y eso quedaba
    // guardado en `profiles.referrer_url`. Sólo origin + ruta + utm_* permitidos.
    found.referrer_url = urlLimpia({ origin: window.location.origin, pathname: window.location.pathname, search: window.location.search })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found))
    localStorage.setItem(TS_KEY, String(Date.now()))
  }
}

// Read stored UTMs (called at registration time)
export function getStoredUtms() {
  if (isExpired()) { clearUtms(); return {} }
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {} }
  catch { return {} }
}

// Clear after saving to DB so they don't persist across separate sign-up sessions
export function clearUtms() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(TS_KEY)
}
