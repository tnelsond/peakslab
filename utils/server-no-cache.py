from http.server import SimpleHTTPRequestHandler, HTTPServer
import os

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def do_GET(self):
        # Check if the requested path is a directory
        if self.path.endswith('/'):
            index_path = self.translate_path(self.path + 'index.html')
            if not os.path.isfile(index_path):
                # No index.html found, send 404 instead of listing
                self.send_error(404)
                return
        
        super().do_GET()
    
    def send_error(self, code, message=None):
        if code == 404:
            self.send_response(404)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            try:
                with open('404.html', 'rb') as f:
                    self.wfile.write(f.read())
            except FileNotFoundError:
                self.wfile.write(b"<h1>404 - Page Not Found</h1>")
        else:
            super().send_error(code, message)

if __name__ == '__main__':
    os.chdir('.')  # Change to your webapp directory if needed
    server = HTTPServer(('0.0.0.0', 8000), NoCacheHTTPRequestHandler)
    print('Server running on http://0.0.0.0:8000')
    server.serve_forever()

