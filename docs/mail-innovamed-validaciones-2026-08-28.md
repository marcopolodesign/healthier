# Mail para soporte de integraciones de Innovamed — 2026-08-28

Preguntas abiertas después de activar las credenciales de producción. Todo lo que
está acá quedó sin respuesta en el swagger de homologación y en la documentación
pública. Fundamento y evidencia: `rcta-que-valida-innovamed.md`.

**Para:** soporte de integraciones de Innovamed (`soporte.it@innovamed.com.ar`)
**Asunto:** Consultas de validación — integración QBI2 (clienteAppId 343)

---

Hola, estamos por habilitar la emisión en producción con profesionales reales y
necesitamos confirmar seis puntos antes de hacerlo.

**1. Domicilio de atención.** Sabemos que sin dirección la API responde
`QBI248 — DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN`. ¿Qué campo se
evalúa exactamente: `medico.lugarAtencion` (string), `direccionConsultorio`, o el
objeto `lugarAtencion.domicilio`? ¿Se valida sólo la presencia o también el
contenido? En homologación emitimos recetas con `domicilio.localidad` y
`domicilio.provincia` cargados con valores que no son localidades ni provincias
reales, y se aceptaron y se imprimieron en el PDF. ¿Ese comportamiento es igual en
producción?

**2. Catálogo de geografía.** ¿Existe algún endpoint de provincias/localidades contra
el cual debamos normalizar el domicilio? No lo encontramos en el swagger de
homologación.

**3. Alta del profesional (la más importante para nosotros).** En la integración
institucional por API, ¿el profesional tiene que estar dado de alta previamente del
lado de ustedes —por API, por el backoffice o por un trámite administrativo— o
alcanza con enviar el objeto `medico` completo en cada receta? Lo preguntamos porque
el swagger describe ese objeto como *"Si no se envía el id médico es obligatorio
completar este objeto"*, pero no encontramos ningún campo `idMedico` ni endpoint para
registrarlo o consultarlo. ¿Existe ese concepto y en qué casos se usa?

**4. Validación de matrícula.** ¿La API valida `medico.matricula` contra REFEPS/SISA
o algún padrón provincial, o confía en lo que enviamos? En homologación emitimos con
matrícula `123123` sin ningún error. Si existe validación en producción, ¿qué código
devuelve una matrícula inexistente o inactiva? Nos importa para decidir si la
verificación contra REFEPS la hacemos íntegramente de nuestro lado.

**5. Tabla de códigos QBI.** ¿Nos pueden pasar el listado completo con su
significado? Hoy trabajamos con los que fuimos descubriendo por prueba y error
(`QBI25`, `QBI29`, `QBI34`, `QBI60`, `QBI95`, `QBI105`, `QBI156`, `QBI206`, `QBI212`,
`QBI224`, `QBI248`) y preferiríamos validar antes de llamarlos en vez de reaccionar
al rechazo.

**6. Diferencias entre ambientes.** ¿Producción aplica las mismas validaciones que
homologación, o es más estricta? `apirecipe.qbitos.com` no publica swagger, así que
no tenemos forma de comparar los contratos.

Gracias.

---

**Sin mandar todavía** — esperando que Mateo decida si lo manda él o lo mandamos
desde acá.
