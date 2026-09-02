class H(BaseHTTPRequestHandler):
    def do_HEAD(self):
        return 1

    def unused_hook(self):
        return 2
