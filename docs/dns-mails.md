# Los mails de Healthier — qué falta

Todo el circuito está armado, probado y con registro propio. **Lo único que
falta son tres registros de DNS en `healthier.com.ar`**, que se cargan en el
panel de DonWeb (los nameservers del dominio son `ns1/ns2.donweb.com`). No hay
API: es a mano.

Apenas los tres estén cargados y Resend verifique el dominio, los mails empiezan
a salir solos — no hay que deployar nada.

> ⚠️ **Estos registros son de la cuenta de Resend propia de Healthier**
> (`healthier@marcopolo.agency`, alta el 2026-09-04). Reemplazan a los de la
> cuenta compartida de Marco Polo: la clave DKIM es distinta, así que si quedó
> una copia vieja dando vueltas, **no sirve**.

## Los tres registros

| Tipo | Nombre / Host | Prioridad | Valor |
|---|---|---|---|
| `TXT` | `resend._domainkey` | — | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCv5FeGImJUhGNSQSyszbn9DRk9aLwXMZnKvipYjB7vNbJ8T0rFlUQn35nv/8qR120Xdc8DZfIZWAIwVK+ktza2pJXj8t9dSO1Uo8mFQlo5+vLuM+RzNlzD5mfMPhrri0i+ZnJ1hlswzrREGQYDOaDctuzfJOuFqUnVtiMld3RMGQIDAQAB` |
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
