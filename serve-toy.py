"""Serve only the generated static Toy package, under a Toy-like subpath."""
import argparse
import hashlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser

PREFIX = '/toy/crate-atlas/'


class StaticServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        # Windows SO_REUSEADDR may otherwise allow duplicate preview servers.
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class StaticHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        if route.path == '/':
            self.send_response(302)
            self.send_header('Location', PREFIX+'index.html')
            self.end_headers()
            return
        if not route.path.startswith(PREFIX):
            self.send_error(404, 'This server only serves the static Toy package')
            return
        self.path = self.path[len(PREFIX)-1:]
        super().do_GET()

    def do_HEAD(self):
        route = urlsplit(self.path)
        if not route.path.startswith(PREFIX):
            self.send_error(404)
            return
        self.path = self.path[len(PREFIX)-1:]
        super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    output = Path(__file__).resolve().parent/'output'
    default_root = next((output/name for name in ['toy-official-3d','toy-official-regions','toy-official-vegetation','toy-official-tiles','toy-official-50mb','toy-official-all','toy-official','toy-web']
                         if (output/name/'build-manifest.json').is_file()), output/'toy-web')
    parser.add_argument('--root', type=Path, default=default_root)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root/'build-manifest.json').is_file():
        parser.error('Build the Toy package first with build-toy.py --output output/toy-web')
    url = f'http://127.0.0.1:{args.port}{PREFIX}index.html'
    try:
        server = StaticServer(('127.0.0.1', args.port), partial(StaticHandler, directory=str(root)))
    except OSError as error:
        # Reopening the launcher should open the existing matching static build,
        # without an analysis API or another process fighting for the same port.
        try:
            with urlopen(f'http://127.0.0.1:{args.port}{PREFIX}build-manifest.json', timeout=2) as response:
                matches = hashlib.sha256(response.read()).digest() == hashlib.sha256((root/'build-manifest.json').read_bytes()).digest()
        except (OSError, ValueError):
            matches = False
        if not matches:
            raise RuntimeError(f'Port {args.port} is in use by another service. Use --port {args.port+1}.') from error
        print('Static Toy preview already running: '+url, flush=True)
        if args.open:
            webbrowser.open(url)
        return
    print('Static Toy edition / Ctrl+C to stop: '+url, flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
