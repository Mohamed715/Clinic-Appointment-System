"""setup_clinic.py: creates the four permission groups (Clinic Manager,
Doctor, Receptionist, Patient) with their starting permissions. Existing
groups keep the ticks set in the browser. Only newly added permissions
get their default ticks. --reset restores every default. It also puts
each user into the group that matches their role."""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

from clinic.models import ROLE_GROUPS, User

DEFAULT_PERMISSIONS = {
    "Clinic Manager": ["add_patient", "change_patient", "delete_patient", "view_patient",
                       "add_doctor", "change_doctor", "delete_doctor", "view_doctor",
                       "add_appointment", "change_appointment", "delete_appointment", "view_appointment",
                       "add_slot", "change_slot", "delete_slot", "view_slot",
                       "add_specialization", "change_specialization", "delete_specialization",
                       "view_specialization",
                       "view_activitylog", "add_user", "change_user", "delete_user", "view_user"],
    "Doctor": ["view_patient", "view_doctor", "view_appointment", "change_appointment",
               "add_slot", "change_slot", "delete_slot", "view_slot", "view_specialization"],
    "Receptionist": ["add_patient", "change_patient", "view_patient", "view_doctor", "view_slot",
                     "view_specialization", "add_appointment", "change_appointment", "view_appointment"],
    "Patient": [],
}

ACTION_PERMISSIONS = {
    "Clinic Manager": ["view_auditlog", "view_overview", "view_reports", "view_settings", "book_appointment", "approve_appointment", "reject_appointment", "postpone_appointment",
                       "reschedule_appointment", "transfer_appointment", "cancel_appointment"],
    "Doctor": ["view_reports", "view_settings", "approve_appointment", "reject_appointment", "transfer_appointment", "cancel_appointment"],
    "Receptionist": ["view_overview", "view_settings", "book_appointment", "approve_appointment", "reject_appointment", "postpone_appointment",
                     "transfer_appointment", "cancel_appointment"],
    "Patient": ["view_settings", "view_booking", "book_appointment", "reschedule_appointment", "cancel_appointment"],
}

ALL_ACTIONS = sorted({codename for codenames in ACTION_PERMISSIONS.values() for codename in codenames})


def clinic_permissions(codenames):
    return Permission.objects.filter(codename__in=codenames, content_type__app_label="clinic")


def is_new_permission(codename):
    return not Group.objects.filter(
        permissions__codename=codename, permissions__content_type__app_label="clinic"
    ).exists()


class Command(BaseCommand):
    help = "Create the permission groups. Existing groups keep the permissions set in the browser."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Replace the permissions of every group with the defaults.",
        )

    def handle(self, *args, **options):
        reset = options["reset"]
        new_actions = [codename for codename in ALL_ACTIONS if is_new_permission(codename)]

        for name, codenames in DEFAULT_PERMISSIONS.items():
            group, created = Group.objects.get_or_create(name=name)
            actions = ACTION_PERMISSIONS[name]
            if created or reset:
                group.permissions.set(clinic_permissions(codenames + actions))
                state = "defaults applied"
            else:
                added = [codename for codename in actions if codename in new_actions]
                group.permissions.add(*clinic_permissions(added))
                state = f"new permissions added: {', '.join(added)}" if added else "kept"
            self.stdout.write(f"{name}: {group.permissions.count()} permissions ({state})")

        for role, group_name in ROLE_GROUPS.items():
            group = Group.objects.get(name=group_name)
            for account in User.objects.filter(role=role).exclude(groups=group):
                account.groups.add(group)

        self.stdout.write(self.style.SUCCESS("Clinic system ready."))