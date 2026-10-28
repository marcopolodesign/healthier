# Segundo factor (TOTP) para el super admin

Lo pide el manual de seguridad del convenio con el RENAPER. **Decisión de Mateo (2026-10-28): que exista y
funcione, pero que no se muestre.** Hoy no se le exige a nadie y no hay link en el menú.

## Qué hay

- **Supabase Auth MFA nativo** (TOTP; app de códigos tipo Google Authenticator / 1Password). TOTP ya está
  habilitado en staging (`mfa_totp_enroll_enabled` / `mfa_totp_verify_enabled` = true); no hizo falta tocar la config.
- **Alta y baja:** `/super-admin/seguridad` (`pages/super-admin/Seguridad.jsx`). Sin link en `Sidebar.jsx` a propósito.
  Muestra QR + secreto, pide el primer código y permite dar de baja el factor (Supabase exige sesión aal2 para eso).
- **Login:** `components/auth/MfaGuard.jsx` envuelve las rutas de `App.jsx`. Si el super admin tiene un factor
  verificado y su sesión es aal1, muestra la pantalla de 6 dígitos (aal1 → aal2) en vez del panel. También vale al
  recargar la pestaña o entrar por Google. Para cualquier otro rol no hace ninguna llamada.
- **Lógica pura:** `lib/mfa.js` (`decidirPasoMfa`). Servicio: `services/mfaService.js`.

## El flag: exigirlo a todos

`VITE_MFA_SUPERADMIN_OBLIGATORIO=true` (variable de entorno de Vite, **apagada por defecto**; se lee al compilar,
así que en Vercel hay que redeployar). Con el flag prendido, un super admin sin factor no puede abrir nada del
panel: lo manda a `/super-admin/seguridad` hasta que active el suyo.

## Qué NO está hecho (siguiente paso)

Es una puerta del lado del cliente. Un super admin con la sesión aal1 (sólo contraseña) sigue pudiendo llamar a la
API directamente. Para cerrarlo del lado de la base hace falta: policies `RESTRICTIVE` (o un check dentro de
`get_my_role()`/de las policies de super admin) que exijan `(auth.jwt() ->> 'aal') = 'aal2'` cuando
`profiles.role = 'super_admin'`, y un interruptor en la base (tabla de settings) para prenderlo junto con el flag.
No se hizo porque toca las policies de muchas tablas y las Edge Functions de super admin: es una migración grande
que merece su propia revisión. Mientras tanto, la política declarada es "obligatorio en la pantalla de acceso".

## Control automático

`npm run test:mfa` (`scripts/test-mfa-superadmin.mjs`): falla si un super admin con factor deja de caer en la
verificación, si el flag arranca prendido, si otros roles reciben un paso de MFA, si el guard sale de `App.jsx` o
si `/super-admin/seguridad` aparece linkeada en el menú.

## Si alguien pierde el celular

No hay códigos de recuperación (Supabase TOTP no los genera). Un administrador con acceso a la base da de baja el
factor: Dashboard → Authentication → Users → el usuario → Remove MFA factor (o `DELETE /auth/v1/admin/users/<id>/factors/<factorId>`).
