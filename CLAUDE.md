# Claude Code Project Guide

This document provides context for Claude Code when working on this React/Supabase project.

> **🚀 MANDATORY — Vercel deploy check:** After every `git push`, verify the deploy succeeded. **The Vercel API token in `~/Local/.env` does NOT have access to the `healthier-app` team scope** (needs interactive re-auth in the Vercel dashboard — a platform quirk on newly-created teams, not fixable via API). Check deploy status via browser instead: `https://vercel.com/healthier-app/gethealthier/deployments`. If state is ERROR, open the deployment and check build logs before reporting done.
> - Project: `gethealthier` (`prj_F9HOcYdCOixNhKC3WDhzdKt16Zgn`) — team `healthier-app`, migrated 2026-08-10 from the shared `marco-polos-projects-1eab697a` team (that team has 25+ unrelated client/personal projects and is Hobby-plan, non-commercial per Vercel ToS — not appropriate for a paying client in production).

> **🔴 PRIORIDAD MÁXIMA — pagos:** ante CUALQUIER cambio que roce Edge Functions, env vars, dominios o deploys, correr **`node scripts/verificar-pagos.mjs`** antes de cerrar la tarea. Si sale en rojo, no se cierra. **No borrar `supabase/config.toml`** — es lo único que evita que `functions deploy` rompa Mercado Pago en silencio (pasó el 2026-08-07 y estuvo 18 días roto). Runbook completo: **[`../docs/testing.md`](../docs/testing.md)**.

> **🔴 MANDATORY — después de deployar a producción, PREGUNTAR si corremos las pruebas:** Mercado Pago, alta de cuenta y receta electrónica fallan en silencio y tienen prueba propia. Tras mergear a `main`, tocar Edge Functions/secrets/dominios/migraciones, o ante un cambio grande, preguntarle a Mateo si las corremos — una línea, no un informe. `node scripts/verificar-produccion.mjs`. No correrlas por mi cuenta (la de alta crea un usuario real) ni saltearlas en silencio. **Emitir una receta contra producción no se automatiza nunca.** Runbook: **[`../docs/deploy.md`](../docs/deploy.md)** (regla de Mateo, 2026-08-29).

> **📝 MANDATORY:** After completing ANY implementation, add a `[website]`-tagged entry at the top of **`~/Local/Healthier/catchup.md`** (the single unified log). Do NOT write to `website/catchup.md` — it is a stub. Do NOT ask the user — just do it.
>
> **Source tagging & pull rule:** Every catchup entry MUST include a `**Source:**` line (e.g. `Claude Code — Macbook Pro`, `Claude App — iPhone`, `Claude.ai — web`). Before writing the entry, read the most recent entry's `**Source:**` field. If it differs from the current session's source, run `git pull origin main` first.

> **🔜 MANDATORY — Next Steps:** At the end of every session (after catchup.md), update **`~/Local/Healthier/nextsteps.md`**. Replace the Now/Next/Later lists to reflect current priorities. Move completed items out, add newly discovered work, re-rank as needed. Tag items `[website]`, `[mobile]`, or `[cross]`. Do NOT ask the user — just do it.

> **🔍 MANDATORY — Code Quality Gate:** After completing a code-changing task, review for reuse, quality, and efficiency before updating catchup.md.
> - **Small changes (1–2 files):** Do a quick inline review yourself — check for duplicated utilities, unused imports, missing cleanup. No agent needed.
> - **Large changes (3+ files):** Run `/simplify` which spawns a single Sonnet reviewer agent.
> - The flow is: **implement → review/simplify → catchup.md**
> - Do NOT skip the review. Do NOT ask the user. Just do it.

> **🎨 Figma:** When implementing UI from Figma, always use the **Figma MCP** (`mcp__plugin_figma_figma__*`) tools. Use `get_design_context` with the fileKey and nodeId from the URL. Figma file key: `NnHInsYlpesMmLU1cTnPz2`.

> **📊 MANDATORY — Super Admin visibility:** todo lo relacionado con el manejo de la plataforma (pagos, comisiones, conexiones MP, refunds/créditos, verificaciones, configuraciones, estados) tiene que verse reflejado en el panel del super admin (`/super-admin/*`) en el mismo cambio — columna, badge, página o métrica según corresponda. Regla de Mateo (2026-07-24), detalle en el CLAUDE.md raíz del monorepo.

---

## Project Overview

