#!/usr/bin/env python3
"""Local dev server for this site.

Plain `python3 -m http.server` is not enough here: Chromium holds a stale
style.css across same-URL navigations even with no-store, so edits silently
fail to appear and you end up debugging a change that already worked. This
rewrites HTML on the fly to stamp local stylesheet hrefs with the file's
mtime — the URL changes whenever the file does, which no cache layer can
defeat. The committed HTML on disk stays clean.

    python3 tools/devserve.py            # serves this repo on :8765
    python3 tools/devserve.py 9000 .     # or pick a port and root
"""
import functools, http.server, io, os, re, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2
                       else os.path.join(os.path.dirname(__file__), '..'))


class Dev(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if not path.endswith('.html') or not os.path.exists(path):
            return super().send_head()

        html = open(path, encoding='utf-8').read()

        def stamp(m):
            href = m.group(1)
            target = os.path.join(ROOT, href.lstrip('/'))
            if not os.path.exists(target):
                return m.group(0)
            return f'href="{href}?t={int(os.path.getmtime(target))}"'

        body = re.sub(r'href="([^":?]+\.css)"', stamp, html).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.end_headers()
        return io.BytesIO(body)

    def end_headers(self):
        if not self.path.endswith('.html'):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'serving {ROOT} on http://localhost:{PORT}/  (ctrl-c to stop)')
    http.server.ThreadingHTTPServer(
        ('127.0.0.1', PORT), functools.partial(Dev, directory=ROOT)
    ).serve_forever()
