#!/usr/bin/env python3
"""Re-creates apps/desktop/public/themes/classic from a Deskland Preview checkout.

Usage: python3 tools/vendor_classic_themes.py /path/to/Deskland/prototype

Keeps the original theme code as-is except for two documented changes:
1. The inline <script> moves into its own .js file (Tauri's CSP only allows 'self' scripts).
2. Hosted ("wallpaper") mode talks to the parent page via postMessage instead of WebView2.
"""

import re
import shutil
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
DST = Path(__file__).resolve().parent.parent / "apps/desktop/public/themes/classic"

OLD_TRANSPORT = """  const host = window.chrome && window.chrome.webview;
  if (!host) return;
  host.addEventListener('message', ev => handle(JSON.parse(ev.data)));
  host.postMessage('ready');"""
NEW_TRANSPORT = """  // DeskWall: wallpaper.html hosts this page in an iframe and relays host events (same origin).
  addEventListener('message', ev => {
    if (ev.source === parent && ev.origin === location.origin) handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data);
  });
  parent.postMessage(JSON.stringify({ t: 'ready' }), location.origin);"""

(DST / "assets").mkdir(parents=True, exist_ok=True)
(DST / "thumbs").mkdir(parents=True, exist_ok=True)
for f in ["beach-palms.js", "meadow-boy.js", "meadow-cat.js", "share.js"]:
    shutil.copy(SRC / f, DST / f)
for f in (SRC / "assets").glob("*.png"):
    shutil.copy(f, DST / "assets" / f.name)
for f in ["beach.webp", "meadow.webp"]:
    shutil.copy(SRC / "thumbs" / f, DST / "thumbs" / f)

for src, name in [("flat.html", "beach"), ("meadow.html", "meadow")]:
    html = (SRC / src).read_text(encoding="utf-8")
    m = re.search(r"<script>\n(.*?)</script>", html, re.S)
    js = m.group(1)
    assert OLD_TRANSPORT in js, f"{src}: hosted-mode transport not found"
    js = js.replace(OLD_TRANSPORT, NEW_TRANSPORT)
    js = js.replace("parent.postMessage(JSON.stringify({ t: 'ready' }), '*');",
                    "parent.postMessage(JSON.stringify({ t: 'ready' }), location.origin);")
    header = (f"// Ported from Deskland Preview (https://github.com/BLEZZ0102/Deskland, prototype/{src}), GPL-3.0.\n"
              "// DeskWall changes: moved out of the HTML for CSP; hosted mode talks to the parent page via postMessage.\n")
    (DST / f"{name}.js").write_text(header + js, encoding="utf-8")
    html = html[: m.start()] + f'<script src="{name}.js"></script>' + html[m.end():]
    html = re.sub(r"<title>.*?</title>", f"<title>DeskWall · {name.capitalize()}</title>", html)
    html = html.replace("<b>Deskland</b>", "<b>DeskWall</b>")
    html = html.replace('<html lang="zh-CN">',
                        f'<html lang="zh-CN">\n<!-- Ported from Deskland Preview (prototype/{src}), GPL-3.0. See NOTICE. -->', 1)
    (DST / f"{name}.html").write_text(html, encoding="utf-8")
    print(f"{name}: ok")
