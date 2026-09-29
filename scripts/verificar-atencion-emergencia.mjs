// Control de /profesional/atencion/:id en el teléfono (390×844):
//  · el copiloto clínico es una barra fija abajo que se enciende con sugerencias
//    y abre una hoja; no tapa "Guardar consulta en la HC";
//  · guardar la HC anda aunque la sesión desaparezca del almacenamiento — lo que
//    le pasó a Mateo en el WebView de la app el 2026-09-28 (todo salía anónimo).
//
// Necesita una consulta de emergencia ABIERTA del médico que se pasa (en staging:
// crear una emergencia `arrived` con professional_id = clinica@staging y llamar
// `iniciar_atencion_emergencia` con su JWT). Escribe en la HC de esa consulta.
//
//   node scripts/verificar-atencion-emergencia.mjs <BASE> <consulta_id> <supabase_url> <anon_key> <email> <password> [tag]
//   p. ej. BASE=http://localhost:5173 o https://gethealthier-staging.vercel.app
import { chromium, devices } from 'playwright'
const [BASE, CID, SURL, AKEY, EMAIL, PASS, TAG = 'verif'] = process.argv.slice(2)
import fs from 'fs'
fs.mkdirSync('/tmp/atencion-shots-2', { recursive: true })
const ref = new URL(SURL).hostname.split('.')[0]
const KEY = `sb-${ref}-auth-token`
const sesion = await (await fetch(`${SURL}/auth/v1/token?grant_type=password`, { method:'POST', headers:{ apikey:AKEY,'Content-Type':'application/json' }, body: JSON.stringify({ email:EMAIL, password:PASS }) })).json()
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport:{ width:390, height:844 } })
const page = await ctx.newPage()
const log = []; let ok = true
const check = (n, c, extra='') => { console.log(c ? 'OK ' : 'FALLA', n, extra); if (!c) ok = false }
page.on('pageerror', e => log.push('pageerror ' + e.message))
const roles = []
page.on('request', req => { const u = req.url(); if (!u.includes(ref) || req.method() === 'OPTIONS' || req.method() === 'GET') return
  const a = req.headers()['authorization'] || ''; let role = '?'; try { role = JSON.parse(Buffer.from(a.split(' ')[1].split('.')[1], 'base64url')).role } catch {}
  roles.push(`${req.method()} ${role} ${u.split('/rest/v1/')[1]?.split('?')[0]}`) })
const shot = n => page.screenshot({ path: `/tmp/atencion-shots-2/${TAG}-${n}.png` })
await page.goto(BASE + '/')
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(sesion)])
await page.goto(`${BASE}/profesional/atencion/${CID}`); await page.waitForTimeout(4500)
await shot('01-inicio')
const barra = page.getByRole('button', { name: /^Copiloto clínico:/ })
check('barra del copiloto visible', await barra.isVisible())
const bb = await barra.boundingBox()
check('barra pegada abajo', bb && Math.abs(bb.y + bb.height - 844) < 2, JSON.stringify(bb))
// Elegir un motivo con guía
const select = page.locator('select').first()
const opciones = await select.locator('option').allInnerTexts()
await select.selectOption({ label: opciones[1] }); await page.waitForTimeout(600)
const label = await barra.getAttribute('aria-label')
check('barra encendida con sugerencias', /\d+ sugerencia/.test(label), label)
await shot('02-encendida')
await barra.click(); await page.waitForTimeout(600)
const hoja = page.getByRole('dialog', { name: 'Copiloto clínico' })
check('hoja abierta', await hoja.isVisible())
await shot('03-hoja')
const antes = Number((label.match(/(\d+) sugerencia/) || [])[1])
await hoja.locator('li button').first().click(); await page.waitForTimeout(400)
await hoja.getByRole('button', { name: 'Cerrar', exact: true }).click(); await page.waitForTimeout(400)
const despues = Number(((await barra.getAttribute('aria-label')).match(/(\d+) sugerencia/) || [])[1])
check('tomar una sugerencia baja el contador', despues === antes - 1, `${antes} → ${despues}`)
// Guardar no queda tapado por la barra
const guardar = page.getByRole('button', { name: /consulta en la HC/ })
await guardar.scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector('[class*="overflow-y-auto"]')?.scrollBy(0, 10000)); await page.waitForTimeout(400)
const gb = await guardar.boundingBox(); const bb2 = await barra.boundingBox()
check('guardar queda arriba de la barra', gb && bb2 && gb.y + gb.height <= bb2.y, `guardar ${Math.round(gb?.y + gb?.height)} barra ${Math.round(bb2?.y)}`)
await shot('04-guardar-visible')
// Simular lo del iPhone: la sesión desaparece del almacenamiento
await page.evaluate(k => localStorage.removeItem(k), KEY); await page.waitForTimeout(300)
roles.length = 0
await guardar.click(); await page.waitForTimeout(3500)
await shot('05-guardado')
check('HC guardada tras perder la sesión', await page.getByText('Consulta guardada en la historia clínica').count() > 0)
check('escrituras con sesión (ninguna anónima)', roles.length > 0 && roles.every(r => !r.includes(' anon ')), roles.join(' | '))
check('sin errores de página', log.length === 0, log.join(' | '))
console.log(ok ? 'TODO OK' : 'HAY FALLAS')
await browser.close(); process.exit(ok ? 0 : 1)
