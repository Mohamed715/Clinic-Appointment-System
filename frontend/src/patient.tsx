/*
 * patient.tsx: the pages for signed-in patients. Book appointments, view,
 * reschedule or cancel their own visits, and read notifications. Buttons
 * are hidden when their permission is unticked.
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import api from "./api";
import { SlotPicker, bookingColumns, slotText } from "./appointmentControls";
import type { Booking, Notification, Slot, User } from "./types";
import {
  Alert,
  Button,
  Card,
  DataTable,
  DetailList,
  ResultAlert,
  SaveAndClose,
  SelectField,
  StatusTag,
  TextField,
  actionsColumn,
  doctorLabel,
  formatDateTime,
  may,
  shortTime,
  useApi,
  useConfirm,
  useReload,
  useSaving,
  type RowButton,
} from "./ui";

function goToMyAppointments() {
  window.location.hash = "#/appointments";
}

function BookingConfirmation({ booking, onBookAnother }: { booking: Booking; onBookAnother: () => void }) {
  const status = <StatusTag status={booking.status} label={booking.status_label} />;
  return (
    <Card title="Appointment booked" subtitle="You will get a notification when the doctor approves it">
      <Alert tone="ok">You have successfully booked your appointment.</Alert>
      <div className="mb-6 max-w-lg">
        <DetailList
          items={[
            ["Doctor", `Dr. ${booking.doctor_name} (${booking.specialization})`],
            ["Date", booking.date],
            ["Time", shortTime(booking.time)],
            ["Reason", booking.reason],
            ["Status", status],
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onBookAnother}>Book another appointment</Button>
        <Button tone="light" onClick={goToMyAppointments}>
          View my appointments
        </Button>
      </div>
    </Card>
  );
}

export function PatientBooking({ user }: { user: User }) {
  const [doctorId, setDoctorId] = useState("");
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState<Booking | null>(null);
  const [dialog, ask] = useConfirm();
  const note = useSaving(() => {});
  const { value: doctors } = useApi(api.portalDoctors);
  const canBook = may(user, "clinic.book_appointment");

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!canBook) return;
    if (!pickedSlot) {
      note.showError("Choose a time first.");
      return;
    }
    const doctor = doctors?.find(({ id }) => id === pickedSlot.doctor);
    const confirmed = await ask({
      title: "Confirm booking",
      message: `Book a visit with Dr. ${doctor?.full_name} on ${slotText(pickedSlot)}?`,
      yesText: "Book",
      noText: "Go back",
    });
    if (!confirmed) return;

    setSubmitting(true);
    const request = api.book({ slot: pickedSlot.id, reason }).then(setBookedAppointment);
    note.run(request).then(() => setSubmitting(false));
  }

  function startNewBooking() {
    setDoctorId("");
    setPickedSlot(null);
    setReason("");
    note.clear();
    setBookedAppointment(null);
  }

  function changeDoctor(event: ChangeEvent<HTMLSelectElement>) {
    setDoctorId(event.target.value);
    setPickedSlot(null);
  }

  if (bookedAppointment) {
    return <BookingConfirmation booking={bookedAppointment} onBookAnother={startNewBooking} />;
  }

  return (
    <Card title="Book an appointment" subtitle="Pick a doctor, a day, then a free time">
      {dialog}
      <Alert tone={note.tone}>{note.message}</Alert>
      <form onSubmit={book} className="max-w-lg">
        <SelectField label="Doctor" value={doctorId} required onChange={changeDoctor}>
          <option value="">Choose a doctor</option>
          {doctors?.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctorLabel(doctor)}
            </option>
          ))}
        </SelectField>
        <SlotPicker
          key={doctorId}
          doctorId={doctorId}
          loadSlots={api.portalSlots}
          pickedSlot={pickedSlot}
          onPick={setPickedSlot}
        />
        <TextField
          label="Reason for the visit"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          required
        />
        {canBook ? (
          <Button type="submit" disabled={submitting}>
            {submitting ? "Booking..." : "Book"}
          </Button>
        ) : (
          <Alert>You can see the available times, but booking is switched off for your account.</Alert>
        )}
      </form>
    </Card>
  );
}

const BOOKING_TABLE_COLUMNS = bookingColumns("date", "time", "doctorAndSpecialization", "reason", "status");

export function PatientAppointments({ user }: { user: User }) {
  const [reload, refresh] = useReload();
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  const [dialog, ask] = useConfirm();
  const { message, tone, run, clear } = useSaving(refresh);
  const { value: bookings, error } = useApi(api.myBookings, [reload]);
  const canReschedule = may(user, "clinic.reschedule_appointment");
  const canCancel = may(user, "clinic.cancel_appointment");

  async function cancelBooking(booking: Booking) {
    const confirmed = await ask({
      title: "Cancel appointment",
      message: `Do you want to cancel your visit with Dr. ${booking.doctor_name} on ${booking.date}?`,
      yesText: "Cancel visit",
      noText: "Keep it",
      danger: true,
    });
    if (confirmed) run(api.cancelBooking(booking.id), "Appointment cancelled.");
  }

  function openReschedule(booking: Booking) {
    clear();
    setPickedSlot(null);
    setRescheduling(booking);
  }

  async function saveReschedule(event: FormEvent) {
    event.preventDefault();
    if (!pickedSlot || !rescheduling) return;
    const confirmed = await ask({
      title: "Confirm new time",
      message: `Move your visit with Dr. ${rescheduling.doctor_name} to ${slotText(pickedSlot)}?`,
      yesText: "Move visit",
      noText: "Go back",
    });
    if (!confirmed) return;
    const saved = await run(api.rescheduleBooking(rescheduling.id, pickedSlot.id), "Appointment moved.");
    if (saved) setRescheduling(null);
  }

  const buttons = (booking: Booking): RowButton[] => [
    {
      label: "Reschedule",
      onClick: () => openReschedule(booking),
      hidden: !canReschedule || !booking.can_change,
    },
    {
      label: "Cancel",
      tone: "danger",
      onClick: () => cancelBooking(booking),
      hidden: !canCancel || !booking.can_change,
    },
  ];

  return (
    <div>
      {dialog}
      <Card title="My appointments" subtitle="Cancel or move a visit that has not happened yet">
        <ResultAlert loadError={error} message={message} tone={tone} />
        <DataTable columns={[...BOOKING_TABLE_COLUMNS, actionsColumn(buttons)]} rows={bookings} />
      </Card>

      {rescheduling && canReschedule && (
        <Card
          title={"New time with Dr. " + rescheduling.doctor_name}
          subtitle={`Currently ${rescheduling.date} at ${shortTime(rescheduling.time)}`}
        >
          <form onSubmit={saveReschedule} className="max-w-lg">
            <SlotPicker
              doctorId={rescheduling.doctor}
              loadSlots={api.portalSlots}
              pickedSlot={pickedSlot}
              onPick={setPickedSlot}
            />
            <SaveAndClose onClose={() => setRescheduling(null)} saveDisabled={!pickedSlot} />
          </form>
        </Card>
      )}
    </div>
  );
}

function NotificationItem({ notification }: { notification: Notification }) {
  const { is_read: isRead } = notification;
  return (
    <li className="flex gap-3 py-3.5">
      <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (isRead ? "bg-slate-200" : "bg-blue-600")} />
      <div>
        <p className={"text-sm " + (isRead ? "text-slate-600" : "font-medium text-slate-800")}>
          {notification.message}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(notification.created_at)}</p>
      </div>
    </li>
  );
}

// Opening this page marks every notification as read.
export function PatientNotifications({ onRead }: { onRead: () => void }) {
  const { value: notifications, error } = useApi(api.notifications);

  useEffect(() => {
    if (!notifications || notifications.every((notification) => notification.is_read)) return;
    api.markNotificationsRead().then(() => onRead());
  }, [notifications, onRead]);

  return (
    <Card title="Notifications" subtitle="Updates about your appointments">
      <Alert>{error}</Alert>
      {notifications?.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-400">You have no notifications yet.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {notifications?.map((notification) => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </ul>
    </Card>
  );
}