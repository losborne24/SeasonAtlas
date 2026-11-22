"""Serve a generated temperature atlas on loopback with CORS, without directory listings."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        self.response_status = code
        super().send_response(code, message)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        cache = 'public, max-age=3600' if self.path.endswith('.png') else 'no-cache'
        self.send_header('Cache-Control', 'no-store' if getattr(self, 'response_status', 200) >= 400 else cache)
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.weather-data/tiles'))
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    root = args.directory.resolve()
    if not root.is_dir():
        parser.error('Build the atlas first; see docs/local-weather.md.')
    print(f'Local weather atlas: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root))).serve_forever()
