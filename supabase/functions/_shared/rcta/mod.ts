// ── Módulo compartido del servicio de recetas (Innovamed QBI2) ────────────────
// Los armados que comparten la receta (`rcta-issue`), la anulación
// (`rcta-anular`), el catálogo (`rcta-catalog`) y las Otras Prescripciones
// (certificados). Fuente: website/docs/innovamed-wiki-2026-11-02/.
// Control: `deno test supabase/functions/_shared/rcta/` y
// `npm run test:rcta-armado`.
// ─────────────────────────────────────────────────────────────────────────────
export * from './provincias.ts'
export * from './domicilio.ts'
export * from './personas.ts'
export * from './medico.ts'
export * from './http.ts'
export * from './firma.ts'
export * from './respuesta.ts'
