# Los mails de Healthier — qué falta

Todo el circuito está armado, probado y con registro propio. El DNS de
`healthier.com.ar` **ya está cargado** (2026-09-07) — falta sólo que Resend
termine de verificar el dominio, que depende de la propagación.

## El DNS de `healthier.com.ar` vive en Vercel (desde el 2026-09-07)

Los nameservers del dominio son **`ns1/ns2.vercel-dns.com`**. DonWeb sigue
siendo el registrador (el dominio está en NIC.ar desde el 2026-03-06, vence el
2027-03-06), pero **ya no maneja el DNS**: los registros se cargan en

> https://vercel.com/healthier-app/~/domains/healthier.com.ar

🔴 **Cargarlos en DonWeb no sirve para nada.** Sus nameservers dejaron de estar
delegados y de hecho nunca llegaron a servir la zona: mientras el dominio les
apuntaba, contestaban `REFUSED` y `healthier.com.ar` estaba entero a oscuras —
sin `A`, sin `MX`, sin nada. Ese es también el motivo por el que el sitio nunca
había tenido dominio propio conectado: era el mismo agujero, no dos tareas.

El equipo de Vercel es **`healthier-app`** (el de producción). El token de la
API que hay en `~/Local/.env` es del equipo de Marco Polo y **no llega ahí**:
para tocar este DNS por API hace falta un token con alcance `healthier-app`; si
no, es por el dashboard.

### Ojo con la propagación

Cambiar los nameservers en NIC.ar no es instantáneo: la delegación vieja viaja
con **TTL de 7200 s (2 h)**, así que durante ese rato hay resolvers que siguen
preguntándole a DonWeb —que contesta `REFUSED`— y devuelven `SERVFAIL`. Se ve
como si los registros estuvieran mal cuando en realidad están perfectos. Para
distinguir una cosa de la otra, preguntarle al nameserver autoritativo, que no
tiene caché:

```bash
dig @ns1.vercel-dns.com resend._domainkey.healthier.com.ar TXT +short
dig @ns1.vercel-dns.com send.healthier.com.ar MX +short
```

Y para ver si ya propagó, comparar varios resolvers — no alcanza con uno:

```bash
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do dig @$r healthier.com.ar NS +short; done
```

> ⚠️ **Estos registros son de la cuenta de Resend propia de Healthier**
> (`healthier@marcopolo.agency`, alta el 2026-09-04). Reemplazan a los de la
> cuenta compartida de Marco Polo: la clave DKIM es distinta, así que si quedó
> una copia vieja dando vueltas, **no sirve**.

## La zona entera (cargada el 2026-09-07 en el DNS de Vercel)

Estos son **todos** los registros que `healthier.com.ar` necesita hoy: los tres
del correo (obligatorios), el DMARC (recomendado) y los dos del sitio.

### Correo — obligatorios · ✅ cargados

| Tipo | Nombre | Prioridad | Valor |
|---|---|---|---|
| `TXT` | `resend._domainkey` | — | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCv5FeGImJUhGNSQSyszbn9DRk9aLwXMZnKvipYjB7vNbJ8T0rFlUQn35nv/8qR120Xdc8DZfIZWAIwVK+ktza2pJXj8t9dSO1Uo8mFQlo5+vLuM+RzNlzD5mfMPhrri0i+ZnJ1hlswzrREGQYDOaDctuzfJOuFqUnVtiMld3RMGQIDAQAB` |
| `MX` | `send` | `10` | `feedback-smtp.sa-east-1.amazonses.com` |
| `TXT` | `send` | — | `v=spf1 include:amazonses.com ~all` |

### Correo — recomendado · ✅ cargado

| Tipo | Nombre | Valor |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:healthier@marcopolo.agency` |

DMARC no hace falta para que Resend verifique, pero con SPF y DKIM ya puestos
mejora bastante la entrega en Gmail y Outlook. `p=none` es el modo que sólo
observa: no puede rebotar nada. Más adelante se sube a `quarantine`.

### El sitio · ✅ cargados (los puso Vercel al conectar el dominio)

| Tipo | Nombre | Valor |
|---|---|---|
| `A` | `@` (la raíz) | `216.198.79.1` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

`216.198.79.1` es la IP anycast que Vercel usa hoy para dominios raíz —
verificada contra dos dominios nuestros ya apuntados. 🔴 **Antes de cargar
estos dos, agregá `healthier.com.ar` al proyecto `gethealthier` en el dashboard
de Vercel**: ahí te muestra el `CNAME` exacto de este proyecto (algo como
`xxxxxxxx.vercel-dns-017.com`) y ése es el que conviene usar en vez del
genérico. El token de la API no tiene alcance sobre el equipo `healthier-app`,
así que ese paso no lo puedo hacer yo.

### Lo que NO va

**Ningún `MX` en la raíz.** El `MX` de arriba es de `send.healthier.com.ar` y
sirve para que Amazon SES procese los rebotes, no para recibir correo. Para
recibir en `@healthier.com.ar` hace falta contratar casillas (Google Workspace,
Zoho, las de DonWeb) y ese proveedor da su propio `MX` para la raíz.

## Cómo verificar que quedó

Contra el nameserver autoritativo, que no tiene caché — es la única lectura que
dice la verdad mientras la delegación vieja sigue viva:

```bash
dig @ns1.vercel-dns.com resend._domainkey.healthier.com.ar TXT +short
dig @ns1.vercel-dns.com send.healthier.com.ar MX  +short
dig @ns1.vercel-dns.com send.healthier.com.ar TXT +short
dig @ns1.vercel-dns.com _dmarc.healthier.com.ar  TXT +short
```

