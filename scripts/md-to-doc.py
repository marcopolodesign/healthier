#!/usr/bin/env python3
"""
Convierte un .md de docs/ a un HTML publicable en public/docs/.

Existe porque los documentos que se le entregan a Mateo son los HTML de
gethealthier.vercel.app/docs/, no los .md del repo — los .md son la fuente que
lee Claude, el HTML es lo que se lee y se comparte. Mantener los dos a mano
garantiza que se desincronicen.

Uso:
    python3 scripts/md-to-doc.py docs/mi-doc.md public/docs/mi-doc.html "Subtítulo"

Deliberadamente simple: cubre el markdown que usamos (encabezados, tablas,
listas, código, citas, negritas, links) y nada más. Si un documento necesita algo
más rico, se escribe el HTML a mano.
"""
import sys, re, html
from pathlib import Path

CSS = """
:root{--sage:#7CB38B;--coral:#E8927C;--ivory:#F6F5F0;--bg2:#FDFCF9;--text:#2D2A26;
--muted:#6B6760;--border:#E2DFD8;--shadow:0 1px 3px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.05)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--ivory);color:var(--text);line-height:1.65}
header{background:#fff;border-bottom:1px solid var(--border);padding:20px 32px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10}
.logo{width:36px;height:36px;background:var(--sage);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;flex-shrink:0}
header h1{font-size:18px;font-weight:600}
header p{font-size:13px;color:var(--muted);margin-top:1px}
header a.back{margin-left:auto;font-size:13px;color:var(--muted);text-decoration:none;white-space:nowrap}
header a.back:hover{color:var(--sage)}
main{max-width:860px;margin:0 auto;padding:40px 24px 100px}
h1{font-size:30px;font-weight:650;letter-spacing:-.5px;margin:0 0 8px}
h2{font-size:21px;font-weight:600;margin:40px 0 12px;padding-top:20px;border-top:1px solid var(--border)}
h2:first-of-type{border-top:none;padding-top:0}
h3{font-size:16px;font-weight:650;margin:26px 0 8px}
p{margin:12px 0;color:#3d3a35}
ul,ol{margin:12px 0 12px 22px}
li{margin:6px 0;color:#3d3a35}
a{color:var(--sage);text-decoration:underline;text-underline-offset:2px}
code{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:1px 5px;font-size:.88em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px;overflow-x:auto;margin:16px 0;box-shadow:var(--shadow)}
pre code{background:none;border:none;padding:0;font-size:13px;line-height:1.6}
blockquote{border-left:3px solid var(--sage);background:var(--bg2);padding:12px 18px;margin:18px 0;border-radius:0 10px 10px 0}
blockquote p{margin:6px 0}
table{width:100%;border-collapse:collapse;margin:18px 0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:var(--shadow);font-size:14px}
th{background:var(--bg2);text-align:left;padding:11px 14px;font-weight:600;border-bottom:1px solid var(--border)}
td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:top}
tr:last-child td{border-bottom:none}
hr{border:none;border-top:1px solid var(--border);margin:36px 0}
strong{font-weight:650;color:var(--text)}
.meta{color:var(--muted);font-size:13px;margin-bottom:28px}
@media(max-width:640px){main{padding:24px 16px 60px}h1{font-size:24px}header{padding:16px 20px}}
"""

def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)   # no-greedy: tolera ** pegados
    t = t.replace('****', '')                                  # bold vacío residual
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2" target="_blank" rel="noreferrer">\1</a>', t)
    t = re.sub(r'(?<![">=])\b(https?://[^\s<)]+)', r'<a href="\1" target="_blank" rel="noreferrer">\1</a>', t)
    return t

def convert(md):
    out, i, lines = [], 0, md.split('\n')
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(html.escape(lines[i])); i += 1
            out.append('<pre><code>' + '\n'.join(block) + '</code></pre>'); i += 1; continue
        if ln.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:\-|]+\|$', lines[i+1]):
            head = [c.strip() for c in ln.strip('|').split('|')]
            i += 2; rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip('|').split('|')]); i += 1
            th = ''.join(f'<th>{inline(c)}</th>' for c in head)
            tb = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in rows)
            out.append(f'<table><thead><tr>{th}</tr></thead><tbody>{tb}</tbody></table>'); continue
        if re.match(r'^#{1,4} ', ln):
            lvl = len(ln.split(' ')[0]); out.append(f'<h{lvl}>{inline(ln[lvl+1:])}</h{lvl}>'); i += 1; continue
        if ln.startswith('> '):
            q = []
            while i < len(lines) and lines[i].startswith('>'):
                q.append(lines[i].lstrip('>').strip()); i += 1
            out.append('<blockquote>' + ''.join(f'<p>{inline(x)}</p>' for x in q if x) + '</blockquote>'); continue
        if re.match(r'^\s*[-*] ', ln) or re.match(r'^\s*\d+\. ', ln):
            ordered = bool(re.match(r'^\s*\d+\. ', ln)); items = []
            while i < len(lines) and (re.match(r'^\s*[-*] ', lines[i]) or re.match(r'^\s*\d+\. ', lines[i]) or (lines[i].startswith('  ') and lines[i].strip() and items)):
                s = lines[i]
                if re.match(r'^\s*[-*] ', s) or re.match(r'^\s*\d+\. ', s):
                    items.append(re.sub(r'^\s*(?:[-*]|\d+\.)\s+', '', s))
                else:
                    items[-1] += ' ' + s.strip()
                i += 1
            tag = 'ol' if ordered else 'ul'
            out.append(f'<{tag}>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + f'</{tag}>'); continue
        if ln.strip() == '---':
            out.append('<hr>'); i += 1; continue
        if ln.strip():
            para = []
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#{1,4} |\||```|> |\s*[-*] |\s*\d+\. |---)', lines[i]):
                para.append(lines[i]); i += 1
            out.append(f'<p>{inline(" ".join(para))}</p>'); continue
        i += 1
    return '\n'.join(out)

def main():
    src, dst, subtitle = Path(sys.argv[1]), Path(sys.argv[2]), (sys.argv[3] if len(sys.argv) > 3 else '')
    md = src.read_text()
    title = md.split('\n')[0].lstrip('# ').strip()
    body = convert('\n'.join(md.split('\n')[1:]))
    dst.write_text(f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} — Healthier</title>
<style>{CSS}</style></head>
<body>
<header>
  <div class="logo">🌿</div>
  <div><h1>{html.escape(title)}</h1><p>{html.escape(subtitle)}</p></div>
  <a class="back" href="/docs/">← Todos los docs</a>
</header>
<main>{body}</main>
</body></html>""")
    print(f"  {src} → {dst}")

if __name__ == '__main__':
    main()
