# audit.py: remembers the current web request while it is being handled,
# so the audit trail can record who made each change and from which IP
# address.

import threading

_state = threading.local()


class AuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _state.request = request
        try:
            return self.get_response(request)
        finally:
            _state.request = None


def current_request():
    return getattr(_state, "request", None)