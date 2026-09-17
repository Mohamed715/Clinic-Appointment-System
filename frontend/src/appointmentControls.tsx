/*
 * appointmentControls.tsx: shared appointment tools used by the staff,
 * doctor and patient pages.
 * - bookingColumns: picks ready-made table columns (date, time, patient,
 *   doctor, reason, status).
 * - SlotPicker: chooses a day and a free time for a doctor.
 * - MoveForm: transfers a visit to another doctor, or postpones it to a
 *   later time, after a confirmation.
 * - statusButtons: Approve, Visited and Completed buttons, each confirmed first.
 * - cancelButton: a confirmed Cancel button that frees the time and
 *   notifies the patient.
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import api from "./api";
import type { AppointmentStatus, Booking, Slot } from "./types";
import {
  Alert,
  Field,
  InlineForm,
  SelectField,
  StatusTag,
  TextField,
  WAITING_STATUSES,
  doctorLabel,
  shortTime,
  stacked,
  useApi,
  useConfirm,
  type Ask,
  type Column,
  type Question,
  type RowButton,
} from "./ui";

// Columns shared by every appointment table; pick them with bookingColumns("date", "time", ...).
const BOOKING_COLUMNS = {
  date: ["Date", (booking) => booking.date, "whitespace-nowrap"],
  time: ["Time", (booking) => shortTime(booking.time), "font-medium"],
  patient: ["Patient", (booking) => booking.patient_name],
  patientAndPhone: ["Patient", (booking) => stacked(booking.patient_name, booking.patient_phone)],
  doctor: ["Doctor", (booking) => "Dr. " + booking.doctor_name],
  doctorAndSpecialization: ["Doctor", (booking) => stacked("Dr. " + booking.doctor_name, booking.specialization)],
  reason: ["Reason", (booking) => booking.reason],
  status: ["Status", (booking) => <StatusTag status={booking.status} label={booking.status_label} />],
} satisfies Record<string, Column<Booking>>;

type BookingColumnName = keyof typeof BOOKING_COLUMNS;

export const bookingColumns = (...names: BookingColumnName[]): Column<Booking>[] =>
  names.map((name) => BOOKING_COLUMNS[name]);

const PICKED_TIME = "border-blue-600 bg-blue-600 text-white";
const UNPICKED_TIME = "border-slate-200 bg-white text-slate-700 hover:border-blue-400";

interface SlotPickerProps {
  doctorId: number | string;
  loadSlots: (doctorId: number | string) => Promise<Slot[]>;
  pickedSlot: Slot | null;
  onPick: (slot: Slot | null) => void;
  // "2026-09-15 09:00:00"
  after?: string;
}

export function SlotPicker({ doctorId, loadSlots, pickedSlot, onPick, after }: SlotPickerProps) {
  const [day, setDay] = useState("");
  const { value: loadedSlots } = useApi(
    () => (doctorId ? loadSlots(doctorId) : Promise.resolve<Slot[]>([])),
    [doctorId],
  );

  const slots = (loadedSlots || []).filter((slot) => !after || `${slot.date} ${slot.time}` > after);
  const openDays = [...new Set(slots.map((slot) => slot.date))].sort();
  const timesOnDay = slots.filter((slot) => slot.date === day);

  const timeButtonClass = (slot: Slot) =>
    "rounded-lg border px-3 py-2 text-sm " + (slot.id === pickedSlot?.id ? PICKED_TIME : UNPICKED_TIME);

  function changeDay(newDay: string) {
    setDay(newDay);
    onPick(null);
  }

  const pickDay = (event: ChangeEvent<HTMLInputElement>) => changeDay(event.target.value);
  const dayRange = { min: openDays[0] || "", max: openDays[openDays.length - 1] || "" };

  // Jump to the first open day once the times arrive. This runs only on load,
  
  //makes sure the selected day always has free slots
  useEffect(() => {
    if (openDays.length > 0 && !openDays.includes(day)) changeDay(openDays[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedSlots]);

  let times;
  if (!doctorId) {
    times = <p className="text-sm text-slate-400">Pick a doctor first.</p>;
  } else if (timesOnDay.length === 0) {
    times = (
      <p className="text-sm text-slate-400">
        No free times on this day.
        {openDays.length > 0 && (
          <button type="button" className="ml-1 font-medium text-blue-600" onClick={() => changeDay(openDays[0])}>
            Go to {openDays[0]}
          </button>
        )}
      </p>
    );
  } else {
    times = (
      <div className="flex flex-wrap gap-2">
        {timesOnDay.map((slot) => (
          <button key={slot.id} type="button" onClick={() => onPick(slot)} className={timeButtonClass(slot)}>
            {shortTime(slot.time)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <TextField label="Date" type="date" value={day} disabled={!doctorId} required {...dayRange} onChange={pickDay} />
      <Field label="Free times" hint="Booked and blocked times are not shown.">
        {times}
      </Field>
    </div>
  );
}

//These two functions turn data into readable sentences
export const slotText = (slot: Slot) => `${slot.date} at ${shortTime(slot.time)}`;
const visitText = (booking: Booking) =>
  `${booking.patient_name}'s visit on ${booking.date} at ${shortTime(booking.time)} with Dr. ${booking.doctor_name}`;

export type MoveKind = "transfer" | "postpone";

function moveQuestion(kind: MoveKind, booking: Booking, slot: Slot, doctorName: string): Question {
  const newTime = slotText(slot);
  if (kind === "transfer") {
    return {
      title: "Confirm transfer",
      message:
        `Transfer ${booking.patient_name}'s visit to Dr. ${doctorName} on ${newTime}? ` +
        `The patient will be notified and Dr. ${doctorName} must approve it.`,
      yesText: "Transfer",
      noText: "Go back",
    };
  }
  return {
    title: "Confirm postponement",
    message: `Postpone ${booking.patient_name}'s visit to ${newTime} with Dr. ${doctorName}? The patient will be notified.`,
    yesText: "Postpone",
    noText: "Go back",
  };
}

interface MoveFormProps {
  kind: MoveKind;
  booking: Booking;
  onSave: (slotId: number) => void;
  onClose: () => void;
}

// kind "transfer": another doctor, any free time.
// kind "postpone": any doctor, but only times after the current one.
export function MoveForm({ kind, booking, onSave, onClose }: MoveFormProps) {
  const isTransfer = kind === "transfer";
  const [doctorId, setDoctorId] = useState(isTransfer ? "" : String(booking.doctor));
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [dialog, ask] = useConfirm();
  const { value: activeDoctors } = useApi(() => api.doctors.list({ active: "true" }));

  const doctors = (activeDoctors || []).filter((doctor) => !isTransfer || doctor.id !== booking.doctor);
  const visit = `${booking.patient_name}, ${booking.date} at ${shortTime(booking.time)}`;
  const title = isTransfer
    ? `Transfer from Dr. ${booking.doctor_name} (${visit})`
    : `Postpone ${visit} with Dr. ${booking.doctor_name}`;

  const doctorLabels = isTransfer
    ? { label: "New doctor" }
    : { label: "Doctor", hint: "Keep the same doctor or choose another one." };

  function changeDoctor(event: ChangeEvent<HTMLSelectElement>) {
    setDoctorId(event.target.value);
    setPickedSlot(null);
    if (!isTransfer) setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pickedSlot) {
      setError("Choose a new time first.");
      return;
    }
    const doctorName = doctors.find((doctor) => doctor.id === pickedSlot.doctor)?.full_name ?? "";
    if (await ask(moveQuestion(kind, booking, pickedSlot, doctorName))) onSave(pickedSlot.id);
  }

  return (
    <InlineForm title={title} onSubmit={submit} onClose={onClose}>
      {dialog}
      <Alert>{error}</Alert>
      <SelectField {...doctorLabels} value={doctorId} required onChange={changeDoctor}>
        {isTransfer && <option value="">Choose a doctor</option>}
        {doctors.map((doctor) => (
          <option key={doctor.id} value={doctor.id}>
            {doctorLabel(doctor) + (!isTransfer && doctor.id === booking.doctor ? " - current" : "")}
          </option>
        ))}
      </SelectField>
      <SlotPicker
        key={doctorId}
        doctorId={doctorId}
        loadSlots={api.openSlots}
        pickedSlot={pickedSlot}
        onPick={setPickedSlot}
        after={isTransfer ? undefined : `${booking.date} ${booking.time}`}
      />
    </InlineForm>
  );
}

interface StatusAction {
  status: AppointmentStatus;
  label: string;
  doneText: string;
  question: (booking: Booking) => Question;
}

const STATUS_ACTIONS: StatusAction[] = [
  {
    status: "APPROVED",
    label: "Approve",
    doneText: "Appointment approved.",
    question: (booking) => ({
      title: "Approve appointment",
      message: `Approve ${visitText(booking)}? The patient will be notified.`,
      yesText: "Approve",
      noText: "Go back",
    }),
  },
  {
    status: "VISITED",
    label: "Visited",
    doneText: "Marked as visited.",
    question: (booking) => ({
      title: "Mark as visited",
      message: `Confirm that ${booking.patient_name} has arrived for the visit on ${booking.date} at ${shortTime(booking.time)}.`,
      yesText: "Mark visited",
      noText: "Go back",
    }),
  },
  {
    status: "COMPLETED",
    label: "Completed",
    doneText: "Marked as completed.",
    question: (booking) => ({
      title: "Mark as completed",
      message: `Confirm that ${visitText(booking)} is finished. A completed visit cannot be changed.`,
      yesText: "Mark completed",
      noText: "Go back",
    }),
  },
];

// Doctors may complete an approved visit directly; the desk marks it visited first.
function allowedNextStatuses(current: AppointmentStatus, canCompleteApproved: boolean): AppointmentStatus[] {
  // Declining a visit is done with Cancel, which also tells the patient.
  if (WAITING_STATUSES.includes(current)) return ["APPROVED"];
  if (current === "APPROVED") return canCompleteApproved ? ["VISITED", "COMPLETED"] : ["VISITED"];
  if (current === "VISITED") return ["COMPLETED"];
  return [];
}

export type ChangeStatus = (status: AppointmentStatus, doneText: string) => void;

// Button specs for actionsColumn; each asks for confirmation before changing the status.
export function statusButtons(
  booking: Booking,
  changeStatus: ChangeStatus,
  ask: Ask,
  canCompleteApproved = false,
): RowButton[] {
  const allowed = allowedNextStatuses(booking.status, canCompleteApproved);
  return STATUS_ACTIONS.filter(({ status }) => allowed.includes(status)).map(
    ({ status, label, doneText, question }) => ({
      label,
      onClick: async () => {
        if (await ask(question(booking))) changeStatus(status, doneText);
      },
    }),
  );
}

// The Cancel row button for staff and doctors.
export function cancelButton(booking: Booking, ask: Ask, sendCancel: () => void): RowButton {
  const confirmAndCancel = async () => {
    const confirmed = await ask({
      title: "Cancel appointment",
      message: `Cancel ${visitText(booking)}? The time will be freed and the patient notified.`,
      yesText: "Cancel visit",
      noText: "Keep it",
      danger: true,
    });
    if (confirmed) sendCancel();
  };
  return { label: "Cancel", tone: "danger", onClick: confirmAndCancel, hidden: !booking.can_change };
}