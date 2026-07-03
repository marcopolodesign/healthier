# Healthier — Guía de estilo de imágenes (referencia: forhers.com)

Análisis de las fotos de forhers.com / hims & hers (screens Refero: /about category grid,
dr-quote card, oral weight loss) traducido a la paleta Healthier. **Toda generación de
imágenes de marketing debe usar el bloque de estilo de abajo.**

## Qué hace forhers (observado)

1. **Fondo de estudio = color de la card.** Las personas se fotografían contra un backdrop
   pastel sólido (mint, lavanda, powder blue, beige) que coincide con el tinte de la card.
   El sujeto "flota" sobre la card — no hay borde foto/card.
2. **Grade mate, bajo contraste, levemente desaturado.** Nada de HDR ni saturación punchy.
3. **Luz difusa de softbox grande.** Sombras suaves, sin brillos duros.
4. **Poses candid, a mitad de gesto.** Riendo, mirando fuera de cámara, mano en el pelo —
   nunca pose corporativa rígida.
5. **Crop desde el borde.** Pecho para arriba, sujeto descentrado, cortado por el borde
   del frame.
6. **Vestuario: lisos mate.** Knits y algodón en tonos sólidos, sin estampas ni logos.
7. **Personas reales y diversas.** Textura de piel natural, edades variadas.
8. **Lifestyle shots (hero/full-bleed):** interiores luminosos crema, plantas, luz de
   ventana natural — solo para secciones full-bleed, no para category cards.

## Paleta Healthier para backdrops

| Uso | Backdrop | Hex guía |
|-----|----------|----------|
| Medicina General | sage suave | #DCE9E0 |
| Psicología | lavanda suave | #E5E1F0 |
| Nutrición | ámbar/beige cálido | #F3E8D3 |
| Pediatría | celeste polvo | #DCE9F2 |
| Urgencias | coral/durazno suave | #F6E0D8 |
| Entrenamiento | menta/verde suave | #D8EBDD |
| Retratos genéricos | crema ivory | #F6F5F0 |

## Bloque de estilo (append a todo prompt)

> Photographed in the style of a hims & hers brand campaign: soft diffused studio
> lighting from a large softbox, matte low-contrast color grade, slightly desaturated,
> natural skin texture, candid relaxed mid-gesture expression (never a stiff corporate
> pose), solid muted wardrobe with no patterns or logos, subject cropped chest-up and
> slightly off-center bleeding off one edge of the frame, seamless solid pastel studio
> backdrop in [COLOR], editorial healthcare campaign photography, no text, no watermark.

Para lifestyle (hero full-bleed) reemplazar backdrop por: "bright airy home interior,
warm cream walls, green plants, natural window light".

## Script

`scripts/gen-landing-image.py` — usa `GEMINI_API_KEY` de `~/Local/.env`, modelo
`gemini-2.5-flash-image`. Uso:

```bash
set -a; source ~/Local/.env; set +a
python3 scripts/gen-landing-image.py public/images/landing/out.jpg "prompt"
```

## Quality gate (rúbrica Awwwards)

Antes de deployar, evaluar la página con: Design 40% · Usability 30% · Creativity 20% ·
Content 10%. Umbral mínimo: 8.5 (Developer Award). Si una imagen rompe la consistencia
(grade distinto, backdrop que no funde con la card, pose rígida) → regenerar.
