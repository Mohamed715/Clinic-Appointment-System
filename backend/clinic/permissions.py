# permissions.py: access rules for the API. ClinicModelPermissions follows
# the Permissions page ticks, including viewing. The others allow only
# managers, desk staff, any staff, doctors or patients.

from rest_framework.permissions import BasePermission, DjangoModelPermissions

from .models import User


class ClinicModelPermissions(DjangoModelPermissions):
    "DRF's default lets any signed in user read. "

    perms_map = {
        **DjangoModelPermissions.perms_map,
        "GET": ["%(app_label)s.view_%(model_name)s"],
        "HEAD": ["%(app_label)s.view_%(model_name)s"],
    }


class IsManager(BasePermission):
    message = "Only the clinic manager can open this."

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and (user.is_superuser or user.role == User.Role.MANAGER))


class IsDeskStaff(BasePermission):
    message = "Only the clinic manager or reception can do this."

    def has_permission(self, request, view):
        user = request.user
        desk_roles = (User.Role.MANAGER, User.Role.RECEPTIONIST)
        return bool(user.is_authenticated and (user.is_superuser or user.role in desk_roles))


class IsStaff(BasePermission):
    message = "This page is for clinic staff."

    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.user.role != User.Role.PATIENT)


class IsDoctor(BasePermission):
    message = "This page is for doctors."

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and user.role == User.Role.DOCTOR and getattr(user, "doctor_profile", None))


class IsPatient(BasePermission):
    message = "This page is for patient accounts."

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and user.role == User.Role.PATIENT
                    and getattr(user, "patient_profile", None))