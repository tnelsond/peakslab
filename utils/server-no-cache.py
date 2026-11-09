from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    # Keep-alive: one connection for many files (HTTP/1.0 opens one per file)
    protocol_version = 'HTTP/1.1'

    def end_headers(self):
        # Always checked, never stale: an unchanged file is a quick 304
        # (Last-Modified), not downloaded again as no-store made it
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    
    def do_GET(self):
        # Check if the requested path is a directory
        path = self.path.split('?')[0]  # /khmer/?dict=h97 is still a directory
        if path.endswith('/'):
            index_path = self.translate_path(path + 'index.html')
            if not os.path.isfile(index_path):
                # No index.html found, send 404 instead of listing
                self.send_error(404)
                return
        
        super().do_GET()
    
    def send_error(self, code, message=None):
        if code == 404:
            try:
                with open('404.html', 'rb') as f:
                    body = f.read()
            except FileNotFoundError:
                body = b"<h1>404 - Page Not Found</h1>"
            self.send_response(404)
            self.send_header('Content-type', 'text/html')
            self.send_header('Content-Length', str(len(body)))  # (keep-alive: where it ends)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
        else:
            super().send_error(code, message)

if __name__ == '__main__':
    os.chdir('.')  # Change to your webapp directory if needed
    # Threads: a big dictionary downloading doesn't hold up everything else
    server = ThreadingHTTPServer(('0.0.0.0', 8000), NoCacheHTTPRequestHandler)
    print('Server running on http://0.0.0.0:8000')
    server.serve_forever()