Healthier — Health-services marketplace MVP connecting patients with healthcare professionals in Buenos Aires.

- **Stack:** React 19 + Vite 7 + Tailwind CSS 4 + Supabase JS + React Router v7
- **Icons:** `@phosphor-icons/react` ONLY — https://phosphoricons.com. Do NOT use lucide-react or any other icon library.
- **Language:** All UI copy in Spanish (Argentine)
- **Payments:** Deferred — no Stripe
- **Scheduling:** Healthier's own availability system (`professional_schedules`, 15-min slots, anti-double-booking) — Calendly removed 2026-07-17. Future: sync booked consultations to the professional's own Google Calendar (not yet built, see nextsteps.md).

---

## Supabase

- **Project ID:** `aixjejdoofervrkggbkd`
- **Region:** sa-east-1 (São Paulo)
- **URL:** `https://aixjejdoofervrkggbkd.supabase.co`
- **Storage buckets:** `avatars` (public), `professional-docs` (private), `patient-docs` (private)
- Migrations live in `supabase/migrations/`

> **PostgREST join syntax:** Use aliased FK joins — `professional:profiles!professional_id(...)` — NOT direct `professional_profiles` joins from `consultations`. Getting this wrong causes 400 FK errors.

> **RLS invariant:** The `profiles` table uses a `SECURITY DEFINER` function `get_my_role()` to break an infinite recursion (42P17). Never write a policy on `profiles` that calls `profiles` directly.

> **Migrations:** After creating any Supabase migration file, run `npx supabase db push` immediately. Do NOT tell the user to run it — just run it.

> **🔴 Migraciones huérfanas — chequear antes de terminar cualquier tarea que toque `supabase/migrations/`:**
>
> ```bash
> bash scripts/check-migraciones-huerfanas.sh
> ```
>
> Compara cuatro cosas: archivos sin commitear, migraciones que quedaron en un
> worktree sin mergear, `supabase_migrations.schema_migrations` de producción
> contra los archivos locales, y huecos en la numeración. Sólo lee.
>
> **Por qué existe:** el 2026-08-06 se encontró que las migraciones 082 y 083 del
> worktree `fix-alta-cuenta-y-obra-social` habían llegado a producción —el trigger
> `crear_perfil_al_registrarse` y las columnas de cobertura de `profiles` estaban
> aplicados— pero el worktree nunca se mergeó, así que no había archivo en `main`
> ni registro en `schema_migrations`. Peor: el código de `main` ya dependía del
> trigger (el fix del 409 en `authService.register`). Un `db reset` o un entorno
> nuevo habría dado una base rota sin ninguna pista de por qué. Se recuperaron
> como 095 y 096.
>
> **Trabajar en un worktree es lo que lo causa:** `db push` desde el worktree
> aplica el SQL a la base compartida al instante, pero el archivo sólo existe en
> esa rama. Si la rama se abandona, la base queda adelantada al repo. Antes de
> borrar o abandonar un worktree, correr el chequeo.

---

## Roles & Routing

| Role | Dashboard route |
|------|----------------|
| `patient` | `/paciente/dashboard` |
| `professional` | `/profesional/dashboard` |
| `admin` | `/admin/profesionales` |
| `super_admin` | `/super-admin/dashboard` |

Role guards are in `src/App.jsx` via `RequireRole`. Patient routes use `PatientMobileLayout`; all other roles use `AppLayout`.

---

## Patient Mobile Layout — Key Invariants

> **CRITICAL — Root element:** All patient page root elements MUST be `<div className="absolute inset-0">`. Pages render inside `PatientMobileLayout` whose content area is `absolute inset-0` relative to `h-dvh`. A non-absolute root will overflow the viewport.

> **Bottom nav clearance:** The bottom nav sits `absolute bottom-0 z-50` with `pb-4 sm:pb-6` + `py-4` inner padding ≈ 72–80px tall. Scrollable page content needs `pb-32` so it doesn't hide behind the nav. Full-page sub-screens (add-familiar, edit-tarjeta, category detail) use `absolute inset-0` with their own sticky header.

> **Desktop floating panel:** `Dashboard.jsx` uses an `isDesktop` state (≥640px) to switch from the mobile bottom sheet to a Google Maps-style floating panel (`absolute left-4 bottom-[96px] w-[360px] rounded-[28px]` with frosted-glass style). When editing Dashboard, preserve both layout branches.

