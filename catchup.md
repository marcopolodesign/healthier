# Catchup — Implementation Log

Reverse-chronological record of completed implementations. Updated after every successful feature/fix.

---

## 2026-04-14: Responsive patient dashboard — Google Maps floating panel

On desktop (≥640px), the `Dashboard.jsx` bottom sheet is replaced by a frosted-glass floating panel anchored to the bottom-left of the map — same pattern as Google Maps. The panel is `absolute left-4 bottom-[96px] w-[360px] rounded-[28px]` with a frosted-glass style, scrollable body, and all content (vitals, AI triage, specialty grid, SOS, veterinary) always visible. Mobile keeps the original drag-to-expand bottom sheet exactly as-is. An `isDesktop` state (with resize listener) drives the switch.

**Files modified:**
- `src/pages/patient/Dashboard.jsx` — extracted shared content into reusable JSX blocks (`vitalsRow`, `aiTriageBar`, `specialtyGrid`, `sosAndVet`); added `isDesktop` state; rendered two separate layout branches inside `!isDesktop && ...` / `isDesktop && ...` guards

**Source:** Claude Code — Macbook Pro

---

## 2026-04-14: Phone-frame mock removed — fully responsive layout

`PatientMobileLayout` no longer wraps the patient UI in an iPhone phone-frame (430×932 box, Dynamic Island element, black border). The layout now fills the real browser viewport with `h-dvh`. All Dynamic Island padding offsets (`pt-16`, `top-14`) across the four patient pages were replaced with responsive Tailwind values (`pt-6 sm:pt-8`, `top-4 sm:top-6`). Bottom nav is centered with `max-w-lg mx-auto` so it doesn't span 100% on wide screens.

**Files modified:**
- `src/layouts/PatientMobileLayout.jsx` — removed phone-frame chrome; root is now `h-dvh bg-[#F8FAFC] relative overflow-hidden`
- `src/pages/patient/Dashboard.jsx` — location header `top-14` → `top-4 sm:top-6`; map-pro close button `top-14` → `top-4`
- `src/pages/patient/Consultations.jsx` — root `pt-16` → `pt-6 sm:pt-8`
- `src/pages/patient/Documents.jsx` — main view `pt-16` → `pt-6 sm:pt-8`; category detail header `pt-14` → `pt-6 sm:pt-8`
- `src/pages/patient/Profile.jsx` — main view + sub-screens `pt-16`/`pt-14` → `pt-6 sm:pt-8`

**Source:** Claude Code — Macbook Pro

---

## 2026-04-14: Client Design System Integration — Patient Mobile Redesign

Integrated the client's single-file React mockup into the existing Healthier codebase. Patient experience fully replaced with a mobile-first UI. Professional/admin/super-admin dashboards unchanged.

**Files created:**
- `src/layouts/PatientMobileLayout.jsx` — bottom nav; replaces AppLayout for all `/paciente/*` routes
- `src/components/patient/InteractiveMap.jsx` — drag-to-pan map with professional markers, ambulance radar, route animation
- `src/components/patient/TopDownAmbulance.jsx` — flat SVG top-down ambulance vector
- `src/components/patient/useBottomSheet.js` — drag-to-expand bottom sheet hook
- `src/pages/patient/OnDemand.jsx` — on-demand vertical service selection + payment + match flow
- `src/pages/patient/Emergency.jsx` — S.O.S payment → ambulance radar → matched unit with live ETA
- `src/pages/patient/VideoCall.jsx` — full-screen videocall UI with timer, self-view PiP
- `src/services/aiService.js` — mock AI triage (keyword-based; TODO: wire Gemini API)
- `src/services/emergencyService.js` — mock emergency dispatch (TODO: wire real dispatcher)

**Files rewritten:**
- `src/pages/patient/Dashboard.jsx` — map home + bottom sheet + vitals widgets + AI triage bar + specialty grid + SOS shortcut
- `src/pages/patient/Consultations.jsx` — 5-step agenda booking modal (modality → specialty → professional → datetime → payment); list wired to `consultationsService`
- `src/pages/patient/Documents.jsx` — bóveda by category + nutrition AI (Calai IA) + rehab AI (Kine AI) + upload flow
- `src/pages/patient/Profile.jsx` — editable basic/clinical info, emergency contact, familiares, tarjetas, comprobantes; persists to `profilesService`

