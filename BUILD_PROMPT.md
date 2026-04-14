# Healthier — Agent Prompt: Build the MVP

You are an expert full-stack engineer. Your task is to build **Healthier**, a health-services marketplace MVP that connects patients with licensed healthcare professionals for on-demand and scheduled consultations. Everything in this prompt is derived from a validated research and product design phase.

---

## 1. Product Overview

Healthier is a **single responsive Web App** that centralises the full operation between three user types:

| Role | Description |
|------|-------------|
| **Patient** | Finds and books health professionals, pays, rates, and manages their health record |
| **Professional** | Registers with credential validation, manages their agenda, attends consultations |
| **Admin / Super Admin** | Validates professionals, oversees the platform, manages all data |

The MVP does **NOT** include:
- Integrated video calls (the video link is provided externally by the admin or professional)
- Official digital prescriptions (workflow is manual for now)
- Native iOS / Android apps (post-MVP, Phase 2)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 14** (App Router, TypeScript) |
| Styling | **Tailwind CSS** + **shadcn/ui** |
| Auth | **Supabase Auth** (email/password + Google OAuth) |
| Database | **Supabase** (PostgreSQL) |
| File Storage | **Supabase Storage** (PDF uploads) |
| Payments | **Stripe** (credit card — swap for Mercado Pago if LatAm only) |
| Email | **Resend** + **React Email** |
| Scheduling | **Cal.com embed** or Calendly link injection |
| Deployment | **Vercel** |

---

## 3. Database Schema (Supabase / PostgreSQL)

### `profiles`
```sql
id uuid references auth.users primary key,
role text check (role in ('patient','professional','admin','super_admin')),
full_name text,
email text,
avatar_url text,
phone text,
created_at timestamptz default now()
```

### `professional_profiles`
```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references profiles(id),
specialty text,           -- e.g. 'medicina_general', 'nutricion', 'psicologia', 'entrenamiento'
sub_specialty text,
bio text,
photo_url text,
title_doc_url text,       -- storage path to uploaded title PDF
license_number text,
license_doc_url text,
id_doc_url text,
hourly_rate numeric,
currency text default 'ARS',
rating numeric default 0,
total_reviews int default 0,
is_verified boolean default false,
is_active boolean default false,
video_link text,          -- external video call link provided per consultation
created_at timestamptz default now()
```

### `availability_slots`
```sql
id uuid primary key default gen_random_uuid(),
professional_id uuid references professional_profiles(id),
start_time timestamptz,
end_time timestamptz,
is_on_demand boolean default false,
is_booked boolean default false
```

### `consultations`
```sql
id uuid primary key default gen_random_uuid(),
patient_id uuid references profiles(id),
professional_id uuid references professional_profiles(id),
slot_id uuid references availability_slots(id),
type text check (type in ('on_demand','scheduled')),
status text check (status in ('pending','confirmed','in_progress','completed','cancelled')),
video_link text,
notes text,
requires_prescription boolean,
payment_intent_id text,
amount_paid numeric,
currency text,
created_at timestamptz default now()
```

### `reviews`
```sql
id uuid primary key default gen_random_uuid(),
consultation_id uuid references consultations(id),
patient_id uuid references profiles(id),
professional_id uuid references professional_profiles(id),
rating int check (rating between 1 and 5),
comment text,
created_at timestamptz default now()
```

### `medical_documents`
```sql
id uuid primary key default gen_random_uuid(),
patient_id uuid references profiles(id),
file_url text,
file_name text,
description text,
created_at timestamptz default now()
```

---

## 4. Application Routes

