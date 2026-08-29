/**
 * E2E test — Alta de cuenta de paciente
 *
 * Pensado para correr contra un entorno DEPLOYADO (staging o producción)
 * después de cada deploy — ver playwright.config.js para cómo apuntarlo con
 * E2E_BASE_URL. Atraviesa el formulario real de /registro en el browser (no
 * llama a supabase.auth.signUp() directo), porque lo que se rompió el
 * 2026-07-03 fue una policy de RLS de INSERT faltante en `profiles`: todo
 * signup fallaba en producción sin que nada lo avisara, y un test que le
 * pegara a la API de auth por atrás no lo habría detectado — sólo un test que
 * pasa por el mismo camino que un paciente real (form → toast de error si lo
 * hay → fila en profiles → sesión que lee su propio perfil) cachea ese tipo
 * de bug.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// 🔴 El browser y la base tienen que ser del MISMO entorno. `playwright.config.js`
// completa con `??=` lo que falte desde `.env.test`, que apunta a producción: si
// alguien apunta E2E_BASE_URL a staging sin pasar las claves de staging, el test
// crea el usuario en una base y lo busca en la otra — falla con un mensaje que
// parece un bug de la app, y encima deja la cuenta colgada porque la limpieza
// también mira la base equivocada. Pasó de verdad, por eso está esta guarda.
const ENTORNO_POR_HOST = {
  'gethealthier.vercel.app': 'aixjejdoofervrkggbkd',
  'gethealthier-staging.vercel.app': 'itjhrvlzuqvyhqtffumc',
}

function verificarEntornoCoherente() {
  const baseUrl = process.env.E2E_BASE_URL
  if (!baseUrl) return // corrida local contra el dev server: no aplica
  const host = new URL(baseUrl).hostname
  const refEsperado = ENTORNO_POR_HOST[host]
  if (!refEsperado) return // URL de preview u otra: no sabemos, no bloqueamos
  const refReal = new URL(SUPABASE_URL).hostname.split('.')[0]
  if (refReal !== refEsperado) {
    throw new Error(
      `Entornos cruzados: E2E_BASE_URL apunta a ${host} (base ${refEsperado}) ` +
      `pero VITE_SUPABASE_URL apunta a ${refReal}. El test crearía la cuenta en ` +
      `una base y la buscaría en la otra. Pasá las claves de Supabase del mismo ` +
      `entorno que la URL.`
    )
  }
}

// Prefijo obligatorio de toda identidad descartable que crea este test — la
// guarda de limpieza de abajo revienta si no lo ve, así nunca puede llegar a
// borrar la cuenta de un usuario real por un bug en el test.
const QA_PREFIX = 'qa-alta-'

function identidadDescartable() {
  const stamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    fullName: 'QA Alta Automatizada',
    email: `${QA_PREFIX}${stamp}-${rand}@healthier.app`,
    // Formato argentino con celular (+54 9 ...) — el form no valida más que
    // "requerido", pero queremos algo realista.
    phone: `+549 11 ${String(Math.floor(1000 + Math.random() * 9000))}-${String(Math.floor(1000 + Math.random() * 9000))}`,
    // Password fuerte generada en el momento — nunca hardcodeada, nunca la de
    // una cuenta real.
    password: `Qa${rand}${stamp.toString(36)}!Aa1`,
  }
}

// supabase-js guarda la sesión en localStorage bajo `sb-<project-ref>-auth-token`
// (clave por defecto, sin storageKey custom en src/lib/supabase.js). La leemos
// para recuperar el id del usuario recién creado aunque el test falle antes de
// llegar a /paciente/onboarding — el signUp ya dejó la cuenta creada en ese
// punto, y la limpieza tiene que poder encontrarla igual.
function projectRefFromUrl(url) {
  return new URL(url).hostname.split('.')[0]
}

async function leerSesionDelBrowser(page) {
  const storageKey = `sb-${projectRefFromUrl(SUPABASE_URL)}-auth-token`
  try {
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.user ?? parsed?.session?.user ?? null
  } catch {
    // Página ya navegó/cerró, o el storage no tiene lo que esperamos — no es
    // motivo para que la limpieza explote, sólo no vamos a tener el id acá.
    return null
  }
}

test.describe('Alta de cuenta de paciente', () => {
  /** @type {{ email: string, id: string | null } | null} */
  let creado = null

  test('completa el formulario real y crea una cuenta operativa', async ({ page }) => {
    verificarEntornoCoherente()

    const identidad = identidadDescartable()
    creado = { email: identidad.email, id: null }

    await page.goto('/registro')
    await page.getByRole('button', { name: /Continuar con email/i }).click()

    await page.locator('input[type="text"]').fill(identidad.fullName)
    await page.locator('input[type="email"]').fill(identidad.email)
    await page.locator('input[type="tel"]').fill(identidad.phone)
    await page.locator('input[type="password"]').fill(identidad.password)

    // El texto del error real vive en el <p> del toast (ver src/components/Toast.jsx).
    const toastError = page.locator('.fixed.top-4.right-4.z-50 p').first()

    await page.locator('button[type="submit"]').click()

    // Carrera entre llegar a onboarding y que aparezca un toast de error —
    // cualquiera de los dos puede pasar primero, y ambos son informativos.
    await Promise.race([
      page.waitForURL('**/paciente/onboarding', { timeout: 15_000 }),
      toastError.waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => { /* si ninguno pasó a tiempo, los asserts de abajo lo explican */ })

    // Capturamos el id ANTES de los asserts: si signUp() ya creó la cuenta en
    // auth.users pero algo después falla, igual queremos poder limpiarla.
    const user = await leerSesionDelBrowser(page)
    if (user?.id) creado.id = user.id

    // Assert 1 — nada de mensaje de error en pantalla. Si lo hay, el test
    // falla mostrando el texto REAL del error (regla dura del proyecto: nunca
    // un mensaje genérico).
    if (await toastError.isVisible().catch(() => false)) {
      const mensaje = await toastError.textContent()
      throw new Error(`El alta de cuenta mostró un error en pantalla: "${mensaje?.trim()}"`)
    }

    // Assert 2 — terminó en el onboarding del paciente.
    await expect(page).toHaveURL(/\/paciente\/onboarding/, { timeout: 15_000 })

    // Si por algún motivo no lo capturamos antes (la navegación fue más
    // rápida que el evaluate), lo intentamos de nuevo ya en onboarding.
    if (!creado.id) {
      const userTrasNavegar = await leerSesionDelBrowser(page)
      if (userTrasNavegar?.id) creado.id = userTrasNavegar.id
    }

    // Assert 3 (la importante) — con service role, la fila de `profiles`
    // existe con role='patient' y el full_name que se mandó. Esto es lo que
    // habría cazado el bug del 2026-07-03 (faltaba la policy de INSERT y todo
    // signup fallaba en silencio).
    //
    // Se reintenta ~10s porque el perfil lo crea un trigger sobre auth.users
    // (`crear_perfil_al_registrarse`), y en una sola consulta esto sale flaky:
    // el browser llega a /paciente/onboarding antes de que la fila esté
    // visible. Reintentar no debilita el assert — si la policy de INSERT no
    // está, la fila no aparece nunca y el test falla igual, que es el caso que
    // importa. Un test intermitente es peor que no tener test: se ignora.
    let perfil = null
    let perfilError = null
    for (let intento = 0; intento < 20; intento++) {
      const r = await adminSb
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('email', identidad.email)
        .maybeSingle()
      if (r.data) { perfil = r.data; break }
      perfilError = r.error
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (!perfil) {
      throw new Error(
        `No se encontró la fila en profiles para ${identidad.email} después de 10s: ` +
        `${perfilError?.message ?? 'la consulta no devolvió filas'}. ` +
        `Es el síntoma exacto del bug del 2026-07-03 (faltaba la policy de INSERT en profiles).`
      )
    }

    creado.id = perfil.id // fuente de verdad para la limpieza, service role de por medio

    expect(perfil.role).toBe('patient')
    expect(perfil.full_name).toBe(identidad.fullName)

    // Assert 4 — la sesión sirve de verdad: con la anon key, un login nuevo
    // de ESTE usuario puede leer su propio perfil. Si esto falla, las
    // policies de lectura no funcionan para un usuario recién creado (que es
    // exactamente el caso que le pasa a todo paciente nuevo).
    const anonSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: loginData, error: loginError } = await anonSb.auth.signInWithPassword({
      email: identidad.email,
      password: identidad.password,
    })
    if (loginError || !loginData?.session) {
      throw new Error(`El login con anon key falló para ${identidad.email}: ${loginError?.message}`)
    }

    const { data: propioPerfil, error: propioPerfilError } = await anonSb
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', loginData.user.id)
      .single()

    if (propioPerfilError || !propioPerfil) {
      throw new Error(
        `Con la sesión del usuario recién creado (anon key) no se pudo leer su propio perfil: ${propioPerfilError?.message ?? 'sin datos'}`
      )
    }
    expect(propioPerfil.id).toBe(perfil.id)

    await anonSb.auth.signOut().catch(() => {})
  })

  test.afterEach(async () => {
    if (!creado) return

    // Guarda dura: si el email no matchea el patrón de descarte, no se borra
    // nada. Un bug en el test nunca puede terminar borrando una cuenta real.
    if (!creado.email.startsWith(QA_PREFIX)) {
      throw new Error(
        `Guarda de limpieza: "${creado.email}" no empieza con "${QA_PREFIX}" — NO se intenta borrar nada.`
      )
    }

    // Sin id no podemos asumir que no hay nada que limpiar: el caso que este
    // test existe para detectar —usuario creado en auth pero sin fila en
    // `profiles`— es justamente uno donde el id no aparece por ninguno de los
    // dos caminos de arriba. Buscarlo por email en auth.users antes de rendirse,
    // o el test dejaría una cuenta colgada en producción cada vez que falla.
    if (!creado.id) {
      const { data, error: listError } = await adminSb.auth.admin.listUsers({ perPage: 200 })
      if (listError) {
        console.error(
          `⚠️  No se pudo buscar al usuario de prueba por email para limpiarlo: ${listError.message}\n` +
          `    email: ${creado.email} — revisar a mano.`
        )
        return
      }
      creado.id = data?.users?.find(u => u.email === creado.email)?.id ?? null
      if (!creado.id) return // el alta no llegó a crear nada
    }

    const { error } = await adminSb.auth.admin.deleteUser(creado.id)
    // `profiles` tiene FK a auth.users con ON DELETE CASCADE (001_initial_schema.sql),
    // así que borrar el usuario de auth alcanza para borrar también su perfil.

    if (error) {
      // Aviso fuerte: si la limpieza falla, alguien tiene que borrar esto a mano.
      console.error(
        `⚠️  LIMPIEZA FALLIDA — quedó colgado un usuario de prueba en la base.\n` +
        `    email: ${creado.email}\n` +
        `    id:    ${creado.id}\n` +
        `    error: ${error.message}\n` +
        `    Borrar a mano con supabase.auth.admin.deleteUser("${creado.id}").`
      )
      throw error
    }

    creado = null // que un reintento no vuelva a intentar borrar lo mismo
  })
})
