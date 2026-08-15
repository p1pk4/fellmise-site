"""Local server for the scene editor: serves the site and takes the layout back.

    python tools/editor_serve.py [--port 8899]

A browser cannot write to assets/layout.json on its own, so the editor's Export
button POSTs the file here and this writes it. Without this server the button
still works — it falls back to a download — but then the file has to be moved by
hand, and moving files by hand is how a layout gets lost.

Only one route is special: POST /__layout writes the body to assets/layout.json,
after checking it parses as JSON and has the shape the scene expects. Everything
else is a plain static file out of the repository root.

Binds to localhost only. This writes to your working tree; it is not something
to expose.
"""

import argparse
import http.server
import json
import pathlib
import shutil
import socketserver
import sys
import time

# Launched from a .bat, stdout is cp1252 and the first Cyrillic line kills the
# server before it binds. Fixed here rather than only in the launcher, so the
# script works however it is started.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "assets" / "layout.json"
# The page is served out of next/, so that is the copy it actually reads. Both
# are written: assets/ is the source that gets committed, next/ is what the
# editor sees on the very next reload — otherwise saving appears to do nothing
# until a rebuild, which is the fastest way to lose an hour of placement.
SERVED = ROOT / "next" / "assets" / "layout.json"
BACKUPS = ROOT / "out" / "layout_history"
MAX_BODY = 8 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if self.command != "GET":
            sys.stderr.write(f"  {fmt % args}\n")

    def end_headers(self):
        # the editor is a working tool: never serve it a stale bundle
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0] != "/__layout":
            self.send_error(404)
            return
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BODY:
            self.send_error(413, "layout too large")
            return
        raw = self.rfile.read(n)

        try:
            data = json.loads(raw)
            assert isinstance(data.get("biomes"), dict) and data["biomes"], "нет биомов"
            count = sum(len(b.get("sprites", [])) + len(b.get("boards", []))
                        for b in data["biomes"].values())
            assert count, "в файле нет объектов"
        except Exception as exc:  # noqa: BLE001
            self.send_error(400, f"not a layout: {exc}")
            return

        # keep the version being replaced: an editor session is easy to regret
        if TARGET.exists():
            BACKUPS.mkdir(parents=True, exist_ok=True)
            shutil.copy2(TARGET, BACKUPS / f"layout-{time.strftime('%Y%m%d-%H%M%S')}.json")
        TARGET.write_bytes(raw)
        if SERVED.parent.is_dir():
            SERVED.write_bytes(raw)

        msg = f"assets/layout.json ({count} объектов)"
        print(f"  сохранено: {msg}", flush=True)
        body = msg.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    args = ap.parse_args()

    if not (ROOT / "next" / "index.html").exists():
        raise SystemExit("нет next/ — соберите сайт: cd journey3 && npm ci && npx vite build")

    url = f"http://localhost:{args.port}/next/?editor=1"
    print(f"редактор сцен: {url}")
    print(f"корень: {ROOT}")
    print(f"Export пишет в {TARGET.relative_to(ROOT)}, "
          f"предыдущая версия — в {BACKUPS.relative_to(ROOT)}\n")
    try:
        Server(("127.0.0.1", args.port), Handler).serve_forever()
    except OSError as exc:
        raise SystemExit(f"порт {args.port} занят: {exc}")
    except KeyboardInterrupt:
        print("\nостановлен")


if __name__ == "__main__":
    main()
