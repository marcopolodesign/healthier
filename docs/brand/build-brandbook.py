#!/usr/bin/env python3
"""Genera docs/brand/healthier-brandbook.html|pdf.

Embebe las fuentes licenciadas como data-URI para que el HTML y el PDF sean
autocontenidos (el PDF necesita los woff2 disponibles al imprimir; si se
referencian por ruta, Chrome headless los omite y cae a una fuente del sistema).
"""
import base64
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE.parent.parent / "public" / "fonts"

SLOTS = {
    "__EVERETT_LIGHT__": "Everett-Light.woff2",
    "__EVERETT_REGULAR__": "Everett-Regular.woff2",
    "__GS_REGULAR__": "GeneralSans-Regular.woff2",
    "__GS_MEDIUM__": "GeneralSans-Medium.woff2",
}

html = (HERE / "brandbook.template.html").read_text(encoding="utf-8")
for slot, filename in SLOTS.items():
    b64 = base64.b64encode((FONTS / filename).read_bytes()).decode("ascii")
    html = html.replace(slot, b64)

out_html = HERE / "healthier-brandbook.html"
out_html.write_text(html, encoding="utf-8")

out_pdf = HERE / "healthier-brandbook.pdf"
subprocess.run(
    [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=4000",
        f"--print-to-pdf={out_pdf}",
        out_html.as_uri(),
    ],
    check=True,
)
print(f"{out_html}\n{out_pdf}")
