# models.py: the database tables of the clinic system. Users with roles,
# patients, doctors, specializations, time slots and appointments with
# their custom permissions, plus activity logs, audit logs and patient
# notifications. It keeps each user in their role's permission group and
# automatically records every create, change and delete in the audit
# trail, hiding passwords.

from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.db import models
from django.db.models.signals import m2m_changed, post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from .audit import current_request


def split_full_name(full_name):
    "Split Amina Yusuf Ali into Amina, Yusuf Ali)."
    first_name, _, last_name = full_name.partition(" ")
    return first_name, last_name


class User(AbstractUser):
    class Role(models.TextChoices):
        MANAGER = "MANAGER", "Clinic Manager"
        DOCTOR = "DOCTOR", "Doctor"
        RECEPTIONIST = "RECEPTIONIST", "Receptionist"
        PATIENT = "PATIENT", "Patient"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.PATIENT)
    phone = models.CharField(max_length=30, blank=True)

    class Meta:
        permissions = [
            ("view_overview", "Can view overview"),
            ("view_reports", "Can view reports"),
            ("view_settings", "Can view settings"),
        ]

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    def set_full_name(self, full_name):
        self.first_name, self.last_name = split_full_name(full_name)


class Patient(models.Model):
    class Gender(models.TextChoices):
        FEMALE = "F", "Female"
        MALE = "M", "Male"

    user_account = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name="patient_profile")
    full_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=30)
    gender = models.CharField(max_length=1, choices=Gender.choices)
    date_of_birth = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class Specialization(models.Model):
    # The manager can add names without a code change.

    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Doctor(models.Model):
    user_account = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name="doctor_profile")
    full_name = models.CharField(max_length=120)
    specialization = models.CharField(max_length=100)
    room = models.CharField(max_length=20, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return f"Dr. {self.full_name}"


class Slot(models.Model):
    
    doctor = models.ForeignKey(Doctor, on_delete=models.CASCADE, related_name="slots")
    date = models.DateField()
    time = models.TimeField()
    is_blocked = models.BooleanField(default=False)
    is_booked = models.BooleanField(default=False)

    class Meta:
        ordering = ["date", "time"]
        constraints = [models.UniqueConstraint(fields=["doctor", "date", "time"], name="unique_doctor_slot")]

    def __str__(self):
        return f"{self.doctor} {self.date} {self.time:%H:%M}"

    @property
    def is_open(self):
        return not self.is_blocked and not self.is_booked and self.date >= timezone.localdate()

    @classmethod
    def open_day(cls, doctor, day, start, end, minutes):
        "Create a slot every `minutes` from start up to end; return how many were new."
        moment, closing = datetime.combine(day, start), datetime.combine(day, end)
        added = 0
        while moment < closing:
            _, is_new = cls.objects.get_or_create(doctor=doctor, date=day, time=moment.time())
            added += int(is_new)
            moment += timedelta(minutes=minutes)
        return added


class Appointment(models.Model):
    class Status(models.TextChoices):
        BOOKED = "BOOKED", "Waiting for approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"
        POSTPONED = "POSTPONED", "Postponed"
        TRANSFERRED = "TRANSFERRED", "Transferred"
        VISITED = "VISITED", "Visited"
        COMPLETED = "COMPLETED", "Completed"

    # Statuses where the doctor still has to approve or reject the visit.
    WAITING = [Status.BOOKED, Status.POSTPONED, Status.TRANSFERRED]
    # Statuses where the visit has not happened yet and can still be moved.
    OPEN = WAITING + [Status.APPROVED]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="appointments")
    doctor = models.ForeignKey(Doctor, on_delete=models.PROTECT, related_name="appointments")
    # A cancelled visit keeps its old slot, so one slot can be on many rows.
    # Use slot.is_booked to know if the time is free.
    slot = models.ForeignKey(Slot, on_delete=models.PROTECT, related_name="appointments")
    reason = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.BOOKED)
    notes = models.TextField(blank=True)
    reschedule_count = models.PositiveIntegerField(default=0)
    postpone_count = models.PositiveIntegerField(default=0)
    transfer_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="booked_appointments")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-slot__date", "-slot__time"]
        permissions = [
            ("view_booking", "Can view booking"),
            ("book_appointment", "Can book appointment"),
            ("approve_appointment", "Can approve appointment"),
            ("reject_appointment", "Can reject appointment"),
            ("postpone_appointment", "Can postpone appointment"),
            ("reschedule_appointment", "Can reschedule appointment"),
            ("transfer_appointment", "Can transfer appointment"),
            ("cancel_appointment", "Can cancel appointment"),
        ]

    def __str__(self):
        return f"{self.patient} with {self.doctor} on {self.slot.date}"

    @property
    def can_be_changed(self):
        return self.status in self.OPEN and self.slot.date >= timezone.localdate()


