# La guía de uso (`/guia`) — cómo se regeneran las capturas

La guía (`src/guia/`) muestra capturas de la plataforma de verdad con números encima.
Las capturas y la posición de cada número salen de acá: si una pantalla cambia, se
regeneran en minutos y la guía queda al día. **Todo corre contra STAGING**, con cuentas
demo y datos sembrados: nunca contra producción ni con datos de pacientes reales.

| Archivo | Qué hace |
|---|---|
| `src/guia/contenido.js` | El texto de las cinco guías y qué dice cada número. |
| `src/guia/marcas.json` | Dónde va cada número (lo escriben los scripts, no se edita a mano). |
| `public/guia-img/*.jpg` | Las capturas. |
| `scripts/guia/tomas.mjs` | Qué captura web sacar, con qué cuenta y qué marcar. |
| `scripts/guia/capturas.mjs` | Saca las capturas web (Playwright contra staging). |
| `scripts/guia/capturas-app.mjs` | Saca las de la app (simulador de iOS, idb). |
| `scripts/guia/sembrar.mjs` | Deja staging con datos para que cada pantalla se vea llena. |
| `scripts/guia/mirar.mjs` | Recorre la guía publicada como la ve alguien sin sesión. |
| `scripts/prueba-guia.mjs` | El control: falla si falta una guía, una captura o una marca. |

## 1 · Datos

```bash
node scripts/seed-staging.mjs && node scripts/seed-despacho.mjs
node scripts/guia/sembrar.mjs            # idempotente; --limpiar sólo borra
```

`sembrar.mjs` aborta si la URL no es la de `healthier-staging`. Todo lo que crea lleva un
UUID con prefijo `a1d0` y sólo borra por ese prefijo; inserta con los triggers apagados,
así que no manda mails ni pushes. A las cuentas demo existentes sólo les toca campos
puntuales (dirección y Mercado Pago de `clinica@`, documentos de `pendiente@`, el estado
del Móvil 1). Contraseña de todas las cuentas de staging: `staging`.

## 2 · Capturas web

```bash
node scripts/guia/capturas.mjs                  # todas (unos 5 minutos)
node scripts/guia/capturas.mjs pro-agenda       # sólo esa
GUIA_APP=http://localhost:5173 node scripts/guia/capturas.mjs   # contra local
```

La sesión de cada cuenta se abre con un magic link del Admin API (no se tipea ninguna
contraseña). Si una marca "no aparece", cambió el texto o la clase de la pantalla: se
ajusta el selector en `tomas.mjs`. De lo que coincide se marca lo más chico que se vea.

## 3 · Capturas de la app

Hace falta la app del repo `mobile/` corriendo en un simulador propio contra staging:

1. Un worktree de `mobile/` con su `node_modules` (`npm ci`) y un `.env` con
   `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` de staging y
   `EXPO_PUBLIC_WEBSITE_URL=https://gethealthier-staging.vercel.app`.
2. `npx expo start --port 8086` en ese worktree (no tocar el Metro de otra sesión).
3. Un simulador nuevo (`xcrun simctl create "Healthier Guia" "iPhone 17 Pro"`), el dev
   client instalado, y abrir `healthier://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8086`.
4. Entrar con la cuenta (`paciente.completo@` o `clinica@staging.healthier.app`).
5. `GUIA_SIM=<udid> node scripts/guia/capturas-app.mjs paciente` (o `profesional`).

`scripts/guia/simulador.mjs ver|tocar|escribir|foto` sirve para ir probando a mano.
Ojo: en el simulador, tipear con el foco fuera de un campo dispara atajos del modo
desarrollo (la "i" abre el inspector).

## 4 · Controles

```bash
npm run test:guia                         # sin red: guías, capturas y marcas
node scripts/guia/mirar.mjs --super       # en el browser, contra staging
```
