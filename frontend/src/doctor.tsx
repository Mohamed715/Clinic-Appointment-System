/*
 * doctor.tsx: the pages for signed-in doctors.
 * - My schedule: open a working day of time slots, and block or unblock
 *   free times.
 * - Appointments: approve, mark visited or completed, transfer or cancel
 *   their own bookings.
 * - Reports: totals by status and a list of their patients.
 * Each button and form is hidden when its permission is unticked.
 */

import { useState, type FormEvent } from "react";
import api from "./api";
import { MoveForm, bookingColumns, cancelButton, statusButtons, type ChangeStatus } from "./appointmentControls";
import type { Booking, Slot, User } from "./types";
import {
  Alert,
  Button,
  Card,
  DataTable,
  Input,
  Loading,
  Options,
  ResultAlert,
  STATUSES,
  Select,
  SelectField,
  StatCard,
  TextField,
  actionsColumn,
  bindField,
  may,
  shortTime,
  todayLocal,
  useApi,
  useConfirm,
  useReload,
  useSaving,
  type Column,
  type RowButton,
} from "./ui";

const SLOT_STYLES = {
  booked: "border-blue-200 bg-blue-50 text-blue-700",
  blocked: "border-slate-200 bg-slate-100 text-slate-400 line-through",
  free: "border-slate-200 bg-white text-slate-700",
};

function slotState(slot: Slot): keyof typeof SLOT_STYLES {
  if (slot.is_booked) return "booked";
  if (slot.is_blocked) return "blocked";
  return "free";
}

function SlotChip({ slot, canToggle, onToggleBlock }: { slot: Slot; canToggle: boolean; onToggleBlock: () => void }) {
  const state = slotState(slot);
  return (
    <div className={"rounded-lg border px-3 py-2 text-sm " + SLOT_STYLES[state]}>
      <span className="font-medium">{shortTime(slot.time)}</span>
      <span className="ml-2 text-xs">{state}</span>
      {canToggle && !slot.is_booked && (
        <button className="ml-3 text-xs font-medium text-blue-600" onClick={onToggleBlock}>
          {slot.is_blocked ? "unblock" : "block"}
        </button>
      )}
    </div>
  );
}

