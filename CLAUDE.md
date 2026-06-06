# Claude Code Project Guide

This document provides context for Claude Code when working on this React/Supabase project.

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

---

## Project Overview

Healthier — Health-services marketplace MVP connecting patients with healthcare professionals in Buenos Aires.

- **Stack:** React 19 + Vite 7 + Tailwind CSS 4 + Supabase JS + React Router v7
- **Icons:** `@phosphor-icons/react` ONLY — https://phosphoricons.com. Do NOT use lucide-react or any other icon library.
- **Language:** All UI copy in Spanish (Argentine)
- **Payments:** Deferred — no Stripe
- **Scheduling:** Calendly inline embed (professional agenda)

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

> **Typography invariant:** Headings must always resolve to the serif stack. Never add `style={{ fontFamily: '...' }}` to heading elements — it fights the design system.

---

## Design System

- **Brand primary:** `#7CB38B` (sage) — `var(--color-brand)` · hover: `#5f9470`
- **Brand secondary:** `#E8927C` (coral) — `var(--color-brand-secondary)`
- **Brand tertiary:** `#9B8EC4` (lavender) — `var(--color-brand-tertiary)`
- **Danger:** `#D9534F` — `var(--color-danger)` · S.O.S / destructive actions
- **bg-primary:** `#F6F5F0` (warm ivory) · **bg-secondary:** `#FDFCF9`
- All `@theme` tokens and `@utility` blocks defined in `src/index.css`
- Fonts: GT Super Display (headings serif) · TWK Everett (body sans) — licensed TTF/woff2 in `public/fonts/`

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
