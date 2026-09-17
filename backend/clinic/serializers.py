# serializers.py: converts database records to and from the JSON used by
# the React app. It covers the signed-in user and their permissions,
# user accounts, permission groups, patient sign-up, patients with
# optional logins, doctors, specializations, time slots, appointments,
# activity logs and notifications. It also checks usernames, passwords,
# birth dates and free time slots.

from django.contrib.auth.models import Group, Permission
from django.utils import timezone
from rest_framework import serializers

from .models import ActivityLog, Appointment, Doctor, Notification, Patient, Slot, Specialization, User

MIN_PASSWORD_LENGTH = 8
USERNAME_PATTERN = r"^[A-Za-z]{3,12}$"
USERNAME_ERRORS = {"invalid": "Use 3 to 12 letters, no spaces or numbers."}


def check_birth_date(born):
    if born and born > timezone.localdate():
        raise serializers.ValidationError("A date of birth cannot be in the future.")
    return born


def check_username_free(username):
    # Stored in lowercase so "Jamac" and "jamac" cannot both be registered.
    username = username.lower()
    if username and User.objects.filter(username=username).exists():
        raise serializers.ValidationError("That username is already taken.")
    return username


def create_patient_login(username, password, full_name, phone):
    account = User(username=username, phone=phone, role=User.Role.PATIENT)
    account.set_full_name(full_name)
    account.set_password(password)
    account.save()
    return account


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "display_name", "email", "phone",
                  "role", "role_label", "is_superuser", "is_active", "permissions"]

    def get_permissions(self, user):
        return sorted(user.get_all_permissions())


class AccountSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    groups = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")
    new_password = serializers.CharField(write_only=True, required=False, min_length=MIN_PASSWORD_LENGTH)

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "display_name", "phone",
                  "role", "role_label", "is_active", "last_login", "groups", "new_password"]
        read_only_fields = ["last_login"]

    def update(self, account, validated):
        password = validated.pop("new_password", None)
        if password:
            account.set_password(password)
        return super().update(account, validated)


class GroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ["id", "name", "permissions"]


class PermissionSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="name", read_only=True)

    class Meta:
        model = Permission
        fields = ["id", "codename", "label"]


class SignupSerializer(serializers.Serializer):
    # CharField trims surrounding spaces, so the values below arrive stripped.
    username = serializers.RegexField(USERNAME_PATTERN, error_messages=USERNAME_ERRORS)
    full_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=30)
    gender = serializers.ChoiceField(choices=Patient.Gender.choices)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    password = serializers.CharField(min_length=MIN_PASSWORD_LENGTH, write_only=True)

    def validate_username(self, username):
        return check_username_free(username)

    def validate_phone(self, phone):
        if Patient.objects.filter(phone=phone).exists():
            raise serializers.ValidationError("A patient with this phone number already exists.")
        return phone

    def validate_date_of_birth(self, born):
        return check_birth_date(born)

    def create(self, validated):
        account = create_patient_login(validated["username"], validated["password"],
                                       validated["full_name"], validated["phone"])
        return Patient.objects.create(user_account=account, full_name=validated["full_name"],
                                      phone=validated["phone"], gender=validated["gender"],
                                      date_of_birth=validated.get("date_of_birth"))


class PatientSerializer(serializers.ModelSerializer):
    gender_label = serializers.CharField(source="get_gender_display", read_only=True)
    has_account = serializers.SerializerMethodField()
    username = serializers.SerializerMethodField()
    # Reception can give a patient a login while registering them. Both fields
    # are optional because walk-in patients may not book online.
    new_username = serializers.RegexField(USERNAME_PATTERN, required=False, allow_blank=True,
                                          write_only=True, error_messages=USERNAME_ERRORS)
    new_password = serializers.CharField(required=False, allow_blank=True, write_only=True,
                                         min_length=MIN_PASSWORD_LENGTH)

    class Meta:
        model = Patient
        fields = ["id", "full_name", "phone", "gender", "gender_label", "date_of_birth",
                  "has_account", "username", "new_username", "new_password", "created_at"]

    def get_has_account(self, patient):
        return patient.user_account_id is not None

    def get_username(self, patient):
        return patient.user_account.username if patient.user_account else ""

    def validate_new_username(self, username):
        return check_username_free(username)

    def validate_date_of_birth(self, born):
        return check_birth_date(born)

    def validate(self, attrs):
        if attrs.get("new_username") and not attrs.get("new_password"):
            raise serializers.ValidationError({"new_password": "Set a password for the new login."})
        return attrs

    def create(self, validated):
        username = validated.pop("new_username", "")
        password = validated.pop("new_password", "")
        patient = Patient.objects.create(**validated)
        if username:
            self.attach_login(patient, username, password)
        return patient

    def update(self, patient, validated):
        username = validated.pop("new_username", "")
        password = validated.pop("new_password", "")
        patient = super().update(patient, validated)

        account = patient.user_account
        if account:
            account.set_full_name(patient.full_name)
            account.phone = patient.phone
            if password:
                account.set_password(password)
            account.save()
        elif username:
            self.attach_login(patient, username, password)
        return patient

    def attach_login(self, patient, username, password):
        patient.user_account = create_patient_login(username, password, patient.full_name, patient.phone)
        patient.save(update_fields=["user_account"])


class DoctorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Doctor
        fields = ["id", "full_name", "specialization", "room", "phone", "is_active"]


class SpecializationSerializer(serializers.ModelSerializer):
    doctor_count = serializers.SerializerMethodField()

    class Meta:
        model = Specialization
        fields = ["id", "name", "doctor_count"]

    def get_doctor_count(self, specialization):
        return Doctor.objects.filter(specialization=specialization.name).count()


class SlotSerializer(serializers.ModelSerializer):
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = Slot
        fields = ["id", "doctor", "date", "time", "is_blocked", "is_booked", "is_open"]
        read_only_fields = ["doctor", "is_booked"]


class AppointmentSerializer(serializers.ModelSerializer):
    # The doctor comes from the slot, and the portal sets the patient itself.
    patient = serializers.PrimaryKeyRelatedField(queryset=Patient.objects.all(), required=False)
    slot = serializers.PrimaryKeyRelatedField(queryset=Slot.objects.all())
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    patient_phone = serializers.CharField(source="patient.phone", read_only=True)
    doctor_name = serializers.CharField(source="doctor.full_name", read_only=True)
    specialization = serializers.CharField(source="doctor.specialization", read_only=True)
    date = serializers.DateField(source="slot.date", read_only=True)
    time = serializers.TimeField(source="slot.time", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    can_change = serializers.BooleanField(source="can_be_changed", read_only=True)

    class Meta:
        model = Appointment
        fields = ["id", "patient", "patient_name", "patient_phone", "doctor", "doctor_name",
                  "specialization", "slot", "date", "time", "reason", "status", "status_label",
                  "notes", "reschedule_count", "postpone_count", "transfer_count", "can_change",
                  "created_at"]
        read_only_fields = ["doctor", "status", "reschedule_count", "postpone_count", "transfer_count"]

    def validate_slot(self, slot):
        if not slot.is_open:
            raise serializers.ValidationError("That time is no longer free.")
        return slot


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    action_label = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = ActivityLog
        fields = ["id", "user_name", "action", "action_label", "description", "ip_address", "created_at"]

    def get_user_name(self, entry):
        return entry.user.display_name if entry.user else "Unknown"


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "appointment", "message", "is_read", "created_at"]