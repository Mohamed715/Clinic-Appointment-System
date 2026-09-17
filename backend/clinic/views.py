# views.py: the API endpoints of the clinic system.
# - Account: sign in and out, own profile, password change, patient
#   sign-up and password reset by phone number.
# - Staff: patients, doctors, specializations and appointments (book,
#   approve, reject, postpone, transfer, cancel, delete); dashboard,
#   reports, user accounts with Register Staff, and the Permissions page.
# - Logs: activity and error logs, and the audit trail.
# - Doctors: open and block their own time slots, manage their own
#   appointments and view their report.
# - Patients: see doctors and free times, book, reschedule or cancel
#   their visits, and read notifications.
# Every action checks the matching permission from the Permissions page,
# and most changes are written to the activity log. Deleting protects
# against removing booked doctors, used specializations or your own
# account.

from datetime import datetime, time as clock, timedelta
from django.contrib.auth import authenticate
from django.contrib.auth.models import Group, Permission
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import appointment_actions as actions
from .appointment_actions import bad_request
from .models import ActivityLog, Appointment, AuditLog, Doctor, Notification, Patient, Slot, Specialization, User, log_activity
from .permissions import ClinicModelPermissions, IsDeskStaff, IsDoctor, IsManager, IsPatient, IsStaff
from .serializers import (MIN_PASSWORD_LENGTH, AccountSerializer, ActivityLogSerializer,
                          AppointmentSerializer, DoctorSerializer, GroupSerializer,
                          NotificationSerializer, PatientSerializer, PermissionSerializer,
                          SignupSerializer, SlotSerializer, SpecializationSerializer, UserSerializer)

PASSWORD_TOO_SHORT = f"Use at least {MIN_PASSWORD_LENGTH} characters."
# Deleted appointments no longer exist, so the report counts these log entries instead.
DELETED_APPOINTMENT_LOG = "Deleted appointment"
STAFF_ROLES = [User.Role.MANAGER.value, User.Role.RECEPTIONIST.value]


def change_password(account, new_password):
    account.set_password(new_password)
    account.save(update_fields=["password"])
    Token.objects.filter(user=account).delete()


def session_response(user, status_code=status.HTTP_200_OK):
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": UserSerializer(user).data}, status=status_code)


def filter_by_params(queryset, params, **lookups):
    " filter_by_params(bookings, params."
    for param, lookup in lookups.items():
        if params.get(param):
            queryset = queryset.filter(**{lookup: params[param]})
    return queryset


STATUS_PERMISSIONS = {
    Appointment.Status.APPROVED: "approve_appointment",
    Appointment.Status.REJECTED: "reject_appointment",
}


def require_permission(request, codename):
    if not request.user.has_perm(f"clinic.{codename}"):
        raise PermissionDenied("You do not have permission to do this.")


def require_status_permission(request):
    codename = STATUS_PERMISSIONS.get(request.data.get("status"), "change_appointment")
    require_permission(request, codename)


def delete_with_login(record):
    "Remove a patient or doctor together with the login attached to it."
    if record.user_account:
        record.user_account.delete()
    record.delete()


class StaffAccountSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=MIN_PASSWORD_LENGTH,
                                     error_messages={"min_length": PASSWORD_TOO_SHORT})
    first_name = serializers.CharField(max_length=150,
                                       error_messages={"blank": "Enter a first name."})
    role = serializers.ChoiceField(choices=STAFF_ROLES,
                                   error_messages={"invalid_choice": "Choose Clinic Manager or Receptionist."})

    class Meta:
        model = User
        fields = ["username", "password", "first_name", "last_name", "email", "phone", "role", "is_active"]

    def validate_username(self, value):
        value = value.strip()
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        user = authenticate(request, username=username, password=request.data.get("password") or "")

        if user is None:
            log_activity(request, ActivityLog.Action.LOGIN_FAILED, f"Failed sign in for '{username}'")
            return Response({"detail": "Username or password is not correct."}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            return Response({"detail": "This account is switched off."}, status=status.HTTP_403_FORBIDDEN)

        log_activity(request, ActivityLog.Action.LOGIN, f"Signed in as {user.get_role_display()}", user=user)
        return session_response(user)


class LogoutView(APIView):
    def post(self, request):
        log_activity(request, ActivityLog.Action.LOGOUT, "Signed out")
        Token.objects.filter(user=request.user).delete()
        return Response({"detail": "Signed out."})


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        require_permission(request, "view_settings")
        account = request.user
        for field in ["first_name", "last_name", "email", "phone"]:
            if field in request.data:
                setattr(account, field, request.data[field])
        account.save()

        # Patient and doctor records keep their own copy of the name and phone.
        for profile_name in ("patient_profile", "doctor_profile"):
            profile = getattr(account, profile_name, None)
            if profile:
                profile.full_name = account.get_full_name() or profile.full_name
                profile.phone = account.phone or profile.phone
                profile.save(update_fields=["full_name", "phone"])

        log_activity(request, ActivityLog.Action.UPDATE, "Updated own profile")
        return Response(UserSerializer(account).data)


class ForgotPasswordView(APIView):
    "A patient resets the password with their phone number, plus the date of birth when the clinic has one."

    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip().lower()
        phone = (request.data.get("phone") or "").strip()
        born = (request.data.get("date_of_birth") or "").strip()
        new_password = request.data.get("new_password") or ""

        if len(new_password) < MIN_PASSWORD_LENGTH:
            return bad_request("new_password", PASSWORD_TOO_SHORT)

        account = User.objects.filter(username=username, role=User.Role.PATIENT).first()
        patient = getattr(account, "patient_profile", None)
        if not self.details_match(patient, phone, born):
            log_activity(request, ActivityLog.Action.LOGIN_FAILED, f"Failed password reset for '{username}'")
            return bad_request("detail", "Those details do not match any patient account. Ask the clinic for help.")

        change_password(account, new_password)
        log_activity(request, ActivityLog.Action.UPDATE, f"Patient reset their password: {username}", user=account)
        return Response({"detail": "Password changed. You can sign in now."})

    @staticmethod
    def details_match(patient, phone, born):
        if patient is None or patient.phone != phone:
            return False
        return not patient.date_of_birth or str(patient.date_of_birth) == born


class PasswordView(APIView):
    def post(self, request):
        require_permission(request, "view_settings")
        account = request.user
        current = request.data.get("current_password") or ""
        new_password = request.data.get("new_password") or ""

        if not account.check_password(current):
            return bad_request("current_password", "That is not your current password.")
        if len(new_password) < MIN_PASSWORD_LENGTH:
            return bad_request("new_password", PASSWORD_TOO_SHORT)

        change_password(account, new_password)
        token = Token.objects.create(user=account)

        log_activity(request, ActivityLog.Action.UPDATE, "Changed own password")
        return Response({"token": token.key})


class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        form = SignupSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        patient = form.save()

        log_activity(request, ActivityLog.Action.CREATE, f"Patient signed up: {patient.full_name}",
                     user=patient.user_account)
        return session_response(patient.user_account, status.HTTP_201_CREATED)


class PatientViewSet(viewsets.ModelViewSet):
    serializer_class = PatientSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = Patient.objects.all()

    def get_queryset(self):
        patients = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            patients = patients.filter(Q(full_name__icontains=search) | Q(phone__icontains=search))
        return patients

    def perform_create(self, serializer):
        patient = serializer.save()
        log_activity(self.request, ActivityLog.Action.CREATE, f"Registered patient {patient.full_name}")

    def perform_update(self, serializer):
        patient = serializer.save()
        log_activity(self.request, ActivityLog.Action.UPDATE, f"Edited patient {patient.full_name}")

    def perform_destroy(self, patient):
        # The delete cascades to the appointments without touching their
        # slots, so give those times back first.
        Slot.objects.filter(appointments__patient=patient).update(is_booked=False)
        name = patient.full_name
        delete_with_login(patient)
        log_activity(self.request, ActivityLog.Action.DELETE, f"Deleted patient {name}")


class DoctorViewSet(viewsets.ModelViewSet):
    serializer_class = DoctorSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = Doctor.objects.all()

    def get_queryset(self):
        doctors = super().get_queryset()
        if self.request.query_params.get("active") == "true":
            doctors = doctors.filter(is_active=True)
        return doctors

    def perform_create(self, serializer):
        doctor = serializer.save()
        log_activity(self.request, ActivityLog.Action.CREATE, f"Added {doctor}")

    def perform_update(self, serializer):
        doctor = serializer.save()
        # The doctor's login keeps its own copy of the name and phone.
        account = doctor.user_account
        if account:
            account.set_full_name(doctor.full_name)
            account.phone = doctor.phone
            account.save(update_fields=["first_name", "last_name", "phone"])

        log_activity(self.request, ActivityLog.Action.UPDATE, f"Edited {doctor}")

    def perform_destroy(self, doctor):
        # Appointments reference the doctor with PROTECT; explain that instead
        # of letting the delete fail with a server error.
        if doctor.appointments.exists():
            raise ValidationError("This doctor has appointments. Turn them off instead of deleting.")

        name = str(doctor)
        delete_with_login(doctor)
        log_activity(self.request, ActivityLog.Action.DELETE, f"Deleted {name}")


class SpecializationViewSet(viewsets.ModelViewSet):
    serializer_class = SpecializationSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = Specialization.objects.all()

    def perform_create(self, serializer):
        specialization = serializer.save()
        log_activity(self.request, ActivityLog.Action.CREATE, f"Added specialization {specialization.name}")

    def perform_update(self, serializer):
        was_called = Specialization.objects.get(pk=serializer.instance.pk).name
        specialization = serializer.save()
        # Doctors keep the name, not the row, so rename them along with it.
        Doctor.objects.filter(specialization=was_called).update(specialization=specialization.name)
        log_activity(self.request, ActivityLog.Action.UPDATE,
                     f"Renamed specialization {was_called} to {specialization.name}")

    def perform_destroy(self, specialization):
        if Doctor.objects.filter(specialization=specialization.name).exists():
            raise ValidationError("Doctors are using this specialization. Change them first.")

        name = specialization.name
        specialization.delete()
        log_activity(self.request, ActivityLog.Action.DELETE, f"Deleted specialization {name}")


class AppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = AppointmentSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = Appointment.objects.select_related("patient", "doctor", "slot")

    def get_queryset(self):
        params = self.request.query_params
        bookings = filter_by_params(super().get_queryset(), params,
                                    date="slot__date", status="status", doctor="doctor_id")
        search = params.get("search")
        if search:
            bookings = bookings.filter(Q(patient__full_name__icontains=search) | Q(patient__phone__icontains=search))
        return bookings

    def perform_destroy(self, booking):
        # Cancelled and rejected visits already gave their time back, and it may
        # have been booked again since.
        if booking.status not in (Appointment.Status.CANCELLED, Appointment.Status.REJECTED):
            actions.release_slot(booking)
        description = (f"{DELETED_APPOINTMENT_LOG} of {booking.patient.full_name} with {booking.doctor} "
                       f"on {actions.format_slot_time(booking.slot)}")
        booking.delete()
        log_activity(self.request, ActivityLog.Action.DELETE, description)

    def perform_create(self, serializer):
        require_permission(self.request, "book_appointment")
        if not serializer.validated_data.get("patient"):
            raise ValidationError({"patient": "Choose a patient."})

        slot = serializer.validated_data["slot"]
        booking = serializer.save(doctor=slot.doctor, created_by=self.request.user)
        actions.reserve_slot(slot)
        log_activity(self.request, ActivityLog.Action.CREATE,
                     f"Booked {booking.patient.full_name} with {booking.doctor} on {slot.date}")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require_permission(request, "cancel_appointment")
        return actions.cancel(request, self.get_object(), self.get_serializer, by_patient=False)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        require_status_permission(request)
        return actions.change_status(request, self.get_object(), request.data.get("status"), self.get_serializer)

    @action(detail=True, methods=["post"], permission_classes=[ClinicModelPermissions, IsDeskStaff])
    def postpone(self, request, pk=None):
        require_permission(request, "postpone_appointment")
        return actions.postpone(request, self.get_object(), self.get_serializer)

    @action(detail=True, methods=["post"], permission_classes=[ClinicModelPermissions, IsDeskStaff])
    def transfer(self, request, pk=None):
        require_permission(request, "transfer_appointment")
        return actions.transfer(request, self.get_object(), self.get_serializer)


class OpenSlotsView(APIView):
    "Free times of one doctor, for the transfer and postpone forms."

    permission_classes = [IsStaff]

    def get(self, request):
        slots = actions.free_slots(request.query_params.get("doctor")).filter(doctor__is_active=True)
        return Response(SlotSerializer(slots, many=True).data)


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ActivityLogSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = ActivityLog.objects.select_related("user")

    def get_queryset(self):
        entries = super().get_queryset()
        kind = self.request.query_params.get("kind")
        if kind == "errors":
            entries = entries.filter(action=ActivityLog.Action.ERROR)
        elif kind == "activity":
            entries = entries.exclude(action=ActivityLog.Action.ERROR)
        return entries[:200]


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    action_label = serializers.CharField(source="get_action_display")

    class Meta:
        model = AuditLog
        fields = ["id", "created_at", "user_name", "action", "action_label", "model_name",
                  "object_id", "object_repr", "changes", "ip_address"]

    def get_user_name(self, entry):
        return entry.user.display_name if entry.user else "System"


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [ClinicModelPermissions]
    queryset = AuditLog.objects.select_related("user")

    def get_queryset(self):
        entries = super().get_queryset()
        record = self.request.query_params.get("record")
        if record:
            entries = entries.filter(model_name=record)
        return entries[:200]


class AccountViewSet(viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsManager, ClinicModelPermissions]
    queryset = User.objects.order_by("username")
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        params = self.request.query_params
        accounts = filter_by_params(super().get_queryset(), params, role="role")
        search = params.get("search")
        if search:
            accounts = accounts.filter(Q(username__icontains=search) | Q(first_name__icontains=search)
                                       | Q(last_name__icontains=search))
        return accounts

    def create(self, request, *args, **kwargs):
        form = StaffAccountSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        account = form.save()
        log_activity(request, ActivityLog.Action.CREATE,
                     f"Registered {account.get_role_display()} account {account.username}")
        return Response(AccountSerializer(account, context={"request": request}).data,
                        status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        account = serializer.save()
        log_activity(self.request, ActivityLog.Action.UPDATE,
                     f"Account {account.username} set to {account.get_role_display()}")

    def perform_destroy(self, account):
        # Otherwise a manager could lock themselves out.
        if account.pk == self.request.user.pk:
            raise ValidationError("You cannot delete the account you are signed in with.")

        username = account.username
        account.delete()
        log_activity(self.request, ActivityLog.Action.DELETE, f"Deleted account {username}")


class AccessView(APIView):
    "Groups and their permissions, for the manager's Permissions page."

    permission_classes = [IsManager]

    def get(self, request):
        groups = Group.objects.prefetch_related("permissions").order_by("name")
        clinic_permissions = Permission.objects.filter(content_type__app_label="clinic").order_by("codename")
        return Response({
            "groups": GroupSerializer(groups, many=True).data,
            "permissions": PermissionSerializer(clinic_permissions, many=True).data,
        })

    def patch(self, request):
        group = Group.objects.filter(pk=request.data.get("group")).first()
        if group is None:
            return bad_request("group", "Unknown group.")

        group.permissions.set(Permission.objects.filter(pk__in=request.data.get("permissions", [])))
        log_activity(request, ActivityLog.Action.UPDATE, f"Changed permissions of {group.name}")
        return Response(GroupSerializer(group).data)


'This function makes the data for the "Bookings – Last six months" chart on the dashboard'
def bookings_by_month():
    today = timezone.localdate()
    months = []
    for months_back in range(5, -1, -1):
        first_day = (today.replace(day=1) - timedelta(days=months_back * 30)).replace(day=1)
        next_month = (first_day.replace(day=28) + timedelta(days=4)).replace(day=1)
        bookings = Appointment.objects.filter(slot__date__gte=first_day, slot__date__lt=next_month)
        months.append({"month": first_day.strftime("%b"), "bookings": bookings.count()})
    return months


def total_transfers(bookings):
    return bookings.aggregate(total=Sum("transfer_count"))["total"] or 0


class DashboardView(APIView):
    permission_classes = [IsStaff]

    def get(self, request):
        require_permission(request, "view_overview")
        todays_bookings = Appointment.objects.filter(slot__date=timezone.localdate())
        counts = dict(Appointment.objects.values_list("status").annotate(total=Count("id")))

        return Response({
            "appointments_today": todays_bookings.count(),
            "transfers_total": total_transfers(Appointment.objects.all()),
            "waiting": sum(counts.get(state, 0) for state in Appointment.WAITING),
            "patients_total": Patient.objects.count(),
            "doctors_active": Doctor.objects.filter(is_active=True).count(),
            "by_status": {key.lower(): counts.get(key, 0) for key, _ in Appointment.Status.choices},
            "trend": bookings_by_month(),
            "today": AppointmentSerializer(
                todays_bookings.select_related("patient", "doctor", "slot"), many=True).data,
        })


def count_with_status(*statuses):
    return Count("appointments", filter=Q(appointments__status__in=statuses))


def zeros_for_missing(row):
    # Sum() returns None for someone with no appointments.
    return {key: 0 if value is None else value for key, value in row.items()}


class ReportView(APIView):
    permission_classes = [IsManager]

    def get(self, request):
        require_permission(request, "view_reports")
        return Response({
            "transfers_total": total_transfers(Appointment.objects.all()),
            "appointments_deleted": ActivityLog.objects.filter(
                action=ActivityLog.Action.DELETE, description__startswith=DELETED_APPOINTMENT_LOG).count(),
            "patients": [zeros_for_missing(row) for row in self.patient_rows()],
            "doctors": [zeros_for_missing(row) for row in self.doctor_rows()],
        })

    'This method builds the rows of the "Patient report" table on the Reports page.'
    @staticmethod
    def patient_rows():
        Status = Appointment.Status
        not_going_ahead = [Status.CANCELLED, Status.REJECTED]
        return Patient.objects.annotate(
            booked=Count("appointments", filter=~Q(appointments__status__in=not_going_ahead)),
            cancelled=count_with_status(Status.CANCELLED),
            rescheduled=Sum("appointments__reschedule_count"),
            postponed=Sum("appointments__postpone_count"),
        ).values("id", "full_name", "phone", "booked", "cancelled", "rescheduled", "postponed")

    @staticmethod
    def doctor_rows():
        Status = Appointment.Status
        return Doctor.objects.annotate(
            waiting=count_with_status(*Appointment.WAITING),
            approved=count_with_status(Status.APPROVED),
            visited=count_with_status(Status.VISITED),
            completed=count_with_status(Status.COMPLETED),
            cancelled=count_with_status(Status.CANCELLED),
            rejected=count_with_status(Status.REJECTED),
            rescheduled=Sum("appointments__reschedule_count"),
        ).values("id", "full_name", "specialization", "waiting", "approved", "visited", "completed",
                 "cancelled", "rejected", "rescheduled")


class DoctorSlotViewSet(viewsets.ModelViewSet):
    "A doctor can only see and change their own times."

    serializer_class = SlotSerializer
    permission_classes = [IsDoctor]

    @property
    def doctor(self):
        return self.request.user.doctor_profile

    def get_queryset(self):
        require_permission(self.request, "view_slot")
        own_slots = Slot.objects.filter(doctor=self.doctor)
        return filter_by_params(own_slots, self.request.query_params, date="date")

    def perform_create(self, serializer):
        require_permission(self.request, "add_slot")
        serializer.save(doctor=self.doctor)

    def perform_destroy(self, slot):
        require_permission(self.request, "delete_slot")
        if slot.is_booked:
            raise ValidationError("This time is booked. Reject the appointment first.")
        slot.delete()

    @action(detail=False, methods=["post"])
    def generate(self, request):
        "Open a working day in one go, for example 09:00 to 15:00 every 30 minutes."
        require_permission(request, "add_slot")
        try:
            day = datetime.strptime(request.data["date"], "%Y-%m-%d").date()
            start = clock.fromisoformat(request.data["start"])
            end = clock.fromisoformat(request.data["end"])
            step = int(request.data.get("minutes", 30))
        except (KeyError, ValueError):
            return bad_request("detail", "Send date, start and end.")

        if day < timezone.localdate():
            return bad_request("date", "Pick today or a later date.")

        moment = datetime.combine(day, start)
        closing = datetime.combine(day, end)
        added = 0
        while moment < closing:
            _, is_new = Slot.objects.get_or_create(doctor=self.doctor, date=day, time=moment.time())
            added += int(is_new)
            moment += timedelta(minutes=step)

        return Response({"added": added}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        require_permission(request, "change_slot")
        slot = self.get_object()
        if slot.is_booked:
            return bad_request("detail", "This time is booked.")

        slot.is_blocked = not slot.is_blocked
        slot.save(update_fields=["is_blocked"])
        return Response(self.get_serializer(slot).data)


class DoctorAppointmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AppointmentSerializer
    permission_classes = [IsDoctor]

    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        require_permission(request, "transfer_appointment")
        return actions.transfer(request, self.get_object(), self.get_serializer)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require_permission(request, "cancel_appointment")
        return actions.cancel(request, self.get_object(), self.get_serializer, by_patient=False)

    def get_queryset(self):
        require_permission(self.request, "view_appointment")
        own_bookings = Appointment.objects.filter(doctor=self.request.user.doctor_profile)
        bookings = own_bookings.select_related("patient", "slot")
        return filter_by_params(bookings, self.request.query_params, status="status")

    'It changes an appointments status approve, reject, visited, completed'
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        require_status_permission(request)
        return actions.change_status(request, self.get_object(), request.data.get("status"), self.get_serializer)

    @action(detail=False, methods=["get"])
    def report(self, request):
        require_permission(request, "view_reports")
        mine = Appointment.objects.filter(doctor=request.user.doctor_profile)
        counts = dict(mine.values_list("status").annotate(total=Count("id")))
        return Response({
            "totals": {key.lower(): counts.get(key, 0) for key, _ in Appointment.Status.choices},
            "rescheduled": mine.aggregate(total=Sum("reschedule_count"))["total"] or 0,
            "transfers": total_transfers(mine),
            "rows": AppointmentSerializer(mine.select_related("patient", "slot"), many=True).data,
        })

'This view gives patients the list of doctors they can book with'
class PortalDoctorsView(APIView):
    permission_classes = [IsPatient]

    def get(self, request):
        require_permission(request, "view_booking")
        return Response(DoctorSerializer(Doctor.objects.filter(is_active=True), many=True).data)

'This view gives patients the free times of one doctor'
class PortalSlotsView(APIView):
    permission_classes = [IsPatient]

    def get(self, request):
        require_permission(request, "view_booking")
        params = request.query_params
        slots = filter_by_params(actions.free_slots(params.get("doctor")), params, date="date")
        return Response(SlotSerializer(slots, many=True).data)

'This ViewSet is the backend for the patient own appointments'
class PortalAppointmentViewSet(viewsets.ModelViewSet):

    serializer_class = AppointmentSerializer
    permission_classes = [IsPatient]
    http_method_names = ["get", "post", "head", "options"]

    @property
    def patient(self):
        return self.request.user.patient_profile

    def get_queryset(self):
        require_permission(self.request, "view_appointment")
        return Appointment.objects.filter(patient=self.patient).select_related("doctor", "slot")

    def perform_create(self, serializer):
        require_permission(self.request, "book_appointment")
        slot = serializer.validated_data["slot"]
        booking = serializer.save(patient=self.patient, doctor=slot.doctor, created_by=self.request.user)
        actions.reserve_slot(slot)
        log_activity(self.request, ActivityLog.Action.CREATE,
                     f"Patient booked {booking.doctor} on {slot.date} {slot.time:%H:%M}")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require_permission(request, "cancel_appointment")
        return actions.cancel(request, self.get_object(), self.get_serializer, by_patient=True)

    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        require_permission(request, "reschedule_appointment")
        return actions.reschedule(request, self.get_object(), self.get_serializer)


class PortalNotificationsView(APIView):
    "GET lists the patient's messages. POST marks them all as read."

    permission_classes = [IsPatient]

    def get(self, request):
        require_permission(request, "view_notification")
        mine = Notification.objects.filter(patient=request.user.patient_profile)[:100]
        return Response(NotificationSerializer(mine, many=True).data)

    def post(self, request):
        require_permission(request, "view_notification")
        Notification.objects.filter(patient=request.user.patient_profile, is_read=False).update(is_read=True)
        return Response({"detail": "Marked as read."})