```
/                          → Landing page (public)
/auth/login               → Login (email + Google)
/auth/register            → Registration with role selector

/patient/
  dashboard               → Home, upcoming consultations, reminders
  search                  → Search & filter professionals
  professionals/[id]      → Professional public profile
  book/[id]               → Booking flow (select slot → pay)
  consultations           → History of consultations
  documents               → Upload / view medical PDFs
  profile                 → Edit personal info, health insurance

/professional/
  dashboard               → Upcoming consultations, ratings summary
  onboarding              → Step-by-step credential upload
  agenda                  → Manage availability + on-demand toggle
  consultations/[id]      → Consultation detail + close workflow
  profile                 → Edit public profile, rates, bio

/admin/
  professionals           → List + approve/reject credential submissions
  users                   → View all patients and professionals
  consultations           → Platform-wide consultation log

/super-admin/
  dashboard               → Full platform stats
  admins                  → Manage admin users
  settings                → Platform config
```

---

## 5. Core Feature Specs

### 5.1 Patient Onboarding Flow
1. Welcome screen → Register (email / Google)
2. Email verification
3. Onboarding quiz: health goals (general care, nutrition, mental health, fitness, etc.)
4. Complete profile: personal data, health insurance / obra social
5. → Patient dashboard

### 5.2 Professional Onboarding Flow
1. Welcome screen → Register with email
2. Email verification
3. Upload documentation: title/degree, license, national ID (Supabase Storage)
4. Credential validation (Admin reviews, approves or rejects)
5. If approved → complete public profile: photo, bio, specialties, rates, availability
6. Activate profile → visible to patients

### 5.3 Booking Flow
1. Patient searches by: specialty, price range, rating, availability, on-demand
2. Views professional card (photo, specialty, rating, price, next available slot)
3. Selects slot (on-demand = first available, scheduled = calendar picker)
4. Checkout with Stripe (credit card)
5. On success: consultation created, confirmation email sent (Resend), video link injected
6. Reminder email T-24h and T-1h before scheduled consultation

### 5.4 On-Demand Flow
- Patient taps "Consulta Ahora" → triggers a notification to all available professionals in that specialty
- First professional to accept gets the consultation
- Assignment algorithm: prioritises professionals with higher ratings
- Professional gets biometric prompt (Face ID / fingerprint via WebAuthn or device PIN)

### 5.5 Consultation Close Workflow (Professional)
- Professional clicks "Cerrar consulta"
- Required field: "¿Requiere receta?" → Yes / No
- If Yes: manual note field + optional PDF upload of prescription
- Status set to `completed`
- Patient is prompted to leave a review

### 5.6 Review System
- Post-consultation prompt to patient (email + in-app)
- 1–5 stars + optional comment
- Professional rating = rolling average of all reviews
- Rating used in assignment algorithm

### 5.7 Medical Documents (Patient)
- Upload PDFs from profile
- Stored in Supabase Storage under `patient_docs/{user_id}/`
- Visible to professional only during an active/confirmed consultation
- Patient can delete any document

### 5.8 Reminder / Reactivation System
- If patient has no consultation for 90 days → send reactivation email
- Cron job via Vercel cron or Supabase Edge Function scheduled trigger
- Email template: "Te extrañamos — ¿cómo estás? Agenda una consulta hoy"

### 5.9 Admin Panel
- Table of pending professional verifications with document viewer
- Approve / reject with optional note
- On approval: `is_verified = true`, `is_active = true`, welcome email to professional

### 5.10 Super Admin Panel
- Full read access to all users, professionals, consultations
- Platform-level stats: MAU, consultations/day, revenue, top professionals
- Manage admin accounts

---

## 6. User Personas (Design Reference)

### Valentina — Paciente tipo
- 28 años, profesional independiente, Buenos Aires
- Necesita consultas rápidas sin turnos largos en obras sociales
- Valora transparencia de precios, poder ver reviews y agendar desde el celular
- Pain points: esperas, falta de opciones de especialistas, costos ocultos

### Dr. Rodrigo — Médico
- 42 años, médico clínico, trabaja en clínica y quiere ingresos extra
- Quiere control total de su agenda, que no le cancelen turnos de último momento
- Pain points: plataformas que cobran comisión excesiva, pacientes que no aparecen