**Files modified:**
- `src/App.jsx` — patient routes now use `PatientMobileLayout`; new routes `/paciente/ondemand/:vertical`, `/paciente/sos`, `/paciente/videollamada/:id`
- `src/index.css` — brand re-themed from teal (#0F7173) → blue (#2563EB); new `--color-danger` (#DC2626); specialist vertical color tokens; `animate-slide-up-spring`, `animate-dash-move`, `scrollbar-hide` added
- `package.json` / `package-lock.json` — added `lucide-react`

**Key implementation notes:**
- Dual icon library: `lucide-react` for patient area, `@heroicons/react` retained for pro/admin
- AI triage + S.O.S are UI-only mocks with realistic delays — wire real backends in a follow-up pass
- Familiares, tarjetas, food/workout logs live in local state only — persistence needs new Supabase tables (deferred)
- Consultations booking modal calls real `consultationsService.create()` — actual DB rows are created
- Profile saves to real `profilesService.update()` — field mapping assumes snake_case column names in `profiles` table

**Follow-up items:**
- Wire `VITE_GEMINI_API_KEY` + real `aiService.triage()` call
- `supabase/migrations/NNN_patient_extras.sql`: `food_logs`, `workout_logs`, `familiares`, `payment_methods`, `documents.category`
- Geolocation: OSM reverse-geocode rate-limit handling
- Video call: replace mock UI with actual WebRTC / Daily.co / Agora integration

**Source:** Claude Code — Macbook Pro

---

## 2026-03-26: Figma Screens Push + Bug Fixes + Sitewide Sidecart

Pushed all 18 Healthier app screens into Figma (`NnHInsYlpesMmLU1cTnPz2`), fixed critical auth/DB bugs, made IndexSidecart sitewide, and created test users.

**Figma — Design system foundations created:**
- Variable collections: `Color` (23 semantic variables, Light mode), `Spacing` (14 spacing/radius tokens)
- Text styles: Display/Hero, Display/Title, Heading/H1–H3, Body/Large–Small, Label/Large–Small, Caption, Overline
- Effect styles: Shadow/Subtle, Shadow/Card, Shadow/Brand, Shadow/Modal
- Pages structure: Cover, Foundations, ---, Components, ---, Screens/Público, Screens/Paciente, Screens/Profesional, Screens/Admin, Screens/Super Admin

**Figma — Screens built (18 total):**
- Screens/Público (3): Landing, Login, Registro
- Screens/Paciente (7): Dashboard, Buscar Profesionales, Perfil Profesional, Agendar Consulta, Mis Consultas, Mis Documentos, Mi Perfil
- Screens/Profesional (5): Onboarding, Dashboard, Mi Agenda, Detalle Consulta, Mi Perfil
- Screens/Admin (3): Verificación de Profesionales, Usuarios, Consultas
- Screens/Super Admin (3): Dashboard, Admins, Configuración (dark navy sidebar)

**Files modified (code):**
- `src/App.jsx` — Lifted `sidecartOpen` state here; added floating `#` FAB button (fixed bottom-right); renders `<IndexSidecart>` inside `<Router>`
- `src/layouts/AppLayout.jsx` — Removed own IndexSidecart state; receives `onOpenSidecart` prop from App.jsx
- `src/components/Header.jsx` — Added `onLogoClick` prop; mobile logo → `<button>`, visible on all screen sizes
- `src/services/authService.js` — Fixed null localStorage crash: null guard on JSON.parse + only store profile if non-null
- `src/services/consultationsService.js` — Fixed all FK join errors: uses PostgREST aliased joins `professional:profiles!professional_id(...)`
- `src/pages/patient/Consultations.jsx` — Updated field access for camelCase join shape
- `src/pages/patient/Dashboard.jsx` — Updated field access for camelCase join shape
- `src/pages/professional/ConsultationDetail.jsx` — Updated field access for patient/professional
- `src/pages/admin/Consultations.jsx` — Updated field access for all joined fields

**Supabase changes:**
- Created test users: `paciente@healthier.app` / `paciente` and `profesional@healthier.app` / `profesional`
- Fixed RLS infinite recursion (`42P17`) on `profiles` table: created `SECURITY DEFINER` function `get_my_role()`

**Key gotchas:**
- Plus Jakarta Sans uses `SemiBold` (no space) in Figma; Inter uses `Semi Bold` (with space)
- Figma fill color objects don't accept `a` alpha — use `opacity` on the paint instead
- `setSharedPluginData` is not available on variable collection objects
- PostgREST FK aliases: use `professional:profiles!professional_id` not direct `professional_profiles` join from `consultations`

**Source:** Claude Code — Macbook Pro

---

## 2026-03-25: Index Sidecart — Page Navigator Drawer

Added a developer/design tool: clicking the Healthier logo in the sidebar opens a full-height drawer panel ("sidecart") showing all platform pages in two views.

**Files created:**
- `src/components/IndexSidecart.jsx` — Full-height fixed drawer (480px wide, z-50). Has two tabs: "Lista" (grouped page list with route badges) and "Flujo" (interactive Mermaid flowchart). Clicking any page in list view navigates + closes. Mermaid flow uses `securityLevel: 'loose'` + `window._healthierNav` for click-to-navigate on nodes.

**Files modified:**
- `src/components/Sidebar.jsx` — Added `onLogoClick` prop; wrapped logo `<div>` in `<button>` with hover styles
- `src/layouts/AppLayout.jsx` — Added `sidecartOpen` state, imported and rendered `<IndexSidecart>`, passed `onLogoClick` to `<Sidebar>`

**Package installed:** `mermaid` — for SVG flowchart rendering in the Flujo tab

**Key notes:**
- Mermaid must be initialized with `startOnLoad: false` and `securityLevel: 'loose'` for click callbacks
- `window._healthierNav` is set on each Flujo tab render to get current `navigate` + `onClose` refs
- Routes with `:id` params are shown non-clickable in list view
- Sidecart z-index is 50 (above sidebar at z-30 and mobile overlay at z-20)

**Source:** Claude Code — Macbook Pro

---

## 2026-03-19: Full MVP Scaffold — Sprint 1–4

Built the entire Healthier health-services marketplace MVP from scratch. Stack is React 19 + Vite 7 + Tailwind CSS 4 + Supabase, emulating TAG-admin patterns. Covers all 4 user roles (patient, professional, admin, super_admin) with full routing, auth, services, and UI in Spanish.

**Supabase setup:**
- Project `healthier-mvp` created in `sa-east-1` (ID: `aixjejdoofervrkggbkd`)
- Migration `001_initial_schema.sql` applied — 6 tables + RLS + indexes
- Storage buckets created: `avatars` (public), `professional-docs` (private), `patient-docs` (private)
- `.env` populated with real project URL and anon key

**Files created:**

*Foundation:* `package.json`, `vite.config.js`, `index.html`, `.env`, `.env.example`, `.gitignore`

*Design system:* `src/index.css` — Full Tailwind 4 `@theme` + all `@utility` blocks (btn-primary, btn-accent, btn-secondary, btn-danger, form-input, form-label, form-select, form-textarea, card, card-hover, table-header, table-cell, table-row, nav-item-active/inactive, status-badge variants, animations)

*Core:* `src/main.jsx`, `src/App.jsx` (router + role guards + auth gate + onAuthStateChange)

*Library:* `src/lib/supabase.js` — Supabase client, getCurrentUser, isAuthenticated, toCamelCase, toSnakeCase

*Services:* authService, profilesService, professionalService, consultationsService, reviewsService, documentsService, availabilityService

*Components:* Toast, Modal, Sidebar, Header, FileUpload, StarRating, StatusBadge, CalendlyEmbed, ProfessionalCard

*Layouts:* AppLayout (sidebar + header), AuthLayout (centered card)

*Pages — Auth:* Landing, Login, Register

*Pages — Patient:* Dashboard, Search, ProfessionalProfile, Book, Consultations, Documents, Profile

*Pages — Professional:* Onboarding, Dashboard, Agenda, ConsultationDetail, Profile

*Pages — Admin:* Professionals, Users, Consultations

*Pages — Super Admin:* Dashboard, Admins, Settings

*Database:* `supabase/migrations/001_initial_schema.sql` — 6 tables, updated_at triggers, RLS policies, indexes

**Key notes:**
- All UI copy in Spanish (Argentine market)
- No Stripe — payments deferred; no payment fields in schema
- Scheduling via Calendly inline embed; consultation record created on `calendly.event_scheduled` postMessage
- Professional onboarding requires admin approval (`is_verified` gate)
- `toCamelCase`/`toSnakeCase` helpers handle DB ↔ JS naming throughout
- localStorage caches `userProfile` to avoid redundant DB calls on navigation
- Auth state managed via `onAuthStateChange` in App.jsx

**Source:** Claude Code — Macbook Pro