> **NO Dynamic Island offsets:** Previous code had `pt-16` / `top-14` to clear a phone-frame mockup. Those are gone. Use `pt-6 sm:pt-8` for page top padding and `top-4 sm:top-6` for overlaid headers.

> **Drag bottom sheet states:** `useBottomSheet` (`src/components/patient/useBottomSheet.js`) — `collapsed` (72% translateY) · `half` (30%) · `expanded` (0%). Only `expanded` reveals the SOS + veterinary section on mobile.

> **HIDE_NAV_PREFIXES:** The nav is hidden on `/paciente/sos`, `/paciente/ondemand`, and `/paciente/videollamada`. Add new full-screen flows here.

---

## Mobile-First Professional Screens

Some professional pages are designed exclusively for phone use and must never be constrained to a desktop layout. They are registered as **standalone routes** (outside `AppLayout`) in `App.jsx` so there is no sidebar.

| Route | File | Why phone-only |
|-------|------|----------------|
| `/profesional/emergencias` | `pages/professional/Emergencias.jsx` | Operated on the street, requires large touch targets and full-screen urgency UI |
| `/profesional/onboarding` | `pages/professional/Onboarding.jsx` | Full-bleed split-screen wizard with a live preview panel (2026-07-16) — no sidebar/nav chrome, needs the full viewport width for the two-column layout |

**Rules for mobile-first professional screens:**
- Root must be `min-h-screen` (not inside AppLayout — no sidebar).
- Minimum button height: `py-5` (≈56px touch target).
- Use `fixed inset-0 z-50` only if overlaying the app shell mid-navigation; use `min-h-screen flex flex-col` for standalone routes.
- No horizontal scrolling. Single-column layout always.
- Dark/high-contrast headers for outdoor readability.
- Navigation button must open Google Maps via `maps.google.com/?q=lat,lng&navigate=yes` — not an in-page map.
- When adding a new phone-only professional screen: register it the same way (standalone route before the AppLayout block) and add it to this table.

---

## Mock Services — Do Not Wire Yet

The following services are **UI-only mocks** with realistic `setTimeout` delays. Do not attempt to wire real backends without a dedicated task:

| Service | File | TODO |
|---------|------|------|
| AI triage | `src/services/aiService.js` | Gemini 2.5 Flash via `VITE_GEMINI_API_KEY` |
| Emergency dispatch | `src/services/emergencyService.js` | Real dispatcher + ETA feed |

---

## Design Reference — functionhealth.com

**https://www.functionhealth.com** is the primary visual reference for the Healthier brand aesthetic.

Key principles to follow:

- **Editorial serif headings:** All `h1`–`h6` use our serif stack (`GT Super Display` → `Fraunces` → Georgia). Never override with inline `fontFamily` styles — the CSS base layer handles this automatically.
- **Large, confident type:** Hero headings are bold and large (`text-4xl`→`text-6xl`). Tracking is tight (`leading-tight`). Italic weights are used sparingly for emphasis.
- **Generous whitespace:** Sections use `py-20` minimum vertical padding. Content blocks breathe — no cramped layouts.
- **Minimal color:** Warm cream/beige backgrounds, terracotta brand accent, dark `#2a2b2f` text. No gratuitous gradients.
- **Clean CTAs:** Pill-shaped buttons (`border-radius: 999px`) with clear primary/secondary hierarchy.
- **Trust signals:** Star ratings, verification badges, and professional avatars used like Function Health uses lab test logos and physician credentials.

> **Typography invariant (updated 2026-07-23):** **TWK Everett** for headings only (`h1`-`h6`, and anywhere `font-serif` is applied explicitly) — GT Super Display has been removed. **General Sans** ("GeneralSans" font-family, replaces IBM Plex Sans used 2026-07-16 to 2026-07-23) for body text/forms/UI — resolves via `--font-sans`; this is the `body` default in `@layer base`, so most non-heading elements get General Sans automatically without any class. `--font-serif` still resolves to Everett. Never mix via inline `style={{fontFamily}}` — always through the `--font-serif`/`--font-sans` tokens or explicit `font-serif`/`font-sans` Tailwind classes.

> **Weight invariant:** NEVER use Everett Bold (`font-bold` / 700). Display headlines use **Everett Light** (`font-light`); everything else uses **Regular** (`font-normal` through `font-semibold` all render the Regular file — its @font-face covers 400–600). Mateo's explicit rule (2026-07-03).

