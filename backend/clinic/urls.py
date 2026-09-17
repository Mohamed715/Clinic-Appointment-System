# urls.py: maps every API address to its view.
# desk: staff tables (patients, doctors, specializations, appointments,
# activity and audit logs, user accounts).
# auth: sign in, sign out, profile, password change, reset and sign-up.
# Also dashboard, reports, permissions and free slots.
# doctor/: the doctor's own slots and appointments.
# portal/: patient doctors, free times, bookings and notifications.

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

desk = DefaultRouter()
desk.register("patients", views.PatientViewSet, basename="patient")
desk.register("doctors", views.DoctorViewSet, basename="doctor")
desk.register("specializations", views.SpecializationViewSet, basename="specialization")
desk.register("appointments", views.AppointmentViewSet, basename="appointment")
desk.register("logs", views.ActivityLogViewSet, basename="log")
desk.register("audit-logs", views.AuditLogViewSet, basename="audit-log")
desk.register("accounts", views.AccountViewSet, basename="account")

doctor = DefaultRouter()
doctor.register("slots", views.DoctorSlotViewSet, basename="doctor-slot")
doctor.register("appointments", views.DoctorAppointmentViewSet, basename="doctor-appointment")

portal = DefaultRouter()
portal.register("appointments", views.PortalAppointmentViewSet, basename="portal-appointment")

urlpatterns = desk.urls + [
    path("auth/login/", views.LoginView.as_view()),
    path("auth/logout/", views.LogoutView.as_view()),
    path("auth/me/", views.MeView.as_view()),
    path("auth/password/", views.PasswordView.as_view()),
    path("auth/forgot/", views.ForgotPasswordView.as_view()),
    path("auth/signup/", views.SignupView.as_view()),

    path("dashboard/", views.DashboardView.as_view()),
    path("reports/", views.ReportView.as_view()),
    path("access/", views.AccessView.as_view()),
    path("open-slots/", views.OpenSlotsView.as_view()),

    path("doctor/", include(doctor.urls)),
    path("portal/doctors/", views.PortalDoctorsView.as_view()),
    path("portal/slots/", views.PortalSlotsView.as_view()),
    path("portal/notifications/", views.PortalNotificationsView.as_view()),
    path("portal/", include(portal.urls)),
]