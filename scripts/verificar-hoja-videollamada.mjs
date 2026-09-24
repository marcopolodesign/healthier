import { chromium, devices } from 'playwright'
// Control de la hoja de historia clínica de la videollamada en el teléfono:
// arrastrarla abre/cierra, un toque la abre/cierra y durante el gesto no cambia
// de estado. Corre contra la simulación (no escribe nada) con una cuenta de staging.
//   BASE=https://gethealthier-staging.vercel.app node scripts/verificar-hoja-videollamada.mjs
// También que "Entrar igual a la sala" recién aparezca a los 3 minutos.
// Sale con código 1 si algún paso no da lo esperado.
const BASE = process.env.BASE || 'http://localhost:5173'
const OUT = process.env.OUT || '/tmp'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] })
const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto(BASE + '/login')
await page.fill('input[type=email]', 'clinica@staging.healthier.app')
await page.fill('input[type=password]', 'staging')
await page.keyboard.press('Enter')
await page.waitForURL(/profesional/, { timeout: 20000 })
await page.goto(BASE + '/profesional/videollamada/simulacion')
const pane = page.locator('.vc-panel-pane')
await pane.waitFor({ timeout: 20000 })
await page.waitForTimeout(2500)
const cerrarTour = page.locator('.driver-popover-close-btn')
if (await cerrarTour.count()) await cerrarTour.first().click()
else await page.keyboard.press('Escape')
await page.waitForTimeout(600)
const estado = () => pane.getAttribute('data-abierta')
const handle = page.locator('.vc-panel-pane > button').first()
const drag = async (dy, steps = 12, stepDelay = 16) => {
  const bb = await handle.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x, y + dy * i / steps); await page.waitForTimeout(stepDelay) }
  return async () => { await page.mouse.up(); await page.waitForTimeout(400) }
}
const log = []
log.push(['inicio', await estado()]); await page.screenshot({ path: `${OUT}/1-cerrada.png` })
await handle.click(); await page.waitForTimeout(400); log.push(['toque desde cerrada', await estado()])
await handle.click(); await page.waitForTimeout(400); log.push(['toque desde abierta', await estado()])
let up = await drag(-250, 10, 40); await page.screenshot({ path: `${OUT}/2-arrastrando-arriba.png` })
log.push(['a mitad del arrastre (sigue false hasta soltar)', await estado()]); await up()
log.push(['arrastre arriba 250px lento', await estado()])
up = await drag(-400, 12, 40); await up(); log.push(['arrastre arriba 400px', await estado()])
await page.screenshot({ path: `${OUT}/3-abierta.png` })
let down = await drag(250, 10, 40); await page.screenshot({ path: `${OUT}/4-arrastrando-abajo.png` }); await down()
log.push(['arrastre abajo 250px lento', await estado()])
down = await drag(500, 12, 40); await down(); log.push(['arrastre abajo 500px', await estado()])
up = await drag(-80, 3, 5); await up(); log.push(['flick arriba 80px', await estado()])
down = await drag(80, 3, 5); await down(); log.push(['flick abajo 80px', await estado()])
up = await drag(-80, 3, 5); await up()
down = await drag(60, 10, 60); await down(); log.push(['abierta + 60px lento (sigue abierta)', await estado()])
await handle.click(); await page.waitForTimeout(400); log.push(['toque', await estado()])
await handle.click(); await page.waitForTimeout(400); log.push(['toque', await estado()])
const bb = await pane.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + 120); await page.waitForTimeout(400)
log.push(['toque en contenido', await estado()])
await page.screenshot({ path: `${OUT}/5-final.png` })
// "Entrar igual a la sala" aparece recién a los 3 minutos de espera.
const p2 = await ctx.newPage()
await p2.clock.install()
await p2.goto(BASE + '/profesional/videollamada/simulacion')
await p2.locator('.vc-panel-pane').waitFor({ timeout: 20000 })
const link = p2.getByText('Entrar igual a la sala')
log.push(['"Entrar igual" oculto al entrar', String(await link.count() > 0)])
await p2.clock.fastForward('02:50')
log.push(['"Entrar igual" oculto a los 2:50', String(await link.count() > 0)])
await p2.clock.fastForward('00:15')
await p2.waitForTimeout(300)
log.push(['"Entrar igual" visible a los 3:05', String(await link.count() > 0)])

const esperado = ['false','true','false','false','true','true','false','false','true','false','true','false','true','true','false','false','true']
let ok = errs.length === 0
log.forEach(([paso, v], i) => { const bien = v === esperado[i]; ok &&= bien; console.log(bien ? '✓' : '✗', paso, '→', v) })
if (errs.length) console.log('errores de página:', errs)
await b.close()
process.exit(ok ? 0 : 1)