> **No inline styles — ever.** Never use `style={{ ... }}` on any element. All styling must go through Tailwind utility classes or `@utility` / `@layer` blocks in `src/index.css`. Inline styles fight the design system, bypass the theme tokens, and are impossible to audit. If a value isn't in the theme, add it as a token first.

---

## Design System

- **Brand primary:** `#7CB38B` (sage) — `var(--color-brand)` · hover: `#5f9470`
- **Brand secondary:** `#E8927C` (coral) — `var(--color-brand-secondary)`
- **Brand tertiary:** `#9B8EC4` (lavender) — `var(--color-brand-tertiary)`
- **Danger:** `#D9534F` — `var(--color-danger)` · S.O.S / destructive actions
- **bg-primary:** `#F6F5F0` (warm ivory) · **bg-secondary:** `#FDFCF9`
- All `@theme` tokens and `@utility` blocks defined in `src/index.css`
- Fonts: **TWK Everett** (headings/`font-serif`) + **General Sans** (body/`font-sans`) — licensed/open-source woff2 in `public/fonts/`. GT Super Display has been removed.

### Button & form utilities

| Purpose | Class |
|---------|-------|
| Primary button | `btn-primary` (blue) |
| Accent button | `btn-accent` (coral) |
| Secondary | `btn-secondary` |
| Danger | `btn-danger` |
| Card | `card` or `card-hover` |
| Form field | `form-input` · `form-label` · `form-select` · `form-textarea` |

### Patient-area frosted glass style

Used in bottom nav, floating panel, location header pill:
```
bg-white/90 backdrop-blur-[20px] border border-white/80 rounded-[28px]
shadow-[0_8px_30px_rgba(0,0,0,0.1)]
```

---

## Code Conventions

- **Service layer:** All DB calls go through `src/services/*.js` — never query Supabase directly from components
- **Naming:** DB columns are snake_case; JS is camelCase — use `toCamelCase` / `toSnakeCase` from `src/lib/supabase.js`
- **Toasts:** Use `toast.success/error/info/warning` from `src/components/Toast.jsx` — never `alert()`
- **Animations:** Custom keyframes live in `src/index.css` (`slideUpSpring`, `dashMove`). Never use inline `<style>` tags.
- **No TypeScript** — JSX only

---

## Dev Commands

```bash
npm run dev      # Start dev server at localhost:5173
npm run build    # Production build — run after larger changes to catch errors
npm run preview  # Preview production build
```

---

## Workflow

- **ALWAYS** update `catchup.md` after any implementation. Do not skip. Do not ask the user.
- Add a one-liner to "Recent Changes" below at the same time.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`
- **Explain changes from a frontend perspective** — describe the user-visible result, not just which files changed.

---

## Recent Changes

### 2026-08-27: La dirección del consultorio se le pide a quien atiende presencial

El onboarding **nunca** pidió la dirección y el campo vive en `/profesional/perfil` (sólo
accesible desde "Más"), así que de 27 profesionales sólo 2 la tenían. Sin dirección no hay
lat/lng y el profesional no aparece en el mapa de pacientes de mobile.

- `lib/profileCompleteness.js`: paso "Dirección del consultorio", agregado **sólo** si
  `modality_preference` es `'presencial'`/`'ambas'`. Nueva `atiendePresencial()` — único lugar
  donde se define el criterio; `null` cuenta como virtual.
- `professional/Dashboard.jsx`: aviso ámbar puntual para el **verificado** que declaró presencial
  y no tiene dirección. El checklist completo no se le muestra a un verificado a propósito
  (2026-08-21) y justamente los que tienen el problema ya están verificados, así que nunca lo
  verían. Es un único item que se va solo al completarse — no es el checklist de vuelta.

> **Al agregar un paso al checklist, preguntarse a quién le llega.** El checklist sólo lo ven los
> **no verificados**. Si el problema lo tienen los verificados, el paso no alcanza y hace falta
> una superficie propia en su dashboard.

**Abierto:** el paso de zona trata `modality_preference = null` como no-virtual (le pide zona) y
el de dirección lo trata como virtual (no le pide nada). Lo consistente sería pedirle **elegir la
modalidad** a quien nunca la definió; hoy nadie se lo pregunta.


### 2026-04-29: Professional onboarding split into 5 steps (Especialidad → Presentación → Tarifas → Documentación → Revisión)

### 2026-04-29: Bug fix pass — auth, RLS, ConsultationDetail, Profile, Dashboard, mobile bóveda
Fixed NULL auth tokens blocking demo logins; added `has_shared_consultation` SECURITY DEFINER + RLS policy so professionals see patient names; fixed wrong userId/bucket in prescription upload; added prescription validation; fixed coordinate overwrite on profile save; fixed new-professional dashboard state; implemented real document upload in mobile bóveda.

### 2026-04-23: Full MVP bridge-the-gap pass
Pro geo (Nominatim autocomplete + real lat/lng on patient map), avatar upload, modality persist + "Entrar a Sala" unblocked, cancel flow, prescription upload, rejection reason + resubmit, reviews capture, real availability slot editor, specialty DRY + vertical coverage, patient profile columns, super-admin promote via RPC.

### 2026-04-22: Monorepo restructure — website/ + mobile/ under ~/Local/Healthier/
Mobile RN project scaffolded at `../mobile/` (Expo Router TS, design-v2 theme, full auth + tab + flow screens ported from client Snack).

### 2026-04-20: Serif typography enforced on Landing — inline font overrides removed, Function Health reference added to CLAUDE.md

### 2026-04-14: App-wide design system v2 — cream/terracotta, GT Super Display / Everett, pill buttons
Full visual re-skin on branch `feat/design-v2`. Tokens, fonts, utilities, and all patient pages migrated to warm editorial palette. Brand `#2563EB` → `#b05a36`, danger → `#db0000`, bg-primary → beige, bg-secondary → cream.

