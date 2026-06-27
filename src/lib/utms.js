const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content']
const STORAGE_KEY = 'healthier_utms'

// Call on every landing page load — only writes if UTM params are present in URL
export function captureUtms() {
  const params = new URLSearchParams(window.location.search)
  const found = {}
  UTM_KEYS.forEach(k => { if (params.get(k)) found[k] = params.get(k) })
  if (Object.keys(found).length > 0) {
    found.referrer_url = window.location.href
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found))
  }
}

// Read stored UTMs (called at registration time)
export function getStoredUtms() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {} }
  catch { return {} }
}

// Clear after saving to DB so they don't persist across separate sign-up sessions
export function clearUtms() {
  localStorage.removeItem(STORAGE_KEY)
}