### Luciana — Nutricionista
- 34 años, nutricionista independiente, quiere escalar su práctica online
- Necesita gestionar agenda, cobrar online y tener historial de pacientes
- Pain points: apps genéricas que no entienden lógica de salud, falta de credibilidad digital

---

## 7. Competitors Landscape (context only — do not replicate, differentiate)

| Platform | Strengths | Weaknesses |
|----------|-----------|------------|
| Doctoralia | Massive network, SEO, reviews | Complex UX, high cost for professionals |
| MiSalud / TeleSalud | Good telemedicine | No on-demand, limited specialties |
| CalidadMedica | Strong credentials validation | No marketplace feel |
| Sanarai | Modern design | Limited to nutrition |
| Mediqo | On-demand focus | No scheduling |

**Healthier differentiators:** unified on-demand + scheduled, transparent pricing, real-time assignment algorithm, clean UX, professional-first onboarding.

---

## 8. Design System

- **Font:** Inter (body), a bold display font for headings (e.g. Sora or Plus Jakarta Sans)
- **Primary color:** deep teal `#0F7173` or health-positive green `#16A34A`
- **Accent:** warm coral `#F97316` for CTAs
- **Neutral:** zinc scale
- **Radius:** 12px cards, 8px inputs
- **Tone:** professional, warm, trustworthy — NOT clinical/sterile
- Use shadcn/ui components as base, customised to match the design system
- Mobile-first responsive layout

---

## 9. Environment Variables Needed

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
NEXT_PUBLIC_APP_URL=
```

---

## 10. Roadmap Context (what this MVP covers)

| Phase | Scope |
|-------|-------|
| **Fase 0** (done) | Research, personas, feature prioritisation, legal exploratory (SISA/MCO) |
| **Fase 1** (done) | Information architecture, flows, wireframes, design |
| **Fase 2 — Sprint 1** | Auth, profiles, admin base panel |
| **Fase 2 — Sprint 2** | Agenda, on-demand, assignment algorithm |
| **Fase 2 — Sprint 3** | Payments (Stripe), reviews, PDF upload |
| **Fase 2 — Sprint 4** | Notifications (email), security (biometric prompt), QA |
| **Fase 3** | Deploy + real user testing + post-MVP adjustments |
| **Fase 4** | Native iOS/Android apps, integrated video calls |

---

## 11. Build Instructions for Agent

1. **Bootstrap the project** with `create-next-app` (TypeScript, Tailwind, App Router, src/ directory)
2. **Install dependencies:** supabase-js, shadcn/ui, stripe, @stripe/stripe-js, resend, react-email, zod, react-hook-form, zustand (state), date-fns, lucide-react
3. **Set up Supabase:** create all tables from Section 3, enable RLS, write policies per role
4. **Implement auth:** Supabase Auth with email + Google, role-based redirect after login
5. **Build patient flows** first (highest MVP value): search → profile → book → pay → review
6. **Build professional flows:** onboarding → agenda → consultation close
7. **Build admin panel:** verification queue with document viewer
8. **Add email notifications:** booking confirmation, reminders, reactivation
9. **Payments:** Stripe Checkout or Payment Intent, webhook for confirmation
10. **Deploy to Vercel**, configure env vars, set up cron for reactivation emails

---

## 12. Open Questions to Resolve Before Building

- **Payment gateway:** Stripe (global) or Mercado Pago (LatAm) — confirm with client
- **SISA validation:** manual admin review for MVP, automated API later
- **Notifications:** email only for MVP or also web push?
- **Currency:** ARS, USD, or multi-currency?
- **Prescription workflow:** manual note for MVP — no official integration

---

Start by scaffolding the project, setting up Supabase with the schema above, and implementing auth with role-based routing. Then proceed sprint by sprint as outlined in Section 10.
