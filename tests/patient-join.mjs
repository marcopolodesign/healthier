import { chromium } from 'playwright'

const CONSULT_ID = '7c6170a3-72f2-42ce-a6b5-39162c4907bb'

const browser = await chromium.launch({
  headless: false,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
})
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] })
const page = await ctx.newPage()

page.on('console', m => { if (m.type() === 'error') console.log('[patient ERR]', m.text()) })
page.on('pageerror', e => console.log('[patient PAGE ERR]', e.message))
page.on('response', r => { if (r.status() >= 400) console.log('[patient HTTP]', r.status(), r.url().replace(/\?.*/, '')) })

console.log('logging in as patient...')
await page.goto('http://localhost:5200/login')
await page.waitForSelector('input[type="email"]', { timeout: 8000 })
await page.fill('input[type="email"]', 'paciente@healthier.app')
await page.fill('input[type="password"]', 'DemoUser2026!')
await page.click('button[type="submit"]')
await page.waitForURL(/paciente/, { timeout: 12000 })
console.log('logged in:', page.url())

await page.goto(`http://localhost:5200/paciente/videollamada/${CONSULT_ID}`)
console.log('navigated to video call page')

// Wait for call to connect (createCallObject joins without pre-join UI)
await page.waitForTimeout(6000)
console.log('after 6s url:', page.url())
await page.screenshot({ path: '/tmp/patient-videocall.png' })
console.log('screenshot saved')

// Stay in call for 20 more seconds so the professional side can see us
await page.waitForTimeout(20000)
console.log('closing patient browser')
await browser.close()
