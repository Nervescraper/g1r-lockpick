#!/usr/bin/env python3
"""Static dev server with caching disabled, so edits to JS/CSS always load fresh.

Usage:
    python3 scripts/serve.py [port]   # default port 8000

Run from the project root. Open http://localhost:<port>.
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving {ROOT}")
    print(f"  http://localhost:{port}  (caching disabled — reloads always load fresh)")
    print("  Ctrl+C to stop")
    HTTPServer(("localhost", port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
