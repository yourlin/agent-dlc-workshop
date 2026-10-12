#!/usr/bin/env python3
"""Serve dist/ the way GitHub Pages does, for local testing.

- The site lives under BASE (default /agent-dlc-workshop/), like a project Pages site.
- Directories serve their index.html; a directory path without a trailing slash is redirected.
- Unknown paths get dist/404.html with status 404 (the SPA fallback).
- --spa-only ignores the per-route index.html files so only the 404 fallback is exercised.

Usage: python3 scripts/serve_dist.py [--port 4173] [--base /agent-dlc-workshop/] [--spa-only]
"""
import argparse
import http.server
import os
import posixpath
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")


def make_handler(base: str, spa_only: bool):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        def _fallback(self):
            body = open(os.path.join(ROOT, "404.html"), "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if not path.startswith(base):
                if path + "/" == base:
                    self.send_response(301)
                    self.send_header("Location", base)
                    self.end_headers()
                    return
                return self._fallback()
            rel = urllib.parse.unquote(path[len(base):])
            fs = os.path.normpath(os.path.join(ROOT, rel))
            if not fs.startswith(os.path.normpath(ROOT)):
                return self._fallback()
            if os.path.isdir(fs):
                is_root = rel.strip("/") == ""
                if spa_only and not is_root:
                    return self._fallback()
                if not os.path.exists(os.path.join(fs, "index.html")):
                    return self._fallback()
            elif not os.path.isfile(fs):
                return self._fallback()
            # Hand off to SimpleHTTPRequestHandler with the base stripped.
            self.path = "/" + rel + ("?" + urllib.parse.urlsplit(self.path).query if "?" in self.path else "")
            return super().do_GET()

        def send_head(self):
            # Keep redirects (dir without slash) relative to the public base path.
            path = self.translate_path(self.path)
            if os.path.isdir(path) and not urllib.parse.urlsplit(self.path).path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", base + urllib.parse.urlsplit(self.path).path.lstrip("/") + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            return super().send_head()

        def log_message(self, fmt, *args):
            if os.environ.get("QUIET"):
                return
            super().log_message(fmt, *args)

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4173)
    ap.add_argument("--base", default=os.environ.get("BASE_PATH", "/agent-dlc-workshop/"))
    ap.add_argument("--spa-only", action="store_true")
    args = ap.parse_args()
    base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(base, args.spa_only))
    print(f"Serving {os.path.normpath(ROOT)} at http://127.0.0.1:{args.port}{base}" + (" (SPA fallback only)" if args.spa_only else ""))
    srv.serve_forever()


if __name__ == "__main__":
    main()
