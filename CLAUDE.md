# Healthier — Claude Instructions

## Project overview

Health-services marketplace MVP connecting patients with healthcare professionals in Buenos Aires.

- **Stack:** React 19 + Vite 7 + Tailwind CSS 4 + Supabase JS + React Router v7 + Heroicons + Recharts
- **Language:** All UI copy in Spanish (Argentine)
- **Payments:** Deferred — no Stripe
- **Scheduling:** Calendly inline embed

## Supabase

- **Project ID:** `aixjejdoofervrkggbkd`
- **Region:** sa-east-1 (São Paulo)
- **URL:** `https://aixjejdoofervrkggbkd.supabase.co`
- **Storage buckets:** `avatars` (public), `professional-docs` (private), `patient-docs` (private)
- Migrations live in `supabase/migrations/`

## Roles & routing

| Role | Dashboard route |
|------|----------------|
| `patient` | `/paciente/dashboard` |
| `professional` | `/profesional/dashboard` |
| `admin` | `/admin/profesionales` |
| `super_admin` | `/super-admin/dashboard` |

Role guards are in `src/App.jsx` via `RequireRole`.

## Code conventions (emulate TAG-admin)

- **Service layer:** All DB calls go through `src/services/*.js` — never query Supabase directly from components
- **Naming:** DB columns are snake_case; JS is camelCase — use `toCamelCase` / `toSnakeCase` from `src/lib/supabase.js`
- **Toasts:** Use `toast.success/error/info/warning` from `src/components/Toast.jsx` — never `alert()`
- **Forms:** Use `form-input`, `form-label`, `form-select`, `form-textarea` utility classes from `index.css`
- **Buttons:** `btn-primary` (teal), `btn-accent` (coral), `btn-secondary`, `btn-danger`
- **Cards:** `card` or `card-hover` utility classes
- **No TypeScript** — JSX only

## Design system

- Brand: `#0F7173` (teal) — `var(--color-brand)`
- Accent: `#F97316` (coral) — `var(--color-accent)`
- All `@theme` tokens and `@utility` blocks defined in `src/index.css`
- Fonts: Inter (body), Plus Jakarta Sans (headings)

## Dev commands

```bash
npm run dev      # Start dev server at localhost:5173
npm run build    # Production build
npm run preview  # Preview production build
```

---

## catchup.md — MANDATORY RULE

**After every session where code is written or files are modified, always update `catchup.md`.**

Specifically:
- Add a new entry at the **top** of the log (after the `# Healthier — Catchup Log` header)
- Use today's date in `YYYY-MM-DD` format
- Follow the established format (see existing entries in `catchup.md`)
- List every file created or modified with a brief description
- Include key implementation notes, gotchas, and follow-up items
- **Never remove or modify existing entries**

This applies to all agents, subagents, and Claude Code sessions working on this project.
