// Logo institucional de Healthier, en base64, para mandar en `subemisor.logoBase64`
// al emitir una receta (POST /apirecipe/Receta). Generado a partir del SVG de
// src/components/common/CompanyLogo.jsx -- mismo trazo.
//
// PNG 600x129, paleta de 8 bits, sin metadata -- 10620 bytes en base64.
//
// ── Por que a color, y por que ESTE verde ────────────────────────────────────
// Hasta el 2026-09-11 iba en 1-bit blanco y negro "para que se lea impreso". Se
// probo contra el endpoint de preview de Innovamed (POST /apirecipe/Receta/
// Preview, que devuelve el PDF sin emitir nada) que el renderer respeta el color
// del PNG: el logo sale a color arriba al centro. El verde no es el `#7CB38B` de
// la marca sino `#4A6B53` -- el de marca es un sage claro que sobre papel blanco
// queda lavado y en una fotocopia de farmacia casi desaparece. Es el mismo tono,
// oscurecido hasta que aguanta el blanco y negro.
//
// El PDF lo dibuja a ~130pt de ancho, asi que 600px es el minimo para que quede
// nitido a 300dpi. Subirlo mas solo engorda el request.
//
// ── Que NO se puede brandear ────────────────────────────────────────────────
// La plantilla del PDF es de Innovamed y el unico lever de marca que existe es
// esta imagen. No hay campo de color de cabecera, de tipografia ni de estilo.
// `leyenda`, `informacionAdicional`, `horario`, `diasAtencion`, `datosContacto`
// y `nombreConsultorio` se aceptan en el request y NO se imprimen (probado uno
// por uno contra el preview, 2026-09-11). `medico.logoInstitucion` y
// `lugarAtencion.logo` tambien ponen el logo, pero arriba a la IZQUIERDA y
// pisando el codigo de barras -- por eso se usa `subemisor.logoBase64`.
//
// Por que va hardcodeado en vez de leerse de un archivo o de una URL: la emision
// de una receta no puede depender de que un fetch/Deno.readFile a este logo
// funcione. Un string en el bundle de la funcion nunca falla en tiempo de
// ejecucion -- la unica falla posible es en tiempo de build, y esa la vemos antes
// del deploy.
export const RCTA_LOGO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAACBCAMAAAArFjQgAAAAulBMVEWTp5hKa1NzjXrw8vD7/PvP2NFPb1hcemTj6OWJno9H' +
  'aVChsqbT29VTclzt8O3g5eHK1M2fsKPr7+y2w7mEm4pog29qhXJwine+ysFuiXWltqrd49+tvLGYq52Al4bDzsawv7Sdr6JY' +
  'd2GNoZLG0cn3+fizwbd4kX9hfmmqua7X3tm5xr32+PaWqZze5OB3kH7v8vB8lIPY39plgW1FZ068yL9XdmDFz8iKn5CBmIdG' +
  'aE/n6+hgfWeot6zqj2WgAAAeHUlEQVR42u2dC1fqOtOAW6oUCoVaKgJFkYsKImo3W8/2+H7//299XFo6k0wureXiPs46a52t' +
  'tmmaPkkmk8mMYZiaUrLOxHJe1izFrpydolQdUYVr+Qqsu6IC3XpRlW40m41jN5xQjGLA8nRL+W5gORf5ChSDVS4GLL8VXNp2' +
  'O2idKFv6YF1JwfruI5aovnnBOheDdV5EhTttc9MXHLPdOXbjkbIGyxHOA2n7Ok5XOhW6yiI2rXCyYBU9Ym0ahCy0ELBqoL3d' +
  '3rFbjxIj7PSvb9pyLuxucNH3ZMVYg9th0B2ZMkTt0rjWmtwd+41Jqd/3jIcpBVZOHcsa9K/XDcJLETrWDBfZP3bzEWJsm+Gx' +
  'XxLx4AbzpqVVlhW2blxJKU/HflmF+N6CYysvWNsGeZ4HXIO4Xx+xWAVuVNh6oDgxdo2wmrUpCR4zlee90KWc4KtTUrlmvtmX' +
  'wNo0yFXxI1bA0h8cu914MdJ/Vh6IgWaWtcDXMVFK79QHq1TmmKwvg3XmR0WD9YsbBUfhsZuNEwDWWeWSQyIzV6uhLyqilONJ' +
  'v2Cwzip4Kvi68n7Pd93WsVuNEwjW2ZybwfKo2o+syhp9n/FqJU8PBYN11ikYrAW/RBoeu9U4QWBZjJqVU89kJkPXy1XK0QR1' +
  'r7zmBihWt1iwxjxYxlfLLFxwja5xdUv5hpoBLqWtt6Y8GXkeFQzW2bVTKFjEiHV97EbjBIPFIJFzgG2iudCpHvsdMwoatwsB' +
  'C42BXzc3zDiuzNtjNxonGKwQrzfm+cpkZtSTNAzLJAIjQhE6FrY7fR0sfh+yuI3twgSD1VgWUt3IKQDP48m4aLAqdqFgWZwx' +
  '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'
