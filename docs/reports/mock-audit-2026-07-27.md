# Auditoría de mocks — Healthier (website + mobile)

**Fecha:** 2026-07-27
**Método:** grep exhaustivo por `mock/Mock/MOCK`, `setTimeout` fake, `TODO`/`FIXME`, `fake/dummy/simulat`, constantes `MOCK_*`, y chequeo de si cada servicio "real" del árbol de `services/` está efectivamente importado por alguna pantalla. Verificación en browser (Playwright headless contra `gethealthier.vercel.app` con las cuentas demo estables `paciente@healthier.app`/`paciente`) para los 2 hallazgos más grandes.

**Estado:** vigente a la fecha de arriba — es un snapshot, no un documento vivo. Re-correr el grep si pasa mucho tiempo.

---

## 🔴 Activos en producción — el usuario los ve

| # | Instancia | Archivo | Qué pasa realmente |
|---|-----------|---------|---------------------|
| 1 | **Bóveda / Documentos del paciente** | `website/src/pages/patient/Documents.jsx` | 100% mock. `MOCK_DOCS_BY_CATEGORY` hardcodeado, `handleUpload`/`simulatePhotoUpload` solo tocan estado local (con fotos de Unsplash hardcodeadas), nada persiste ni se lee de Supabase. **Hay un `documentsService.js` real y funcional (`upload`/`getByPatient`/`delete` contra Storage + tabla `medical_documents`) que no está importado en ningún lado** — el cableado ya existe, solo falta conectarlo. Verificado en vivo en `gethealthier.vercel.app` (screenshot). |
| 2 | **NutriPlan del paciente** | `website/src/pages/patient/NutriPlan.jsx` | 100% mock (`MOCK_MEALS`, `MOCK_FOODS`, `MOCK_PLAN`) — mismo plan para cualquier paciente, sin importar lo que el profesional haya armado. El lado profesional (`professional/NutriPlan.jsx`) sí usa `nutriplanService.js` real para crear planes — **esos planes reales nunca llegan al paciente**, que siempre ve el mismo mock. Recetas sugeridas llaman a Gemini directo con `VITE_GEMINI_API_KEY` (ver #5) — como esa key está vacía en prod, ni siquiera esa parte funciona (muestra "Configurá VITE_GEMINI_API_KEY"). Verificado en vivo (screenshot). |
| 3 | **Configuración general del super admin** | `website/src/pages/super-admin/Settings.jsx` (sección "General", líneas ~126-172) | El formulario "General" (nombre de plataforma, email de soporte, **Modo mantenimiento**, **Permitir registros**) tiene su propio `save()` que hace `setTimeout` + toast de éxito — no escribe en ningún lado. Los dos toggles (mantenimiento, registros) no bloquean nada real hoy; un super admin puede creer que activó modo mantenimiento y no pasa nada. Distinto de la sección de "Configuración de pagos" más arriba en el mismo archivo, que sí es real (`paymentsService.updatePlatformSettings`, confirmado persistente vía RLS en `catchup.md` 2026-07-24). |
| 4 | **Tracking de adherencia (profesional)** | `website/src/pages/professional/NutriPlan.jsx:1031` | `tracking`/`trackingHistory` inicializados en `[]` y nunca poblados — no hay backend. Siempre se ve vacío, no es dato falso sino una sección permanentemente no funcional. Comentario propio en el código ya lo marca (`// Tracking (mock — no backend yet)`). |
| 5 | **Triage de IA (website)** | `website/src/services/aiService.js` | Llama a Gemini real si `VITE_GEMINI_API_KEY` existe; si falla o la key está vacía, cae a `getMockMessage()` hardcodeado. **Confirmado: la key está vacía tanto en `.env` local como en las env vars de Vercel producción** → hoy en prod el triage de IA SIEMPRE devuelve el mensaje mock, nunca llama a Gemini. Coincide con lo ya documentado en `website/CLAUDE.md` (tabla de Mock Services). |
| 6 | **Pago y unidad de emergencia (website)** | `website/src/services/emergencyService.js` — `processPayment()` y `findUnit()` (usados por `patient/Emergency.jsx`) | El resto del servicio (`getById`, `getActiveForProfessional`, `updateStatus`, `subscribe`, `getByPatient`) es 100% real contra Supabase — pero **estos dos métodos siguen siendo mock puro** (`setTimeout` + valor hardcodeado, ej. "Móvil 42" / "Juan Pérez" / 4 min ETA). El `website/CLAUDE.md` decía "emergencyService.js" entero era mock — ya no es así, solo estos 2 métodos. |
| 7 | **Pago de consulta (mobile)** | `mobile/app/consultation/payment.tsx` | `MOCK_CARDS` hardcodeadas + `handlePay()` simula el cobro con `setTimeout(1500ms)` y después crea una `consultation` real con `paymentStatus: 'paid'` — **no hay ningún cobro real de Mercado Pago en mobile**, a diferencia de website que sí tiene MP Split Payments en producción (2026-07-24). Booking en mobile queda "pagado" en la DB sin que se haya cobrado nada de verdad. |
| 8 | **Pago de emergencia (mobile)** | `mobile/app/emergency/payment.tsx` | Mismo patrón: `MOCK_CARDS` + `setTimeout(1500ms)`, sin cobro real. Simétrico al hallazgo #6 del lado website. |
| 9 | **NutriPlan (mobile)** | `mobile/app/(tabs)/boveda/nutriplan.tsx` | `MOCK_MEALS`/`MOCK_FOODS`/`MOCK_DIST`/`MOCK_RESULTS`/`MOCK_PRO` — no existe ningún `NutriPlanService` en `mobile/src/services/`, a diferencia de website que sí tiene una mitad real (profesional). Mobile es 100% estático, sin ningún backend de por medio en ninguno de los dos lados. |
| 10 | **BioVisor (mobile)** | `mobile/app/(tabs)/boveda/biovisor.tsx` | `MOCK_HISTORY` hardcodeado, sin servicio real detrás. |
| 11 | **ETA de emergencia simulada (mobile)** | `mobile/app/emergency/map.tsx:30` | `INITIAL_ETA = 4` minutos hardcodeado, countdown puramente client-side (no viene de telemetría real de ubicación). El resto de la pantalla sí usa `EmergencyService.createEmergency`/`getById`/`updateStatus` reales contra Supabase — solo el countdown visual de ETA es fake. |

## 🟡 Código muerto — no afecta al usuario, pero conviene limpiar o resolver

| # | Instancia | Archivo | Detalle |
|---|-----------|---------|---------|
| 12 | `getMockResponse()` en AI Companion (website) | `website/src/services/companionService.js:5` | Nunca se llama — `sendMessage()` usa la Edge Function real `ai-companion` (Supabase). El companion de IA para profesionales **ya está 100% real**, este es solo resto de código sin usar. |
| 13 | `TriageService.ts` (mobile) | `mobile/src/services/TriageService.ts` | No está importado en ningún lado (`grep` exhaustivo sobre `mobile/app` y `mobile/src` no encuentra ningún caller). El comentario propio dice "mirrors website/src/services/aiService.js" pero el triage real de mobile (en `emergency/triage.tsx`, `consultation/preconsulta.tsx`, `walk-in/queue.tsx`) no pasa por acá — es código huérfano. |
| 14 | `getUnitLocation()` / `requestAmbulance()` (mobile) | `mobile/src/services/EmergencyService.ts:178,187` | Ambos con `@deprecated` o comportamiento fake (coordenadas random) y sin ningún caller — código muerto seguro de borrar. |

## 🟢 Falsos positivos — parecían mock, no lo son

| Instancia | Archivo | Por qué no cuenta |
|---|---|---|
| `window.__DailyIframeMock` | `website/src/pages/{patient,professional}/VideoCall.jsx` | Seam de testing (permite inyectar un Daily.co fake en e2e) — en uso normal la variable global es `undefined`, así que siempre cae al `DailyIframe` real. |
| `?demo=standby\|dispatched\|...` | `website/src/pages/professional/Emergencias.jsx:97` | Query param explícito solo para previsualizar estados en dev/QA — sin el param, la pantalla carga siempre contra `emergencyService` real. |
| "mockup" en comentario de Landing | `website/src/pages/Landing.jsx:56` | Se refiere a un mockup visual/diseño (imagen de producto en el hero), no a datos o lógica simulada. |
| `setTimeout` en `ia.tsx`, `MapArea.native.tsx`, `AddressAutocomplete.tsx`, `booking/searching-pro.tsx`, `consultation/waiting.tsx` (mobile) | varios | Debounce de inputs o animaciones de scroll/transición — no simulan datos ni respuestas de backend. |

---

## Resumen priorizado (si Mateo quiere atacar esto)

1. **Bóveda del paciente (#1)** — el más barato de arreglar: el servicio real (`documentsService.js`) ya existe, solo falta conectarlo a la pantalla.
2. **Pago mobile sin cobro real (#7, #8)** — el de mayor impacto de negocio: hoy se puede reservar y "pagar" una consulta en mobile sin que se cobre nada de verdad.
3. **NutriPlan paciente vs. profesional desconectados (#2)** — un profesional puede armar un plan real que el paciente nunca ve.
4. **Toggle de super-admin que no hace nada (#3)** — riesgo de que alguien confíe en "Modo mantenimiento" creyendo que está activo.
5. El resto (#4-#6, #9-#11) son gaps conocidos/documentados o de menor impacto inmediato.
6. Código muerto (#12-#14) — limpieza de bajo riesgo, sin apuro.