class ActivityLog(models.Model):
    class Action(models.TextChoices):
        LOGIN = "LOGIN", "Signed in"
        LOGIN_FAILED = "LOGIN_FAILED", "Failed sign in"
        LOGOUT = "LOGOUT", "Signed out"
        CREATE = "CREATE", "Created"
        UPDATE = "UPDATE", "Updated"
        DELETE = "DELETE", "Deleted"
        ERROR = "ERROR", "Error"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="activity_logs")
    action = models.CharField(max_length=20, choices=Action.choices)
    description = models.CharField(max_length=255)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "activity log"
        verbose_name_plural = "activity log"


class AuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "CREATE", "Created"
        UPDATE = "UPDATE", "Updated"
        DELETE = "DELETE", "Deleted"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="audit_logs")
    action = models.CharField(max_length=20, choices=Action.choices)
    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=64)
    object_repr = models.CharField(max_length=255)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "audit log"
        verbose_name_plural = "audit log"


class Notification(models.Model):
    "A short message for the patient, written when staff or the doctor change one of their appointments."

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="notifications")
    appointment = models.ForeignKey(Appointment, on_delete=models.CASCADE, null=True, blank=True,
                                    related_name="notifications")
    message = models.CharField(max_length=255)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.message


def client_ip(request):
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_activity(request, action, description, user=None):
    actor = user or getattr(request, "user", None)
    # A failed sign in can arrive carrying another account's token; the attempt
    if action == ActivityLog.Action.LOGIN_FAILED or not (actor and actor.is_authenticated):
        actor = None
    return ActivityLog.objects.create(user=actor, action=action, description=description[:255],
                                      ip_address=client_ip(request))


ROLE_GROUPS = {
    User.Role.MANAGER: "Clinic Manager",
    User.Role.DOCTOR: "Doctor",
    User.Role.RECEPTIONIST: "Receptionist",
    User.Role.PATIENT: "Patient",
}


@receiver(post_save, sender=User)
def sync_role_group(sender, instance, **kwargs):
    role_groups = Group.objects.filter(name__in=ROLE_GROUPS.values())
    instance.groups.remove(*role_groups)

    wanted = role_groups.filter(name=ROLE_GROUPS.get(instance.role)).first()
    if wanted:
        instance.groups.add(wanted)


AUDIT_IGNORED_FIELDS = {"last_login", "created_at", "updated_at"}
AUDIT_HIDDEN_FIELDS = {"password"}


def audited_models():
    return (Patient, Doctor, Specialization, Appointment, User)


def field_value(instance, field):
    value = field.value_from_object(instance)
    return None if value is None else str(value)


def snapshot(instance):
    return {
        field.name: field_value(instance, field)
        for field in instance._meta.concrete_fields
        if field.name not in AUDIT_IGNORED_FIELDS
    }


def shown(name, value):
    if name in AUDIT_HIDDEN_FIELDS and value is not None:
        return "******"
    return value


def describe(instance):
    try:
        return str(instance)[:255]
    except Exception:
        return f"{instance._meta.verbose_name} #{instance.pk}"


def write_audit(action, instance, changes):
    request = current_request()
    actor = getattr(request, "user", None)
    if not (actor and actor.is_authenticated):
        actor = None
    AuditLog.objects.create(
        user=actor,
        action=action,
        model_name=str(instance._meta.verbose_name).title(),
        object_id=str(instance.pk),
        object_repr=describe(instance),
        changes=changes,
        ip_address=client_ip(request) if request else None,
    )


@receiver(pre_save)
def remember_before_save(sender, instance, raw=False, **kwargs):
    if raw or sender not in audited_models() or not instance.pk:
        return
    previous = sender.objects.filter(pk=instance.pk).first()
    instance._audit_before = snapshot(previous) if previous else None


@receiver(post_save)
def audit_save(sender, instance, created, raw=False, **kwargs):
    if raw or sender not in audited_models():
        return
    after = snapshot(instance)
    if created:
        changes = {name: [None, shown(name, value)] for name, value in after.items() if value not in (None, "")}
        write_audit(AuditLog.Action.CREATE, instance, changes)
        return

    before = getattr(instance, "_audit_before", None)
    if before is None:
        return
    changes = {
        name: [shown(name, before.get(name)), shown(name, value)]
        for name, value in after.items()
        if before.get(name) != value
    }
    if changes:
        write_audit(AuditLog.Action.UPDATE, instance, changes)
    instance._audit_before = after


@receiver(post_delete)
def audit_delete(sender, instance, **kwargs):
    if sender not in audited_models():
        return
    changes = {name: [shown(name, value), None] for name, value in snapshot(instance).items() if value not in (None, "")}
    write_audit(AuditLog.Action.DELETE, instance, changes)


@receiver(m2m_changed, sender=Group.permissions.through)
def audit_group_permissions(sender, instance, action, pk_set, reverse=False, **kwargs):
    if reverse or action not in ("post_add", "post_remove") or not pk_set:
        return
    codenames = ", ".join(sorted(Permission.objects.filter(pk__in=pk_set).values_list("codename", flat=True)))
    if action == "post_add":
        changes = {"added permissions": [None, codenames]}
    else:
        changes = {"removed permissions": [codenames, None]}
    write_audit(AuditLog.Action.UPDATE, instance, changes)