Y que lo publicado sea **idéntico** a lo que espera Resend (el DKIM tiene que
volver como **una sola** cadena de 218 caracteres; si vuelve partido en dos, el
panel lo cortó y no valida):

```bash
source ~/Local/.env
ESPERADO=$(curl -s https://api.resend.com/domains/c0b735de-b446-400e-b8a9-f2c2f991349c \
  -H "Authorization: Bearer $HEALTHIER_RESEND_API_KEY" \
  | python3 -c "import sys,json;print([r for r in json.load(sys.stdin)['records'] if r['type']=='TXT' and 'domainkey' in r['name']][0]['value'])")
PUBLICADO=$(dig @8.8.8.8 resend._domainkey.healthier.com.ar TXT +short | tr -d '\"\n')
[ "$ESPERADO" = "$PUBLICADO" ] && echo "✅ idénticos" || echo "❌ distintos"
```

Y después, del lado de Resend:

```bash
source ~/Local/.env
curl -s -X POST https://api.resend.com/domains/c0b735de-b446-400e-b8a9-f2c2f991349c/verify \
  -H "Authorization: Bearer $HEALTHIER_RESEND_API_KEY"
curl -s https://api.resend.com/domains/c0b735de-b446-400e-b8a9-f2c2f991349c \
  -H "Authorization: Bearer $HEALTHIER_RESEND_API_KEY" | python3 -m json.tool | head -5
```

`"status": "verified"` = listo.

## Qué se prende cuando el dominio verifica

1. **Los mails transaccionales empiezan a llegarle a los pacientes.** Hoy salen
   igual, pero Resend los rechaza con 403 porque el remitente
   `consultas@healthier.com.ar` todavía no está verificado. El rechazo se ve, con
   ese texto exacto, en **`/super-admin/mails`**.
2. **Los mails de cuenta pasan a salir por Resend**, con el diseño de Healthier
   en vez del mailer de Supabase:

   ```bash
   cd website
   RESEND_API_KEY_PARA_SMTP=$HEALTHIER_RESEND_API_KEY \
     npx tsx scripts/aplicar-mails-de-auth.ts produccion --smtp
   ```

   🔴 **Recién después de que verifique.** Con el dominio sin verificar, prender
   el SMTP es peor que no hacer nada: hoy los mails de contraseña salen feos
   pero salen, y con Resend rechazando el remitente no saldría ninguno.

## Probado en staging el 2026-09-05

Staging quedó con el **SMTP de Resend prendido**, así que ahí los mails de
cuenta ya salen por Resend y no por el mailer de Supabase. Se probó de punta a
punta con un alta real:

| Qué | Resultado |
|---|---|
| Alta de cuenta → trigger → `send-email` → Resend | ✅ aceptado, con id de Resend, visible en `/super-admin/mails` |
| "Recuperar contraseña" → Supabase Auth → SMTP de Resend | ✅ aceptado por Resend, con la plantilla de Healthier |
| Entrega en la casilla | ❌ **rebotado**: `550 5.7.3 Mensaje calificado como spam` |

El rebote es un artefacto de staging, no del código: como el dominio no está
verificado, staging manda desde `onboarding@resend.dev`, que además **sólo
entrega al dueño de la cuenta** (`healthier@marcopolo.agency`). Ese remitente es
un dominio ajeno sin SPF ni DKIM alineados, y el servidor de `marcopolo.agency`
lo rechaza por spam. Con `healthier.com.ar` verificado, el mail sale firmado
desde el dominio propio y ese rechazo desaparece.

Cuenta de prueba creada en staging para esto: `healthier@marcopolo.agency`
(password `pruebamails2026`, rol paciente).

## Lo que ya está hecho

- **Cuenta propia de Resend** para Healthier (`healthier@marcopolo.agency`), en
  reemplazo de la compartida de Marco Polo. Dominio `healthier.com.ar` dado de
  alta en la región `sa-east-1` (la misma que Supabase), id
  `c0b735de-b446-400e-b8a9-f2c2f991349c`.
- Dos claves, una por entorno, en `~/Local/.env`:
  `HEALTHIER_RESEND_API_KEY` (producción) y `HEALTHIER_RESEND_API_KEY_STAGING`.
  Separadas para poder revocar una sin tocar la otra.
- Secretos cargados en los dos entornos de Supabase: `RESEND_API_KEY`,
  `EMAIL_FROM`, `APP_URL`.
  - Producción manda desde `Healthier <consultas@healthier.com.ar>`.
  - Staging manda desde `Healthier <onboarding@resend.dev>` a propósito: es el
    remitente de prueba de Resend, que **sólo entrega al dueño de la cuenta**
    (`healthier@marcopolo.agency`). Así se puede probar el circuito sin depender
    del DNS y sin riesgo de mandarle un mail a un paciente de prueba.
  - **Staging tiene además el SMTP de Resend prendido** desde el 2026-09-05, así
    que también los mails de cuenta salen por ahí. Producción no: ver abajo.
- **27 plantillas** con el diseño de las landings, en
  [`supabase/functions/_shared/email/`](../supabase/functions/_shared/email/).
  Se miran con `npm run emails` o publicadas en `/docs/emails/`.
- Los mails los dispara la **base**, no el browser (migración 146): una reserva
  hecha desde la app manda mail igual que una hecha desde el website.
- **`/super-admin/mails`** — cada envío deja una fila en `email_log` con el id de
  Resend o el motivo del rechazo (migración 147).

## Ojo

Cuando Healthier tenga su propia facturación de Resend, es cambiar las claves en
`~/Local/.env` y en los secretos de Supabase, y volver a dar de alta el dominio.
Nada de código.
