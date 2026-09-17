# config/urls.py: the main URL file of the project. /admin/ opens the
# Django admin site, and every address under /api/ is handled by the
# clinic app's urls.py.

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("clinic.urls")),
]