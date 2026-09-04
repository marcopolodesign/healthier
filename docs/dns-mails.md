# Los mails de Healthier — qué falta

Todo el circuito está armado y probado. **Lo único que falta son tres registros
de DNS en `healthier.com.ar`**, que se cargan en el panel de DonWeb (los
nameservers del dominio son `ns1/ns2.donweb.com`). No hay API: es a mano.

Apenas los tres estén cargados y Resend verifique el dominio, los mails empiezan
a salir solos — no hay que deployar nada.

## Los tres registros

| Tipo | Nombre / Host | Prioridad | Valor |
|---|---|---|---|
| `TXT` | `resend._domainkey` | — | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDSBR8JWM3xKD8Wd/oxZqgNrExzFL8afhDNwq3bSRXiAW3EI4Cj+s8bRIhT0olFllJ/F2aDEOjVbs/qf2Rr/afb5yKKshRn4QV0y9+I9W1lz5yYDT6XMYDdmNoKUP92UlH+Lc6hC2TEWFwajdFCnvBjp0oUYMcjnDLnWzMxih+ybQIDAQAB` |
| `MX` | `send` | `10` | `feedback-smtp.sa-east-1.amazonses.com` |
| `TXT` | `send` | — | `v=spf1 include:amazonses.com ~all` |

> Si el panel pide el nombre completo en vez del relativo, son
> `resend._domainkey.healthier.com.ar` y `send.healthier.com.ar`.

## Cómo verificar que quedó

```bash
dig +short TXT resend._domainkey.healthier.com.ar
dig +short MX  send.healthier.com.ar
dig +short TXT send.healthier.com.ar
```

Y después, del lado de Resend:

```bash
source ~/Local/.env
curl -s -X POST https://api.resend.com/domains/b293a77b-3bed-4478-b8c2-f3d763592997/verify \
  -H "Authorization: Bearer $RESEND_API_KEY"
curl -s https://api.resend.com/domains/b293a77b-3bed-4478-b8c2-f3d763592997 \
  -H "Authorization: Bearer $RESEND_API_KEY" | python3 -m json.tool | head -5
```

`"status": "verified"` = listo.

## Lo que ya está hecho

- Dominio `healthier.com.ar` dado de alta en Resend, región `sa-east-1` (la
  misma que Supabase). Id `b293a77b-3bed-4478-b8c2-f3d763592997`.
- Secretos cargados en los dos entornos de Supabase: `RESEND_API_KEY`,
  `EMAIL_FROM`, `APP_URL`.
  - Producción manda desde `Healthier <consultas@healthier.com.ar>`.
  - Staging manda desde `Healthier <onboarding@resend.dev>` a propósito: es el
    remitente de prueba de Resend, que **sólo entrega al dueño de la cuenta**
    (`m@marcopolo.agency`). Así se puede probar el circuito sin depender del DNS
    y sin riesgo de mandarle un mail a un paciente de prueba.
- El mail lo dispara un **trigger de la base** (migración 143), no el browser.
  Eso es lo que hace que una reserva hecha desde la **app** también mande mail —
  antes el código vivía sólo en el website.
- Probado de punta a punta contra staging: insert → trigger → `pg_net` →
  `send-booking-email` → Resend → bandeja de entrada.

## Ojo

La cuenta de Resend es la de Marco Polo (comparte con `senda-arq.com` y
`theactinggarage.com`). Cuando Healthier tenga la suya, es cambiar
`RESEND_API_KEY` en los secretos de Supabase y volver a dar de alta el dominio —
nada de código.
