# Healthier — Catchup Log

---

## 2026-04-14: Client Design System Integration — Patient Mobile Redesign

**Branch:** `feat/client-design-patient`

**Change:** Integrated the client's single-file React mockup into the existing Healthier codebase. Patient experience fully replaced with a mobile-first phone-frame UI (430×932 iPhone shell). Professional/admin/super-admin dashboards unchanged.

**Files created:**
- `src/layouts/PatientMobileLayout.jsx` — phone-frame wrapper + bottom nav; replaces AppLayout for all `/paciente/*` routes
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
- `src/index.css` — brand re-themed from teal (#0F7173) → blue (#2563EB) across all tokens; new `--color-danger` (#DC2626) for emergencies; specialist vertical color tokens added; `animate-slide-up-spring`, `animate-dash-move`, `scrollbar-hide` utilities added
- `package.json` / `package-lock.json` — added `lucide-react`

**Key implementation notes:**
- Dual icon library: `lucide-react` for patient area, `@heroicons/react` retained for pro/admin; acceptable during migration
- AI triage + S.O.S are UI-only mocks with realistic delays — wire real backends in a follow-up pass
- Familiares, tarjetas, food/workout logs live in local state only — persistence needs new Supabase tables (deferred)
- Consultations booking modal calls real `consultationsService.create()` — actual DB rows are created
- Profile saves to real `profilesService.update()` — field mapping assumes snake_case column names in `profiles` table

**Follow-up items:**
- Wire `VITE_GEMINI_API_KEY` + real `aiService.triage()` call
- `supabase/migrations/NNN_patient_extras.sql`: `food_logs`, `workout_logs`, `familiares`, `payment_methods`, `documents.category`
- Geolocation: OSM reverse-geocode rate-limit handling
- Video call: replace mock UI with actual WebRTC / Daily.co / Agora integration
- Baseline git commit on `main` already created; branch is `feat/client-design-patient`

---

## 2026-03-26: Figma Screens Push + Bug Fixes + Sitewide Sidecart

**Change:** Pushed all 18 Healthier app screens into Figma (`NnHInsYlpesMmLU1cTnPz2`), fixed critical auth/DB bugs, made IndexSidecart sitewide, and created test users.

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
- `src/App.jsx` — Lifted `sidecartOpen` state here; added floating `#` FAB button (fixed bottom-right) for sitewide access on public pages; renders `<IndexSidecart>` inside `<Router>`
- `src/layouts/AppLayout.jsx` — Removed own IndexSidecart state; receives `onOpenSidecart` prop from App.jsx
- `src/components/Header.jsx` — Added `onLogoClick` prop; mobile logo → `<button>`, visible on all screen sizes
- `src/services/authService.js` — Fixed null localStorage crash: null guard on JSON.parse + only store profile if non-null
- `src/services/consultationsService.js` — Fixed all FK join errors: uses PostgREST aliased joins `professional:profiles!professional_id(..., professional_profiles(specialty))`
- `src/pages/patient/Consultations.jsx` — Updated field access for camelCase join shape
- `src/pages/patient/Dashboard.jsx` — Updated field access for camelCase join shape
- `src/pages/professional/ConsultationDetail.jsx` — Updated field access for patient/professional
- `src/pages/admin/Consultations.jsx` — Updated field access for all joined fields

**Supabase changes:**
- Created test users: `paciente@healthier.app` / `paciente` and `profesional@healthier.app` / `profesional`
- Fixed RLS infinite recursion (`42P17`) on `profiles` table: created `SECURITY DEFINER` function `get_my_role()` to break the recursive policy

**Key gotchas:**
- Plus Jakarta Sans uses `SemiBold` (no space) in Figma; Inter uses `Semi Bold` (with space)
- Figma fill color objects don't accept `a` alpha — use `opacity` on the paint instead
- `setSharedPluginData` is not available on variable collection objects
- PostgREST FK aliases: use `professional:profiles!professional_id` not direct `professional_profiles` join from `consultations`

---

## 2026-03-25: Index Sidecart — Page Navigator Drawer

**Change:** Added a developer/design tool: clicking the Healthier logo in the sidebar opens a full-height drawer panel ("sidecart") showing all platform pages in two views.

**Files created:**
- `src/components/IndexSidecart.jsx` — Full-height fixed drawer (480px wide, z-50). Has two tabs: "Lista" (grouped page list with route badges) and "Flujo" (interactive Mermaid flowchart). Clicking any page in list view navigates + closes. Mermaid flow uses `securityLevel: 'loose'` + `window._healthierNav` for click-to-navigate on nodes.

**Files modified:**
- `src/components/Sidebar.jsx` — Added `onLogoClick` prop; wrapped logo `<div>` in `<button>` with hover styles
- `src/layouts/AppLayout.jsx` — Added `sidecartOpen` state, imported and rendered `<IndexSidecart>`, passed `onLogoClick` to `<Sidebar>`

**Package installed:**
- `mermaid` — for SVG flowchart rendering in the Flujo tab

**Key notes:**
- Mermaid must be initialized with `startOnLoad: false` and `securityLevel: 'loose'` for click callbacks
- `window._healthierNav` is set on each Flujo tab render to get current `navigate` + `onClose` refs
- Routes with `:id` params are shown non-clickable in list view
- Sidecart z-index is 50 (above sidebar at z-30 and mobile overlay at z-20)

---

## 2026-03-19: Full MVP Scaffold — Sprint 1–4

**Change:** Built the entire Healthier health-services marketplace MVP from scratch. Stack is React 19 + Vite 7 + Tailwind CSS 4 + Supabase, emulating TAG-admin patterns. Covers all 4 user roles (patient, professional, admin, super_admin) with full routing, auth, services, and UI in Spanish.

**Supabase setup:**
- Project `healthier-mvp` created in `sa-east-1` (ID: `aixjejdoofervrkggbkd`)
- Migration `001_initial_schema.sql` applied — 6 tables + RLS + indexes
- Storage buckets created: `avatars` (public), `professional-docs` (private), `patient-docs` (private)
- `.env` populated with real project URL and anon key

---

**Files created:**

**Foundation**
- `package.json` — React 19 + Vite 7 + Tailwind 4 + Supabase JS + Heroicons + Recharts
- `vite.config.js` — Vite + @tailwindcss/vite + @vitejs/plugin-react
- `index.html` — Google Fonts (Inter + Plus Jakarta Sans), lang="es"
- `.env` — Supabase URL + anon key (real values)
- `.env.example` — Template for env vars
- `.gitignore` — Standard Vite gitignore

**Design system**
- `src/index.css` — Full Tailwind 4 `@theme` (teal #0F7173 brand, coral #F97316 accent) + all `@utility` blocks: btn-primary, btn-accent, btn-secondary, btn-danger, form-input, form-label, form-select, form-textarea, card, card-hover, table-header, table-cell, table-row, nav-item-active, nav-item-inactive, status-badge, status-pending/confirmed/in-progress/completed/cancelled, animations

**Core**
- `src/main.jsx` — React 19 entry point
- `src/App.jsx` — Full router with role guards (RequireRole), auth gate, onAuthStateChange listener, loading screen

**Library**
- `src/lib/supabase.js` — Supabase client, getCurrentUser, isAuthenticated, toCamelCase, toSnakeCase

**Services**
- `src/services/authService.js` — register (creates profile row), login (with role redirect), logout, getCurrentUserProfile (with localStorage cache), verifySession, onAuthStateChange
- `src/services/profilesService.js` — getById, update, uploadAvatar
- `src/services/professionalService.js` — getByUserId, upsert, uploadDocument, search (filters: specialty/onDemand/minRating), getPublicProfile, setVerified, getPendingVerification
- `src/services/consultationsService.js` — create, getByPatient, getByProfessional, getById, updateStatus, getAll
- `src/services/reviewsService.js` — create, getByProfessional, recalculateRating
- `src/services/documentsService.js` — upload (to Supabase Storage), getByPatient, delete
- `src/services/availabilityService.js` — getByProfessional, create, delete

**Components**
- `src/components/Toast.jsx` — Pub-sub toast system (success/error/info/warning), ToastContainer, auto-dismiss at 4s
- `src/components/Modal.jsx` — Reusable overlay modal, body scroll lock, 4 sizes
- `src/components/Sidebar.jsx` — Role-aware nav (4 roles), mobile overlay, logout button
- `src/components/Header.jsx` — Top bar with user avatar, role label, user dropdown, logout
- `src/components/FileUpload.jsx` — Drag-and-drop + click upload, file preview with clear button
- `src/components/StarRating.jsx` — 1–5 star input/display, hover state, read-only mode, 3 sizes
- `src/components/StatusBadge.jsx` — Maps consultation status to Spanish label + color pill
- `src/components/CalendlyEmbed.jsx` — Loads Calendly widget script, renders inline widget, prefill name/email
- `src/components/ProfessionalCard.jsx` — Search result card: avatar, specialty, on-demand badge, rating, price, "Ver perfil" CTA

**Layouts**
- `src/layouts/AppLayout.jsx` — Sidebar + Header wrapper with mobile menu state
- `src/layouts/AuthLayout.jsx` — Centered card with Healthier logo, footer

**Pages — Auth**
- `src/pages/Landing.jsx` — Full landing: navbar, hero ("Tu salud, cuando la necesitás"), specialties grid (4), how-it-works (3 steps), pro benefits section, CTA final, footer
- `src/pages/auth/Login.jsx` — Email/password form, role-based redirect on success
- `src/pages/auth/Register.jsx` — Role picker (Paciente/Profesional), name/email/password form

**Pages — Patient**
- `src/pages/patient/Dashboard.jsx` — Quick action cards, upcoming consultations list, empty state
- `src/pages/patient/Search.jsx` — Specialty dropdown, min-rating select, on-demand toggle, results grid
- `src/pages/patient/ProfessionalProfile.jsx` — Full public profile: avatar, specialty, rating, bio, price, "Agendar" CTA, reviews list
- `src/pages/patient/Book.jsx` — Calendly embed + postMessage listener → creates consultation record on booking
- `src/pages/patient/Consultations.jsx` — Table with status filter tabs
- `src/pages/patient/Documents.jsx` — PDF upload modal, document grid with download/delete
- `src/pages/patient/Profile.jsx` — Edit name/phone/birthdate, avatar upload

**Pages — Professional**
- `src/pages/professional/Onboarding.jsx` — 4-step wizard: personal info → title PDF upload → license+DNI upload → review & submit
- `src/pages/professional/Dashboard.jsx` — Pending verification notice if not approved; stats cards + today's agenda list
- `src/pages/professional/Agenda.jsx` — On-demand toggle, Calendly URL input, live embed preview
- `src/pages/professional/ConsultationDetail.jsx` — Patient info, "Cerrar consulta" modal with notes + prescription toggle + file upload
- `src/pages/professional/Profile.jsx` — Edit specialty/sub-specialty/bio/price

**Pages — Admin**
- `src/pages/admin/Professionals.jsx` — Pending verification table, side panel with PDF viewer (iframe), approve/reject buttons with optional note
- `src/pages/admin/Users.jsx` — All users table with search, role color badges
- `src/pages/admin/Consultations.jsx` — Platform-wide consultation log with status filter

**Pages — Super Admin**
- `src/pages/super-admin/Dashboard.jsx` — 4 stat cards + Recharts BarChart (consultations last 7 days)
- `src/pages/super-admin/Admins.jsx` — Admin list, promote-user-to-admin modal
- `src/pages/super-admin/Settings.jsx` — Platform name, support email, maintenance mode toggle, allow-registrations toggle

**Database**
- `supabase/migrations/001_initial_schema.sql` — Full schema: 6 tables, updated_at triggers, RLS policies, indexes, storage bucket comments

---

**Key notes:**
- All UI copy in Spanish (Argentine market)
- No Stripe — payments deferred; no payment fields in schema
- Scheduling via Calendly inline embed; consultation record created on `calendly.event_scheduled` postMessage
- Professional onboarding requires admin approval before dashboard is shown (`is_verified` gate)
- `toCamelCase`/`toSnakeCase` helpers in supabase.js handle DB ↔ JS naming throughout all services
- localStorage caches `userProfile` to avoid redundant DB calls on navigation
- Auth state managed via `onAuthStateChange` in App.jsx
