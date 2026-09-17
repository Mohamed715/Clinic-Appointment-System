# error_log.py: records backend errors in the System Logs.
# clinic_exception_handler catches API errors such as invalid forms (400),
# refused permissions (403) and crashes (500), and saves the method, path,
# status and message. ErrorLogMiddleware catches crashes outside the API.
# Expired sessions (401) and missing pages (404) are skipped. After a
# crash, users see a short message instead of a broken page.

import logging

from django.http import JsonResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .models import ActivityLog, log_activity

logger = logging.getLogger(__name__)

SKIPPED_STATUSES = {status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND}
SERVER_ERROR_TEXT = "Something went wrong on the server. It has been recorded in the error log."


def error_message(data):
    if isinstance(data, dict):
        if "detail" in data:
            return str(data["detail"])
        parts = []
        for field, messages in data.items():
            text = " ".join(str(item) for item in messages) if isinstance(messages, list) else str(messages)
            parts.append(f"{field}: {text}")
        return "; ".join(parts)
    if isinstance(data, list):
        return " ".join(str(item) for item in data)
    return str(data)


def clinic_exception_handler(exc, context):
    response = exception_handler(exc, context)
    request = context.get("request")

    if response is None:
        logger.exception("Unhandled server error", exc_info=exc)
        response = Response({"detail": SERVER_ERROR_TEXT}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        message = f"{type(exc).__name__}: {exc}"
    else:
        message = error_message(response.data)

    if request is not None and response.status_code not in SKIPPED_STATUSES:
        try:
            log_activity(request, ActivityLog.Action.ERROR,
                         f"{request.method} {request.path} -> {response.status_code}: {message}")
        except Exception:
            logger.exception("Could not write to the error log")

    return response


class ErrorLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        logger.exception("Unhandled server error", exc_info=exception)
        try:
            log_activity(request, ActivityLog.Action.ERROR,
                         f"{request.method} {request.path} -> 500: {type(exception).__name__}: {exception}")
        except Exception:
            logger.exception("Could not write to the error log")
        return JsonResponse({"detail": SERVER_ERROR_TEXT}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)