export function DoctorSchedule({ user }: { user: User }) {
  const today = todayLocal();
  const [day, setDay] = useState(today);
  const [workDay, setWorkDay] = useState({ date: today, start: "09:00", end: "15:00", minutes: 30 });
  const [reload, refresh] = useReload();
  const note = useSaving(refresh);
  const { value: slots, error } = useApi(() => api.mySlots({ date: day }), [day, reload]);
  const field = bindField(workDay, setWorkDay);
  const canAdd = may(user, "clinic.add_slot");
  const canToggle = may(user, "clinic.change_slot");

  // Not run() here: the day must change before the refresh so only the new day is fetched.
  function addTimes(event: FormEvent) {
    event.preventDefault();
    api
      .generateSlots(workDay)
      .then(({ added }) => {
        setDay(workDay.date);
        note.showSuccess(added + " new times added.");
        refresh();
      })
      .catch((requestError: Error) => note.showError(requestError.message));
  }

  const toggleBlock = (slot: Slot) => note.run(api.toggleBlock(slot.id));

  return (
    <div>
      {canAdd && (
      <Card title="Open a working day" subtitle="Times are created between the hours you choose">
        <Alert tone={note.tone}>{note.message}</Alert>
        <form onSubmit={addTimes} className="grid gap-4 sm:grid-cols-4">
          <TextField label="Date" type="date" min={today} required {...field("date")} />
          <TextField label="From" type="time" required {...field("start")} />
          <TextField label="To" type="time" required {...field("end")} />
          <SelectField label="Every" {...field("minutes", Number)}>
            {[15, 30, 60].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </SelectField>
          <div className="sm:col-span-4">
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>
      )}

      <Card
        title="Times on this day"
        subtitle="A blocked time does not show on the patient booking screen"
        action={<Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />}
      >
        <Alert>{error}</Alert>
        {!slots?.length && <p className="py-6 text-sm text-slate-400">No times on this day yet.</p>}
        <div className="flex flex-wrap gap-2">
          {slots?.map((slot) => (
            <SlotChip key={slot.id} slot={slot} canToggle={canToggle} onToggleBlock={() => toggleBlock(slot)} />
          ))}
        </div>
      </Card>
    </div>
  );
}

const APPOINTMENT_COLUMNS = bookingColumns("date", "time", "patientAndPhone", "reason", "status");

function statusPermission(label: string) {
  const text = label.toLowerCase();
  if (text.startsWith("approve")) return "clinic.approve_appointment";
  if (text.startsWith("reject")) return "clinic.reject_appointment";
  return "clinic.change_appointment";
}

export function DoctorAppointments({ user }: { user: User }) {
  const [status, setStatus] = useState("");
  const [reload, refresh] = useReload();
  const [transferring, setTransferring] = useState<Booking | null>(null);
  const [dialog, ask] = useConfirm();
  const { message, tone, run, clear } = useSaving(refresh);
  const { value: bookings, error } = useApi(() => api.myAppointments({ status }), [status, reload]);
  const canTransfer = may(user, "clinic.transfer_appointment");
  const canCancel = may(user, "clinic.cancel_appointment");

  function openTransfer(booking: Booking) {
    clear();
    setTransferring(booking);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveTransfer(slotId: number) {
    if (!transferring) return;
    run(api.myTransfer(transferring.id, slotId), "Appointment transferred.").then((saved) => {
      if (saved) setTransferring(null);
    });
  }

  const changeStatus =
    (booking: Booking): ChangeStatus =>
    (newStatus, doneText) =>
      run(api.mySetStatus(booking.id, newStatus), doneText);
  const cancel = (booking: Booking) => run(api.myCancel(booking.id), "Appointment cancelled.");
  const buttons = (booking: Booking): RowButton[] => [
    ...statusButtons(booking, changeStatus(booking), ask, true).filter((button) =>
      may(user, statusPermission(button.label)),
    ),
    { label: "Transfer", onClick: () => openTransfer(booking), hidden: !canTransfer || !booking.can_change },
    ...(canCancel ? [cancelButton(booking, ask, () => cancel(booking))] : []),
  ];

  return (
    <Card
      title="My appointments"
      subtitle="Approve, transfer, cancel, or mark a patient as visited"
      action={
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <Options choices={STATUSES} blank="All statuses" />
        </Select>
      }
    >
      {dialog}
      <ResultAlert loadError={error} message={message} tone={tone} />
      {transferring && canTransfer && (
        <MoveForm kind="transfer" booking={transferring} onSave={saveTransfer} onClose={() => setTransferring(null)} />
      )}
      <DataTable columns={[...APPOINTMENT_COLUMNS, actionsColumn(buttons)]} rows={bookings} />
    </Card>
  );
}

const REPORT_COLUMNS: Column<Booking>[] = [
  ...bookingColumns("date", "time", "patient", "reason", "status"),
  ["Reschedules", (booking) => booking.reschedule_count],
];

export function DoctorReport() {
  const { value: report, error } = useApi(api.myReport);
  if (error) return <Alert>{error}</Alert>;
  if (!report) return <Loading />;

  const { totals } = report;
  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Waiting" value={totals.booked + totals.postponed + totals.transferred} colour="navy" />
        <StatCard label="Approved" value={totals.approved} colour="sky" />
        <StatCard label="Visited" value={totals.visited} />
        <StatCard label="Completed" value={totals.completed} />
        <StatCard label="Cancelled" value={totals.cancelled} colour="grey" />
        <StatCard label="Transferred to me" value={report.transfers} colour="sky" />
      </div>
      <Card title="My patients" subtitle="Only the people booked with me">
        <DataTable columns={REPORT_COLUMNS} rows={report.rows} />
      </Card>
    </div>
  );
}