### 2026-04-14: Wire patient prototype to real Supabase professionals
Dashboard markers, OnDemand "Profesional Asignado", and Consultations booking modal all now fetch real verified pros from DB. New `src/lib/verticals.js` shared mapping. 5 demo pros seeded via migration.

### 2026-04-14: Responsive patient interactions — PatientSheet + PatientPageOverlay
All sheets/modals/sub-screens in Consultations, Documents, Profile, OnDemand, Emergency, VideoCall now render as centered modals/cards on desktop and preserve the original mobile bottom-sheet/full-page UX at 390px.

### 2026-04-14: Responsive patient dashboard — Google Maps floating panel
On desktop (≥640px) the bottom sheet becomes a frosted-glass panel anchored to the bottom-left of the map. All content always visible. Mobile keeps drag-to-expand sheet unchanged.

### 2026-04-14: Phone-frame mock removed — fully responsive layout
`PatientMobileLayout` no longer wraps in an iPhone frame. Fills real viewport with `h-dvh`. Dynamic Island padding offsets replaced with responsive Tailwind values.

### 2026-04-14: Client design system integration — full patient mobile redesign
Brand → blue #2563EB. Patient pages rewritten (Dashboard, Consultations, Documents, Profile). New pages: OnDemand, Emergency, VideoCall. New components: InteractiveMap, TopDownAmbulance, useBottomSheet. Mock services: aiService, emergencyService.

### 2026-03-26: Figma screens + bug fixes + sitewide sidecart
Pushed 18 Figma screens. Fixed auth null-crash, PostgREST FK join errors, and RLS infinite recursion. Added IndexSidecart (logo click → page-navigator drawer).

### 2026-03-25: IndexSidecart — page navigator drawer
Developer tool: Healthier logo opens a full-height drawer with all platform pages (Lista) and interactive Mermaid flowchart (Flujo).

### 2026-03-19: Full MVP scaffold — Sprint 1–4
Built entire Healthier MVP from scratch: 4 roles, Supabase schema (6 tables + RLS), full routing, auth, services, and UI in Spanish.

---

## Verificación en browser (obligatorio)

Después de cualquier cambio de UI, verlo funcionando antes de reportar la tarea
como completada — en desktop **y en el Safari del simulador** si toca algo que
se use en teléfono.

📖 Cómo: **[`../docs/testing.md`](../docs/testing.md)** (magic link para entrar
sin teclear, apuntar el simulador a `localhost`, cuentas de cada entorno).

## Actualizar AMBOS timelines (obligatorio)

Después de cada tarea completada, antes de reportar al usuario, actualizar:

1. **Timeline del proyecto** — mover el item a "Completado", actualizar "Ahora (en curso)" y "Próximo".
2. **Timeline global** — `~/Local/timeline.md` — actualizar la fila del proyecto en la tabla resumen + el bloque Estado/Próximo paso del proyecto.

No preguntar. No saltear aunque la tarea sea pequeña. El timeline global es la fuente de verdad que Alan usa para saber en qué está cada proyecto y qué sigue.