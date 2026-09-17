# appointment_actions.py: the appointment actions shared by the staff,
# doctor and patient endpoints. It approves, rejects, marks visited or
# completed, reschedules, postpones, transfers and cancels visits.
# Each action checks the visit can still change, frees or reserves the
# time slot, notifies the patient, writes the activity log and returns
# the response.

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from .models import ActivityLog, Appointment, Notification, Slot, log_activity

Status = Appointment.Status

# The statuses a visit must be in before it can move to the key status.
ALLOWED_PREVIOUS_STATUS = {
    Status.APPROVED: Appointment.WAITING,
    Status.REJECTED: Appointment.WAITING,
    Status.VISITED: [Status.APPROVED],
    Status.COMPLETED: [Status.APPROVED, Status.VISITED],
}


def bad_request(field, text):
    return Response({field: text}, status=status.HTTP_400_BAD_REQUEST)


def free_slots(doctor_id):
    return Slot.objects.filter(doctor_id=doctor_id, date__gte=timezone.localdate(), is_blocked=False, is_booked=False)


def release_slot(booking):
    Slot.objects.filter(pk=booking.slot_id).update(is_booked=False)


def reserve_slot(slot):
    Slot.objects.filter(pk=slot.pk).update(is_booked=True)


def format_slot_time(slot):
    return f"{slot.date} at {slot.time:%H:%M}"


def notify_patient(booking, message):
    Notification.objects.create(patient=booking.patient, appointment=booking, message=message[:255])


def status_change_message(booking):
    doctor_name = f"Dr. {booking.doctor.full_name}"
    visit_time = format_slot_time(booking.slot)
    return {
        Status.APPROVED: f"Your visit with {doctor_name} on {visit_time} was approved.",
        Status.REJECTED: f"Your visit with {doctor_name} on {visit_time} was rejected.",
        Status.VISITED: f"You were checked in for your visit with {doctor_name}.",
        Status.COMPLETED: f"Your visit with {doctor_name} is completed.",
    }[booking.status]


def change_status(request, booking, new_status, serialize):
    """Approve or reject a waiting visit, or mark an approved one as visited
    or completed."""
    if new_status not in ALLOWED_PREVIOUS_STATUS:
        return bad_request("detail", "Choose approved, rejected, visited or completed.")
    if booking.status not in ALLOWED_PREVIOUS_STATUS[new_status]:
        return bad_request("detail", f"A visit that is {booking.get_status_display().lower()} "
                                     f"cannot be set to {Status(new_status).label.lower()}.")

    booking.status = new_status
    booking.notes = request.data.get("notes", booking.notes)
    booking.save(update_fields=["status", "notes", "updated_at"])
    if new_status == Status.REJECTED:
        release_slot(booking)

    notify_patient(booking, status_change_message(booking))
    log_activity(request, ActivityLog.Action.UPDATE, f"Appointment {booking.id} set to {booking.get_status_display()}")
    return Response(serialize(booking).data)


def requested_slot(request, booking):
    """Return (slot, None) when the requested slot can take the visit, or
    (None, error_response) when it cannot."""
    if not booking.can_be_changed:
        return None, bad_request("detail", "This appointment can no longer be changed.")

    slot = Slot.objects.select_related("doctor").filter(pk=request.data.get("slot")).first()
    if slot is None or not slot.is_open:
        return None, bad_request("slot", "That time is no longer free.")
    return slot, None


def move_to_slot(booking, slot, new_status, counter_field):
    release_slot(booking)
    booking.slot = slot
    booking.doctor = slot.doctor
    booking.status = new_status
    setattr(booking, counter_field, getattr(booking, counter_field) + 1)
    booking.save(update_fields=["slot", "doctor", "status", counter_field, "updated_at"])
    reserve_slot(slot)


def reschedule(request, booking, serialize):
    """The patient picks another free time with the same doctor."""
    slot, error = requested_slot(request, booking)
    if error:
        return error
    if slot.doctor_id != booking.doctor_id:
        return bad_request("slot", "Pick a time from the same doctor.")

    move_to_slot(booking, slot, Status.BOOKED, "reschedule_count")
    log_activity(request, ActivityLog.Action.UPDATE, f"Appointment {booking.id} moved to {format_slot_time(slot)}")
    return Response(serialize(booking).data)


def postpone(request, booking, serialize):
    """Move the visit to a later time, with the same doctor or another one."""
    old_slot = booking.slot
    old_doctor = booking.doctor
    slot, error = requested_slot(request, booking)
    if error:
        return error
    if not slot.doctor.is_active:
        return bad_request("slot", "That doctor is not taking patients.")
    if (slot.date, slot.time) <= (old_slot.date, old_slot.time):
        return bad_request("slot", "Pick a time later than the current one.")

    move_to_slot(booking, slot, Status.POSTPONED, "postpone_count")

    old_time, new_time = format_slot_time(old_slot), format_slot_time(slot)
    if slot.doctor_id == old_doctor.id:
        message = f"Your visit with Dr. {old_doctor.full_name} was postponed from {old_time} to {new_time}."
        details = f"Appointment {booking.id} postponed to {new_time}"
    else:
        message = (f"Your visit with Dr. {old_doctor.full_name} on {old_time} was postponed "
                   f"to {new_time} with Dr. {slot.doctor.full_name}.")
        details = f"Appointment {booking.id} postponed to {new_time} with {slot.doctor}"

    notify_patient(booking, message)
    log_activity(request, ActivityLog.Action.UPDATE, details)
    return Response(serialize(booking).data)


def transfer(request, booking, serialize):
    """Give the visit to another doctor, who then has to approve it."""
    old_doctor = booking.doctor
    slot, error = requested_slot(request, booking)
    if error:
        return error
    if slot.doctor_id == booking.doctor_id:
        return bad_request("slot", "Pick a time from a different doctor.")
    if not slot.doctor.is_active:
        return bad_request("slot", "That doctor is not taking patients.")

    move_to_slot(booking, slot, Status.TRANSFERRED, "transfer_count")
    notify_patient(booking, f"Your visit was transferred from Dr. {old_doctor.full_name} "
                            f"to Dr. {slot.doctor.full_name} on {format_slot_time(slot)}.")
    log_activity(request, ActivityLog.Action.UPDATE,
                 f"Appointment {booking.id} transferred from {old_doctor} to {slot.doctor}")
    return Response(serialize(booking).data)


def cancel(request, booking, serialize, by_patient):
    if not booking.can_be_changed:
        return bad_request("detail", "This appointment can no longer be cancelled.")

    booking.status = Status.CANCELLED
    booking.save(update_fields=["status", "updated_at"])
    release_slot(booking)
    if not by_patient:
        notify_patient(booking, f"Your visit with Dr. {booking.doctor.full_name} on "
                                f"{format_slot_time(booking.slot)} was cancelled by the clinic.")
    log_activity(request, ActivityLog.Action.UPDATE, f"Appointment {booking.id} cancelled")
    return Response(serialize(booking).data)