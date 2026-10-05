// Cada captura WEB de la guía: con qué cuenta demo de staging, a qué pantalla
// ir, qué hacer antes y qué marcar con un número. El número es el que explica
// src/guia/contenido.js. Las de la app viven en tomas-app.mjs.
//
// Si una marca "no aparece", cambió el texto o la clase en la pantalla: se
// ajusta el selector acá y se vuelve a correr sólo esa toma.

const PAC = 'paciente.completo@staging.healthier.app'
const PRO = 'clinica@staging.healthier.app'
const NUTRI = 'nutricion@staging.healthier.app'
const PENDIENTE = 'pendiente@staging.healthier.app'
const FARMACIA = 'farmacia@staging.healthier.app'
const DESPACHO = 'despacho@staging.healthier.app'
const CHOFER = 'chofer@staging.healthier.app'
const SA = 'superadmin@healthier.app'

// Las consultas fijas que deja scripts/seed-staging.mjs.
const CONSULTA_EN_CURSO = '5eed2001-0000-4000-8000-000000000001'
const CONSULTA_PRESENCIAL = '5eed2003-0000-4000-8000-000000000003'
const CONSULTA_COMPLETADA = '5eed2004-0000-4000-8000-000000000004'

// Un selector diferido (recibe la página), que se puede encadenar como un
// locator de Playwright: css('x').locator('..').or(txt('y')).first()
const L = (fn) => {
  const f = (p) => fn(p)
  const con = (v, p) => (typeof v === 'function' ? v(p) : v)
  f.or = (o) => L((p) => fn(p).or(con(o, p)))
  f.locator = (s) => L((p) => fn(p).locator(s))
  f.first = () => L((p) => fn(p).first())
  f.last = () => L((p) => fn(p).last())
  f.filter = (o) => L((p) => fn(p).filter({ ...o, ...(o.has ? { has: con(o.has, p) } : {}) }))
  return f
}
const css = (s) => L((p) => p.locator(s))
const txt = (t, sel = '*') => L((p) => p.locator(sel, { hasText: t }))
const rol = (r, name) => L((p) => p.getByRole(r, { name }))
const tour = (k) => css(`[data-tour="${k}"]`)
const esperar = (p, ms) => p.waitForTimeout(ms)
const clic = async (p, loc, ms = 900) => { await loc.first().click(); await esperar(p, ms) }
/** Sube el elemento hasta arriba de la pantalla, con un margen. */
const subir = async (p, loc, margen = 90) => {
  await loc.first().evaluate((el, m) => { const y = el.getBoundingClientRect().top + window.scrollY - m; window.scrollTo(0, y) }, margen)
  // Las páginas del paciente scrollean adentro de un contenedor, no la ventana.
  await loc.first().evaluate((el, m) => {
    let c = el.parentElement
    while (c && !(c.scrollHeight > c.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement
    if (c) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - m
  }, margen)
  await esperar(p, 500)
}

export const TOMAS = [
  // ── Paciente (web, en el teléfono) ───────────────────────────────────────
  { id: 'pac-ondemand', quien: PAC, movil: true, url: '/paciente/ondemand/clinica', espera: 4000,
    antes: (rest) => rest('professional_profiles', 'user_id=eq.5eed0001-0000-4000-8000-000000000001',
      { is_on_demand: true, on_demand_last_seen_at: new Date().toISOString() }),
    marcas: [
      [1, txt('Espera hasta', '*').locator('xpath=ancestor::div[contains(@class,"rounded")][1]')], [2, txt('.000', 'p,span')], [3, txt('Pagar con una tarjeta nueva', 'button').or(css('[data-card-id], label:has(input[type=radio])'))], [4, txt(/Pagar \$|Pagar e iniciar/, 'button')]] },
  { id: 'pac-reservar', quien: PAC, movil: true, url: '/paciente/reservar', pasos: async (p) => {
      await clic(p, p.getByRole('button', { name: /Clínica/ }), 1200) },
    marcas: [[1, rol('heading', '¿Cómo querés consultar?')], [2, txt('Videoconsulta', 'button')], [3, txt('Continuar', 'button')]] },
  { id: 'pac-pago', quien: PAC, movil: true, url: '/paciente/reservar', pasos: async (p) => {
      const ver = (loc) => loc.first().isVisible().catch(() => false)
      await clic(p, p.getByRole('button', { name: /Clínica/ }), 1200)
      // El asistente avanza con "Continuar"; en cada paso se elige lo primero que sirva.
      for (let i = 0; i < 12; i++) {
        const pagar = p.locator('button', { hasText: 'Ir al pago' })
        if (await ver(pagar)) { await clic(p, pagar, 3000); break }
        if (await ver(p.getByText('¿Cuándo?'))) {
          const dias = p.locator('button').filter({ hasText: /\d{2}\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i })
          for (let d = 1; d < Math.min(await dias.count(), 8); d++) {
            await clic(p, dias.nth(d), 1000)
            const hora = p.locator('button', { hasText: /^\s*\d{1,2}:\d{2}\s*$/ })
            if (await ver(hora)) { await clic(p, hora, 600); break }
          }
          await clic(p, p.locator('button', { hasText: 'Ver resumen' }), 1300)
          continue
        }
        if (await ver(p.getByText('Elegí tu profesional'))) await clic(p, p.locator('button', { hasText: 'Dra. Valentina' }), 400)
        if (await ver(p.locator('button', { hasText: 'Videoconsulta' })) && i === 0) await clic(p, p.locator('button', { hasText: 'Videoconsulta' }), 400)
        const seguir = p.locator('button', { hasText: 'Continuar' })
        if (await ver(seguir)) await clic(p, seguir, 1300)
        else { const d = p.locator('button', { hasText: /^(Lun|Mar|Mié|Jue|Vie|Sáb|Dom)/ }); if (await d.count() > 1) await clic(p, d.nth(1), 1000) }
      } },
    marcas: [
      [1, txt('Resumen', 'div,section')], [2, txt('Healthy Credits', 'div,label')], [3, txt('Método de Pago', 'div,section')], [4, txt('Confirmar y Pagar', 'button')]] },
  { id: 'pac-cancelar', quien: PAC, movil: true, url: '/paciente/consultas', pasos: async (p) => {
      await clic(p, p.getByRole('button', { name: 'Cancelar', exact: true }), 900) },
    marcas: [[1, txt('anticipación', 'p,div')], [2, css('textarea')], [3, txt('Sí, cancelar', 'button')]] },
  { id: 'pac-sala', quien: PAC, movil: true, url: `/paciente/sala-espera/${CONSULTA_EN_CURSO}`, espera: 2500,
    antes: (rest) => rest('consultations', `id=eq.${CONSULTA_EN_CURSO}`, { preconsulta_data: null }),
    marcas: [
      [1, css('form, [role="radiogroup"], fieldset').or(txt('¿Qué te pasa?', 'div'))], [2, txt('Continuar', 'button')]] },
  { id: 'pac-videollamada', quien: PAC, movil: true, url: `/paciente/videollamada/${CONSULTA_EN_CURSO}`, espera: 4000,
    antes: (rest) => rest('consultations', `id=eq.${CONSULTA_EN_CURSO}`, { preconsulta_data: { main_complaint: 'Dolor de garganta', symptoms: ['Fiebre'], desde: 'hace 2 días' } }),
    pasos: async (p) => {
      for (let i = 0; i < 6 && await p.getByText('¿Qué te pasa?').or(p.getByText(/Paso \d de \d/)).first().isVisible().catch(() => false); i++) {
        const op = p.locator('label, button[role="checkbox"], [role="option"]').filter({ hasText: /Fiebre|No|Ninguno/ }).first()
        if (await op.count()) await op.click().catch(() => {})
        const seguir = p.locator('button', { hasText: /Continuar|Siguiente|Ingresar|Entrar/ }).last()
        if (!(await seguir.count())) break
        await seguir.click().catch(() => {}); await esperar(p, 1200)
      } },
    marcas: [
      [1, txt('Tu código', 'span,div,button')], [2, css('button[title="Apagar cámara"], button[title="Silenciar micrófono"]')], [3, txt('Salir', 'button')]] },
  { id: 'pac-resumen', quien: PAC, movil: true, url: `/paciente/consulta/resumen/${CONSULTA_COMPLETADA}`, espera: 2000, marcas: [
      [1, txt('Resumen', 'p,h2,h3').first().locator('..')], [2, txt('Diagnóstico', 'p,h2,h3').first().locator('..')], [3, txt('Indicaciones', 'p,h2,h3').first().locator('..')]] },
  { id: 'pac-receta', quien: PAC, movil: true, url: '/paciente/recetas', pasos: async (p) => {
      await clic(p, p.getByRole('button', { name: /Ver/ }), 1500) },
    marcas: [[1, txt('PDF', 'a,button')], [2, txt('Medicamentos recetados', 'div,section')], [3, txt('Comprar', 'button')]] },
  { id: 'pac-biovisor', quien: PAC, movil: true, url: '/paciente/biovisor', pasos: async (p) => {
      await clic(p, p.getByRole('button', { name: 'Parámetros' }), 1200) },
    marcas: [[1, css('[role="tablist"]').or(txt('Subir', 'button').locator('..'))], [2, txt('Normal', 'span').locator('xpath=ancestor::*[self::li or self::div][1]')]] },
  { id: 'pac-nutriplan', quien: PAC, movil: true, url: '/paciente/nutriplan', espera: 2000, marcas: [
      [1, txt('Calorías del día', 'div,section')], [2, txt('Ahora', 'span').locator('xpath=ancestor::div[2]')]] },
  { id: 'pac-mascotas', quien: PAC, movil: true, url: '/paciente/documentos', pasos: async (p) => {
      await clic(p, p.getByRole('button', { name: /Amigo Peludo/ }), 1200) },
    marcas: [[1, txt('Mora', '*').last().locator('xpath=ancestor::div[2]')], [2, txt('Agregar mascota', 'button')]] },
  { id: 'pac-farmacia', quien: PAC, movil: true, url: '/paciente/farmacia', espera: 2500, marcas: [
      [1, css('input[placeholder="Buscar productos..."]')], [2, txt('Recetados por tu médico', 'section,div,h2')], [3, css('button[aria-label^="Agregar"]').or(txt('Agregar', 'button'))], [4, txt('Mis pedidos', 'button,a')]] },
  { id: 'pac-pedido', quien: PAC, movil: true, url: '/paciente/farmacia/pedidos', pasos: async (p) => {
      await clic(p, p.locator('a,button', { hasText: /En camino|Enviado/ }), 1500) },
    marcas: [[1, txt('En camino', 'div,section,p')], [2, txt('Código de entrega', 'div,section,p')]] },
  { id: 'pac-familiar', quien: PAC, movil: true, url: '/paciente/perfil', pasos: async (p) => {
      await subir(p, p.locator('h3', { hasText: 'Grupo Familiar' }))
      await clic(p, p.locator('h3', { hasText: 'Grupo Familiar' }).locator('xpath=ancestor::div[2]').locator('button, a').filter({ hasNotText: /AÑADIR/ }).first(), 1500) },
    marcas: [[1, txt('Reservar turno', 'a,button')], [2, txt('Historia clínica', 'a,button')], [3, txt('Generar código de acceso', 'button')]] },
  { id: 'pac-acceso-familiar', quien: null, movil: true, url: '/acceso-familiar', marcas: [
      [1, css('#pin-familiar')], [2, txt('Entrar', 'button')]] },
  { id: 'pac-sos', quien: PAC, movil: true, url: '/paciente/sos', espera: 2500, marcas: [
      [1, css('a[href="tel:107"]').or(txt('107', 'p,div'))], [2, txt('no te lo cobramos', 'p,div')], [3, txt('Reservar', 'button')]] },

  // ── Profesional (web, escritorio) ────────────────────────────────────────
  { id: 'pro-onboarding', quien: PENDIENTE, url: '/profesional/onboarding?resubmit=1', espera: 2500, marcas: [
      [1, txt('Especialidad', 'nav,ol,div.flex').filter({ hasText: 'Revisión' })], [2, txt('¿Cuál es tu profesión?', 'label,div,fieldset')], [3, txt('Nota nueva', 'p,span,div').last().locator('..')]] },
  { id: 'pro-revision', quien: PENDIENTE, url: '/profesional/dashboard', espera: 2500, marcas: [
      [1, txt('Te faltan subir documentos', 'div,section').or(txt('Perfil en revisión', 'div,section')).last()], [2, txt('Conectá tu Mercado Pago', 'div,section')], [3, tour('pro-practica')], [4, tour('pro-checklist')]] },
  { id: 'pro-inicio', quien: PRO, url: '/profesional/dashboard', espera: 2500, marcas: [
      [1, tour('pro-ondemand')], [2, tour('pro-referido')], [3, tour('pro-stats')], [4, tour('pro-ganancias')], [5, txt('Consultas de hoy', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [6, css('aside nav')]] },
  { id: 'pro-agenda', quien: PRO, url: '/profesional/agenda', espera: 2000, marcas: [
      [1, txt('Hoy', 'div,section').filter({ has: css('a,button') })], [2, txt('Horario semanal', 'div,section')], [3, css('button[title="Agregar franja"]')]] },
  { id: 'pro-tarifas', quien: PRO, url: '/profesional/configuracion?tab=tarifas', espera: 2000, marcas: [
      [1, txt('Tarifas', 'button').locator('..')], [2, txt('Modalidad y zona', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [3, txt('Precio base por modalidad', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [4, txt('Guardar tarifas', 'button')]] },
  { id: 'pro-cuenta', quien: PRO, url: '/profesional/configuracion?tab=cuenta', espera: 2000, marcas: [
      [1, txt('Mercado Pago', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [2, txt('Conectar', 'a,button').or(txt('Desconectar', 'button'))]] },
  { id: 'pro-firma', quien: PRO, url: '/profesional/configuracion?tab=firma', espera: 2000, marcas: [
      [1, css('canvas').or(txt('Tu firma', 'h2'))]] },
  { id: 'pro-sala', quien: PRO, url: '/profesional/videollamada/simulacion', espera: 4000, pasos: async (p) => {
      const cerrar = p.locator('button', { hasText: /Entendido|Empezar|Cerrar guía|Omitir/ })
      if (await cerrar.count()) await clic(p, cerrar, 600) },
    marcas: [[1, txt('Ingresar paciente', 'button').locator('xpath=ancestor::div[3]')], [2, tour('tab-nota').locator('..')], [3, tour('preconsulta')], [4, tour('botones-nota')]] },
  { id: 'pro-receta', quien: PRO, url: '/profesional/videollamada/simulacion', espera: 4000, pasos: async (p) => {
      await clic(p, p.locator('[data-tour="tab-receta"]'), 1500) },
    marcas: [[1, txt('cobertura', 'div,section').filter({ has: css('button') })], [2, txt('Recetar medicamentos', 'button').locator('..')]] },
  { id: 'pro-cerrar', quien: PRO, url: '/profesional/videollamada/simulacion', espera: 4000, pasos: async (p) => {
      await clic(p, p.locator('[data-tour="tab-cerrar"]'), 1500) },
    marcas: [[1, txt('Solicitar código al paciente', 'button')], [2, css('input[inputmode="numeric"], input[maxlength="4"]')]] },
  { id: 'pro-presencial', quien: 'pediatria@staging.healthier.app', url: `/profesional/consulta/${CONSULTA_PRESENCIAL}`, espera: 2500, marcas: [
      [1, txt('Ingresar a la consulta', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [2, txt('Ingresar', 'button')]] },
  { id: 'pro-pacientes', quien: PRO, url: '/profesional/pacientes', espera: 2000, marcas: [
      [1, css('input[placeholder="Buscar paciente..."]')], [2, css('table tbody tr, a[href^="/profesional/paciente/"]')]] },
  { id: 'pro-historial', quien: PRO, url: '/profesional/historial', espera: 2000, marcas: [
      [1, txt('Completadas', 'button').locator('..')], [2, css('a[href^="/profesional/consulta/"]')]] },
  { id: 'pro-nutriplan', quien: NUTRI, url: '/profesional/nutriplan', espera: 2000, pasos: async (p) => {
      const s = p.locator('select').first()
      const opciones = await s.locator('option').allTextContents()
      const una = opciones.find((o) => o && !o.includes('Elegí'))
      if (una) { await s.selectOption({ label: una }); await esperar(p, 1500) } },
    marcas: [[1, css('select').first()], [2, txt('Monitoreo', 'button').locator('..')], [3, txt('Guardar plan', 'button')]] },
  { id: 'pro-ganancias', quien: PRO, url: '/profesional/ganancias', espera: 2500, marcas: [
      [1, txt('Este mes', 'button').locator('..')], [2, txt('Neto — Este mes', '*').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [3, txt('Evolución mensual', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [4, txt('Historial de pagos', 'h2')]] },
  { id: 'pro-perfil', quien: PRO, url: '/profesional/perfil', espera: 2000, marcas: [
      [1, css('#campo-nombre')], [2, txt('Dirección del consultorio', 'label')], [3, txt('Guardar cambios', 'button')]] },
  { id: 'pro-ayuda', quien: PRO, url: '/profesional/ayuda', espera: 1500, marcas: [
      [1, txt('Practicá una videoconsulta', 'a,button')], [2, txt('Volver a ver el recorrido', 'button')], [3, txt('WhatsApp', 'a,button')]] },

  // ── Farmacia (web) ───────────────────────────────────────────────────────
  { id: 'far-pedidos', quien: FARMACIA, url: '/farmacia/pedidos', espera: 2000, marcas: [
      [1, css('h1:has-text("Pedidos")')], [2, css('select.form-select').first().locator('..')], [3, css('tbody tr').first()], [4, css('tbody tr button').first()]] },
  { id: 'far-pedido', quien: FARMACIA, url: '/farmacia/pedidos', pasos: async (p) => {
      await clic(p, p.locator('tbody tr', { hasText: 'Entregar con código' }), 1800) },
    marcas: [[1, css('h1.font-mono').locator('..')], [2, txt('Paciente', 'p').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [3, txt('Medicamentos', 'p,h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [4, txt('Neto farmacia', '*').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [5, css('input[placeholder="----"]').locator('..')]] },
  { id: 'far-cancelar', quien: FARMACIA, url: '/farmacia/pedidos', pasos: async (p) => {
      await clic(p, p.locator('tbody tr', { hasText: 'Pendiente' }), 1800)
      await clic(p, p.locator('button', { hasText: 'Cancelar pedido' }), 800)
      await subir(p, p.locator('textarea'), 260) },
    marcas: [[1, css('textarea.form-textarea, textarea')], [2, txt('Confirmar cancelación', 'button')]] },
  { id: 'far-entregar', quien: FARMACIA, url: '/farmacia/pedidos', pasos: async (p) => {
      await clic(p, p.locator('tbody tr', { hasText: 'Entregar con código' }), 1800)
      await subir(p, p.locator('input[placeholder="----"]'), 320) },
    marcas: [[1, css('input[placeholder="----"]').locator('xpath=ancestor::*[contains(@class,"card")][1]')]] },
  { id: 'far-catalogo', quien: FARMACIA, url: '/farmacia/catalogo', espera: 3000, marcas: [
      [1, css('h1:has-text("Catálogo")')], [2, txt('Exportar Excel', 'button')], [3, txt('Importar Excel', 'button')], [4, css('table')], [5, css('button[aria-pressed]')], [6, css('button[aria-label^="Subir foto de"], button[aria-label^="Cambiar foto de"]')]] },
  { id: 'far-configuracion', quien: FARMACIA, url: '/farmacia/configuracion', espera: 2000, marcas: [
      [1, txt('Mercado Pago', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [2, txt('Datos de la farmacia', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [3, txt('Guardar', 'button')]] },

  // ── Emergencias (web; la tripulación, en el teléfono) ────────────────────
  { id: 'emg-cola', quien: DESPACHO, url: '/despacho', espera: 2500, marcas: [
      [1, txt('Esperando móvil', 'h2')], [2, css('span.uppercase').first()], [3, txt('Asignar móvil', 'button')], [4, txt('En curso', 'h2')]] },
  { id: 'emg-asignar', quien: DESPACHO, url: '/despacho', pasos: async (p) => {
      await clic(p, p.locator('button', { hasText: 'Asignar móvil' }), 1500) },
    marcas: [[1, txt('Asignar', 'button').filter({ hasNotText: 'móvil' }).locator('..')], [2, txt('Asignar', 'button').filter({ hasNotText: 'móvil' })]] },
  { id: 'emg-mapa', quien: DESPACHO, url: '/despacho/mapa', espera: 5000, marcas: [
      [1, css('.mapboxgl-canvas')], [2, txt('Sin posición reciente', 'p,div').or(txt('Toda la flota reporta', 'p'))]] },
  { id: 'emg-ambulancias', quien: DESPACHO, url: '/despacho/ambulancias', espera: 2000, marcas: [
      [1, txt('Nuevo móvil', 'button')], [2, css('.card').filter({ has: css('select') }).first()]] },
  { id: 'emg-configuracion', quien: DESPACHO, url: '/despacho/configuracion', espera: 2000, marcas: [
      [1, txt('Datos de la entidad', 'h2')], [2, css('input[placeholder="El que ve el paciente en un código ROJO"]')], [3, txt('Equipo', 'h2')]] },
  { id: 'emg-tripulacion', quien: CHOFER, movil: true, url: '/profesional/emergencias', espera: 3000, marcas: [
      [1, txt('UTM-', 'h1,h2,p').first().locator('..')], [2, txt('Navegar al paciente', 'a,button')], [3, txt('Llegué al paciente', 'button')]] },

  // ── Super admin (web) ────────────────────────────────────────────────────
  { id: 'sa-dashboard', quien: SA, url: '/super-admin/dashboard', espera: 3000, marcas: [
      [1, txt('Pendientes de verificación', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [2, txt('Prospectos — Profesionales', 'h2').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [3, css('aside nav')]] },
  { id: 'sa-profesionales', quien: SA, url: '/super-admin/profesionales', espera: 3000, marcas: [
      [1, txt('Pendientes', 'button').locator('..')], [2, css('input[placeholder="Buscar profesional…"]')], [3, css('table thead')]] },
  { id: 'sa-profesional', quien: SA, url: '/super-admin/profesionales?filter=pendientes', pasos: async (p) => {
      await clic(p, p.locator('tbody tr').first(), 1800) },
    marcas: [[1, txt('Credenciales y datos para recetar', '*').locator('..')], [2, txt('Verificar manualmente', 'button').locator('..')]] },
  { id: 'sa-recorrido', quien: SA, url: '/super-admin/profesionales/recorrido', espera: 3000, marcas: [
      [1, txt('30 días', 'button').locator('..')], [2, txt('Enviaron para verificar', '*').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [3, css('svg').last()]] },
  { id: 'sa-pagos', quien: SA, url: '/super-admin/pagos', espera: 3000, marcas: [
      [1, txt('Facturado (bruto)', '*').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [2, txt('Devoluciones', 'h2')], [3, txt('Filtrar', 'button').locator('..')]] },
  { id: 'sa-consultas', quien: SA, url: '/super-admin/consultas', espera: 3000, marcas: [
      [1, css('input[placeholder="Paciente o profesional, nombre o email"]')], [2, css('select').first().locator('..')], [3, css('tbody tr').first()]] },
  { id: 'sa-emergencias', quien: SA, url: '/super-admin/emergencias', espera: 3000, marcas: [
      [1, txt('Coordinador de ambulancias', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')], [2, css('input[placeholder="Buscar por nombre o mail"]')], [3, css('tbody tr').first()]] },
  { id: 'sa-pacientes', quien: SA, url: '/super-admin/usuarios', espera: 3000, marcas: [
      [1, txt('Con consultas', 'button').locator('..')], [2, txt('Exportar CSV', 'button')], [3, css('tbody tr').first()]] },
  { id: 'sa-farmacia', quien: SA, url: '/super-admin/farmacia', espera: 3000, marcas: [
      [1, txt('GMV', 'p').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [2, css('table')]] },
  { id: 'sa-auditoria', quien: SA, url: '/super-admin/auditoria', espera: 3000, marcas: [
      [1, txt('Recetas electrónicas', 'button').locator('..')], [2, css('input[placeholder="Buscar por profesional o paciente…"]')]] },
  { id: 'sa-mails', quien: SA, url: '/super-admin/mails', espera: 3000, marcas: [
      [1, txt('Últimas 24 h', '*').locator('xpath=ancestor::div[contains(@class,"grid")][1]')], [2, css('select').first().locator('..')], [3, css('tbody tr, ul li').first()]] },
  { id: 'sa-settings', quien: SA, url: '/super-admin/settings', espera: 2500, marcas: [
      [1, txt('Comisión Healthier (%)', 'label').locator('..')], [2, txt('Ventana de reembolso', 'label').locator('..')], [3, txt('Turnos', 'h2').locator('xpath=ancestor::*[contains(@class,"card")][1]')]] },
  { id: 'sa-verticales', quien: SA, url: '/super-admin/verticales', espera: 2500, alto: 1350, marcas: [
      [1, txt('Especialidades', 'button').locator('..')], [2, css('tbody tr, .card').filter({ has: css('input') }).first()], [3, txt('Emergencias S.O.S', '*').locator('xpath=ancestor::div[2]')]] },
  { id: 'sa-zonas', quien: SA, url: '/super-admin/zonas', espera: 2500, marcas: [
      [1, txt('Lista de espera', 'button').locator('..')], [2, css('input[placeholder="Nueva zona (ej. Villa Crespo)"]').locator('..')]] },
  { id: 'sa-admins', quien: SA, url: '/super-admin/admins', espera: 2500, marcas: [
      [1, txt('Agregar admin', 'button')], [2, css('table')]] },
]
