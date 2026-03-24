from http.server import SimpleHTTPRequestHandler, HTTPServer
import os

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    os.chdir('.')  # Change to your webapp directory if needed
    server = HTTPServer(('0.0.0.0', 8000), NoCacheHTTPRequestHandler)
    print('Server running on http://0.0.0.0:8000')
    server.serve_forever()

