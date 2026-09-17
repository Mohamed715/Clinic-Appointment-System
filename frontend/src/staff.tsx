/*
 * staff.tsx: the pages for the Clinic Manager and Receptionist.
 * - Overview: today's numbers, a six-month bookings chart and today's schedule.
 * - Appointments: search and filter bookings; approve, postpone, transfer,
 *   cancel or delete them.
 * - Patients: register, edit and delete patients, with optional online accounts.
 * - Doctors: add, edit, turn on or off and delete doctors, plus the
 *   specialization list.
 * - Reports: clinic totals, and patient and doctor reports.
 * - Users: view, edit and delete accounts. View, Edit and Register Staff
 *   open in dialogs; Register Staff creates Clinic Manager or Receptionist
 *   accounts.
 * - Permissions: tick boxes that set what each role may do.
 * - System Logs: activity, errors and the audit trail with old and new values.
 * Every button, form and section is hidden when its permission is unticked,
 * and deletes ask for confirmation first.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import api, { type AuditLogEntry } from "./api";
import {
  MoveForm,
  bookingColumns,
  cancelButton,
  statusButtons,
  type ChangeStatus,
  type MoveKind,
} from "./appointmentControls";
import type {
  Account,
  ActivityLogEntry,
  Booking,
  ClinicReport,
  Doctor,
  DoctorReportRow,
  Patient,
  PatientReportRow,
  Permission,
  PermissionGroup,
  Role,
  Specialization,
  User,
} from "./types";
import {
  Alert,
  BarChart,
  Button,
  Card,
  DataTable,
  DetailList,
  FilterBar,
  GenderAndBirthDate,
  InlineForm,
  Input,
  Loading,
  NewPasswordField,
  Options,
  ResultAlert,
  STATUSES,
  SaveAndClose,
  Select,
  SelectField,
  StatCard,
  TextField,
  TwoColumns,
  actionsColumn,
  askDelete,
  bindField,
  formatDateTime,
  may,
  shortTime,
  stacked,
  useApi,
  useConfirm,
  useReload,
  useSaving,
  withoutBlank,
  type Column,
  type RowButton,
} from "./ui";

const ROLES: Record<Role, string> = {
  MANAGER: "Clinic Manager",
  RECEPTIONIST: "Receptionist",
  DOCTOR: "Doctor",
  PATIENT: "Patient",
};

const STAFF_ROLES: Record<string, string> = {
  MANAGER: ROLES.MANAGER,
  RECEPTIONIST: ROLES.RECEPTIONIST,
};

const MOVE_ACTIONS: Record<MoveKind, { send: (id: number, slotId: number) => Promise<Booking>; doneText: string }> = {
  transfer: { send: api.transfer, doneText: "Appointment transferred." },
  postpone: { send: api.postpone, doneText: "Appointment postponed." },
};

const CASCADE_WARNING = "Their appointments will be deleted too.";

const column = <Row,>(heading: string, key: keyof Row, className?: string): Column<Row> => [
  heading,
  (row) => row[key] as ReactNode,
  className,
];

interface UserProps {
  user: User;
}

function useRecordEditor<Form extends object>(afterSave: () => void) {
  const [form, setForm] = useState<Form | null>(null);
  const [dialog, ask] = useConfirm();
  const { message, tone, run, clear } = useSaving(afterSave);

  function open(values: Form) {
    setForm(values);
    clear();
  }

  function save(request: Promise<unknown>, doneText: string) {
    run(request, doneText).then((saved) => {
      if (saved) setForm(null);
    });
  }

  async function confirmDelete(name: string, sendDelete: () => Promise<unknown>, doneText: string, warning?: string) {
    if (await askDelete(ask, name, warning)) run(sendDelete(), doneText);
  }

  const field = bindField(form ?? ({} as Form), setForm);
  const close = () => setForm(null);
  return { form, setForm, field, close, open, save, confirmDelete, run, dialog, message, tone };
}

const TODAY_COLUMNS = bookingColumns("time", "patient", "doctor", "reason", "status");
const APPOINTMENT_COLUMNS = bookingColumns("date", "time", "patientAndPhone", "doctor", "reason", "status");

export function StaffDashboard() {
  const { value: stats, error } = useApi(api.dashboard);
  if (error) return <Alert>{error}</Alert>;
  if (!stats) return <Loading />;

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Appointments today" value={stats.appointments_today} />
        <StatCard label="Waiting for approval" value={stats.waiting} colour="navy" />
        <StatCard label="Registered patients" value={stats.patients_total} colour="sky" />
        <StatCard label="Doctors available" value={stats.doctors_active} colour="grey" />
        <StatCard label="Transfers made" value={stats.transfers_total} colour="sky" />
      </div>
      <Card title="Bookings" subtitle="Last six months">
        <BarChart points={stats.trend} />
      </Card>
      <Card title="Today's schedule">
        <DataTable columns={TODAY_COLUMNS} rows={stats.today} empty="Nothing booked for today." />
      </Card>
    </div>
  );
}

export function StaffAppointments({ user }: UserProps) {
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [reload, refresh] = useReload();
  const [move, setMove] = useState<{ booking: Booking; kind: MoveKind } | null>(null);
  const [dialog, ask] = useConfirm();
  const { message, tone, run, clear } = useSaving(refresh);
  const { value: bookings, error } = useApi(() => api.appointments(filters), [filters, reload]);
  const filter = bindField(filters, setFilters);

  function openMoveForm(booking: Booking, kind: MoveKind) {
    clear();
    setMove({ booking, kind });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveMove(slotId: number) {
    if (!move) return;
    const { send, doneText } = MOVE_ACTIONS[move.kind];
    run(send(move.booking.id, slotId), doneText).then((saved) => {
      if (saved) setMove(null);
    });
  }

  const changeStatus =
    (booking: Booking): ChangeStatus =>
    (status, doneText) =>
      run(api.setStatus(booking.id, status), doneText);
  const cancel = (booking: Booking) => run(api.cancelAppointment(booking.id), "Appointment cancelled.");
  const deleteBooking = async (booking: Booking) => {
    const name = `${booking.patient_name}'s appointment on ${booking.date} at ${shortTime(booking.time)}`;
    if (await askDelete(ask, name, "This cannot be undone.")) {
      run(api.deleteAppointment(booking.id), "Appointment deleted.");
    }
  };
  const canChange = may(user, "clinic.change_appointment");
  const canApprove = may(user, "clinic.approve_appointment");
  const canReject = may(user, "clinic.reject_appointment");
  const canPostpone = may(user, "clinic.postpone_appointment");
  const canTransfer = may(user, "clinic.transfer_appointment");
  const canCancel = may(user, "clinic.cancel_appointment");
  const canDelete = may(user, "clinic.delete_appointment");
  const canMove: Record<MoveKind, boolean> = { postpone: canPostpone, transfer: canTransfer };

  const statusAllowed = (button: RowButton) => {
    const label = button.label.toLowerCase();
    if (label.startsWith("approve")) return canApprove;
    if (label.startsWith("reject")) return canReject;
    return canChange;
  };

  const buttons = (booking: Booking): RowButton[] => [
    ...statusButtons(booking, changeStatus(booking), ask).filter(statusAllowed),
    { label: "Postpone", onClick: () => openMoveForm(booking, "postpone"), hidden: !canPostpone || !booking.can_change },
    { label: "Transfer", onClick: () => openMoveForm(booking, "transfer"), hidden: !canTransfer || !booking.can_change },
    ...(canCancel ? [cancelButton(booking, ask, () => cancel(booking))] : []),
    { label: "Delete", tone: "danger", onClick: () => deleteBooking(booking), hidden: !canDelete },
  ];

  return (
    <Card
      title="All appointments"
      subtitle="Approve, postpone, transfer or cancel a booking"
      action={
        <FilterBar filter={filter} search="Search patient" select="status" choices={STATUSES} blank="All statuses" />
      }
    >
      {dialog}
      <ResultAlert loadError={error} message={message} tone={tone} />
      {move && canMove[move.kind] && (
        <MoveForm
          key={move.kind}
          kind={move.kind}
          booking={move.booking}
          onSave={saveMove}
          onClose={() => setMove(null)}
        />
      )}
      <DataTable columns={[...APPOINTMENT_COLUMNS, actionsColumn(buttons)]} rows={bookings} />
    </Card>
  );
}

const PATIENT_COLUMNS: Column<Patient>[] = [
  column("Name", "full_name", "font-medium"),
  column("Phone", "phone"),
  column("Gender", "gender_label"),
  ["Username", (patient) => patient.username || "No account"],
  ["Registered", (patient) => patient.created_at.slice(0, 10)],
];

type PatientForm = Partial<Omit<Patient, "gender">> & {
  full_name: string;
  phone: string;
  gender: string;
  date_of_birth: string | null;
  new_username: string;
  new_password: string;
};

export function StaffPatients({ user }: UserProps) {
  const [filters, setFilters] = useState({ search: "" });
  const [reload, refresh] = useReload();
  const editor = useRecordEditor<PatientForm>(refresh);
  const { form, field } = editor;
  const { value: patients, error } = useApi(() => api.patients.list(filters), [filters, reload]);

  function openForm(patient: Patient | null) {
    const blankPatient = { full_name: "", phone: "", gender: "", date_of_birth: "" };
    editor.open({ ...blankPatient, ...patient, new_username: "", new_password: "" });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const body = withoutBlank({ ...form, date_of_birth: form.date_of_birth || null }, "new_username", "new_password");
    editor.save(api.patients.save(form.id, body), "Patient saved.");
  }

  const deletePatient = ({ id, full_name }: Patient) =>
    editor.confirmDelete(full_name, () => api.patients.remove(id), "Patient deleted.", CASCADE_WARNING);

  const canAdd = may(user, "clinic.add_patient");
  const canEdit = may(user, "clinic.change_patient");
  const canDelete = may(user, "clinic.delete_patient");
  const buttons = (patient: Patient): RowButton[] => [
    { label: "Edit", onClick: () => openForm(patient), hidden: !canEdit },
    { label: "Delete", tone: "danger", onClick: () => deletePatient(patient), hidden: !canDelete },
  ];

  return (
    <Card
      title="Patients"
      subtitle="Everyone registered at the clinic"
      action={
        <div className="flex gap-2">
          <Input placeholder="Search name or phone" {...bindField(filters, setFilters)("search")} />
          {canAdd && <Button onClick={() => openForm(null)}>Register</Button>}
        </div>
      }
    >
      {editor.dialog}
      <ResultAlert loadError={error} message={editor.message} tone={editor.tone} />
      {form && (form.id ? canEdit : canAdd) && (
        <InlineForm
          title={form.id ? "Edit " + form.full_name : "Register a patient"}
          onSubmit={save}
          onClose={editor.close}
        >
          <TextField label="Full name" {...field("full_name")} required />
          <TextField label="Phone number" {...field("phone")} required />
          <GenderAndBirthDate field={field} />
          {form.username ? (
            <TextField
              label="Username"
              hint="Leave the password empty to keep the current one."
              value={form.username}
              disabled
            />
          ) : (
            <TextField
              label="Username"
              hint="Optional. 3 to 12 letters, for booking online."
              maxLength={12}
              {...field("new_username", (text) => text.replace(/[^A-Za-z]/g, ""))}
            />
          )}
          <NewPasswordField label={form.username ? "New password" : "Password"} {...field("new_password")} />
        </InlineForm>
      )}
      <DataTable columns={[...PATIENT_COLUMNS, actionsColumn(buttons)]} rows={patients} />
    </Card>
  );
}

const DOCTOR_COLUMNS: Column<Doctor>[] = [
  ["Name", (doctor) => "Dr. " + doctor.full_name, "font-medium"],
  column("Specialization", "specialization"),
  ["Room", (doctor) => doctor.room || "-"],
  ["Phone", (doctor) => doctor.phone || "-"],
  ["Available", (doctor) => (doctor.is_active ? "Yes" : "No")],
];

type DoctorForm = Partial<Doctor> & Pick<Doctor, "full_name" | "specialization" | "room" | "phone">;

interface ListProps extends UserProps {
  reload: number;
  onChanged: () => void;
}

function StaffDoctors({ user, reload, onChanged }: ListProps) {
  const editor = useRecordEditor<DoctorForm>(onChanged);
  const { form, field } = editor;
  const { value: doctors, error } = useApi(() => api.doctors.list(), [reload]);
  const { value: specializations } = useApi(() => api.specializations.list(), [reload]);
  const canAdd = may(user, "clinic.add_doctor");
  const canEdit = may(user, "clinic.change_doctor");
  const specializationNames = (specializations || []).map(({ name }) => name);
  const listedNames =
    form?.specialization && !specializationNames.includes(form.specialization)
      ? [...specializationNames, form.specialization]
      : specializationNames;

  function save(event: FormEvent) {
    event.preventDefault();
    if (form) editor.save(api.doctors.save(form.id, form), "Doctor saved.");
  }

  const openForm = (doctor: Doctor | null) =>
    editor.open({ full_name: "", specialization: "", room: "", phone: "", ...doctor });

  const canDelete = may(user, "clinic.delete_doctor");
  const toggleActive = (doctor: Doctor) => editor.run(api.doctors.update(doctor.id, { is_active: !doctor.is_active }));
  const deleteDoctor = (doctor: Doctor) =>
    editor.confirmDelete("Dr. " + doctor.full_name, () => api.doctors.remove(doctor.id), "Doctor deleted.");
  const buttons = (doctor: Doctor): RowButton[] => [
    { label: doctor.is_active ? "Turn off" : "Turn on", onClick: () => toggleActive(doctor), hidden: !canEdit },
    { label: "Edit", onClick: () => openForm(doctor), hidden: !canEdit },
    { label: "Delete", tone: "danger", onClick: () => deleteDoctor(doctor), hidden: !canDelete },
  ];

  return (
    <Card
      title="Doctors"
      subtitle="Only available doctors appear in the booking screens"
      action={canAdd && <Button onClick={() => openForm(null)}>Add doctor</Button>}
    >
      {editor.dialog}
      <ResultAlert loadError={error} message={editor.message} tone={editor.tone} />
      {form && (form.id ? canEdit : canAdd) && (
        <InlineForm
          title={form.id ? "Edit Dr. " + form.full_name : "Add a doctor"}
          onSubmit={save}
          onClose={editor.close}
        >
          <TextField label="Full name" {...field("full_name")} required />
          <SelectField label="Specialization" {...field("specialization")} required>
            <option value="">Choose</option>
            {listedNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectField>
          <TwoColumns>
            <TextField label="Room" {...field("room")} />
            <TextField label="Phone" {...field("phone")} />
          </TwoColumns>
        </InlineForm>
      )}
      <DataTable columns={[...DOCTOR_COLUMNS, actionsColumn(buttons)]} rows={doctors} />
    </Card>
  );
}

const SPECIALIZATION_COLUMNS: Column<Specialization>[] = [
  column("Name", "name", "font-medium"),
  column("Doctors", "doctor_count"),
];

type SpecializationForm = Partial<Specialization> & { name: string };

function StaffSpecializations({ user, reload, onChanged }: ListProps) {
  const editor = useRecordEditor<SpecializationForm>(onChanged);
  const { form } = editor;
  const { value: specializations, error } = useApi(() => api.specializations.list(), [reload]);
  const canAdd = may(user, "clinic.add_specialization");
  const canEdit = may(user, "clinic.change_specialization");

  function save(event: FormEvent) {
    event.preventDefault();
    if (form) editor.save(api.specializations.save(form.id, { name: form.name }), "Specialization saved.");
  }

  const canDelete = may(user, "clinic.delete_specialization");
  const deleteSpecialization = ({ id, name }: Specialization) =>
    editor.confirmDelete(name, () => api.specializations.remove(id), "Specialization deleted.");
  const buttons = (specialization: Specialization): RowButton[] => [
    { label: "Edit", onClick: () => editor.open({ ...specialization }), hidden: !canEdit },
    { label: "Delete", tone: "danger", onClick: () => deleteSpecialization(specialization), hidden: !canDelete },
  ];

  return (
    <Card
      title="Specializations"
      subtitle="The list the doctor form chooses from"
      action={canAdd && <Button onClick={() => editor.open({ name: "" })}>Add specialization</Button>}
    >
      {editor.dialog}
      <ResultAlert loadError={error} message={editor.message} tone={editor.tone} />
      {form && (form.id ? canEdit : canAdd) && (
        <InlineForm onSubmit={save} onClose={editor.close}>
          <TextField label="Name" {...editor.field("name")} maxLength={100} required autoFocus />
        </InlineForm>
      )}
      <DataTable
        columns={[...SPECIALIZATION_COLUMNS, actionsColumn(buttons)]}
        rows={specializations}
        empty="No specializations yet."
      />
    </Card>
  );
}

export function DoctorsPage({ user }: UserProps) {
  const [reload, refresh] = useReload();
  return (
    <div>
      <StaffDoctors user={user} reload={reload} onChanged={refresh} />
      {may(user, "clinic.view_specialization") && (
        <StaffSpecializations user={user} reload={reload} onChanged={refresh} />
      )}
    </div>
  );
}

const PATIENT_REPORT_COLUMNS: Column<PatientReportRow>[] = [
  column("Patient", "full_name", "font-medium"),
  column("Phone", "phone"),
  column("Booked", "booked"),
  column("Cancelled", "cancelled"),
  column("Rescheduled", "rescheduled"),
  column("Postponed", "postponed"),
];

const DOCTOR_REPORT_COUNTS: (keyof DoctorReportRow)[] = [
  "waiting",
  "approved",
  "visited",
  "completed",
  "cancelled",
  "rejected",
  "rescheduled",
];

const DOCTOR_REPORT_COLUMNS: Column<DoctorReportRow>[] = [
  ["Doctor", (doctor) => "Dr. " + doctor.full_name, "font-medium"],
  column("Specialization", "specialization"),
  ...DOCTOR_REPORT_COUNTS.map((key) => column<DoctorReportRow>(key.charAt(0).toUpperCase() + key.slice(1), key)),
];

const total = <Row,>(rows: Row[], key: keyof Row) => rows.reduce((sum, row) => sum + Number(row[key]), 0);

function ReportTotals({ report }: { report: ClinicReport }) {
  const { patients, doctors } = report;
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard label="Bookings" value={total(patients, "booked")} />
      <StatCard label="Cancellations" value={total(doctors, "cancelled")} colour="grey" />
      <StatCard label="Reschedules" value={total(doctors, "rescheduled")} colour="sky" />
      <StatCard label="Postponements" value={total(patients, "postponed")} colour="sky" />
      <StatCard label="Transfers made" value={report.transfers_total} colour="sky" />
      <StatCard label="Waiting" value={total(doctors, "waiting")} colour="navy" />
      <StatCard label="Approved" value={total(doctors, "approved")} />
      <StatCard label="Visited" value={total(doctors, "visited")} />
      <StatCard label="Completed" value={total(doctors, "completed")} />
      <StatCard label="Deleted" value={report.appointments_deleted} colour="grey" />
    </div>
  );
}

export function StaffReports() {
  const { value: report, error } = useApi(api.reports);
  if (error) return <Alert>{error}</Alert>;
  if (!report) return <Loading />;

  return (
    <div>
      <ReportTotals report={report} />
      <Card title="Patient report" subtitle="Bookings, cancellations, reschedules and postponements">
        <DataTable columns={PATIENT_REPORT_COLUMNS} rows={report.patients} />
      </Card>
      <Card title="Doctor report" subtitle="Appointments by status">
        <DataTable columns={DOCTOR_REPORT_COLUMNS} rows={report.doctors} />
      </Card>
    </div>
  );
}

const ACCOUNT_COLUMNS: Column<Account>[] = [
  column("Username", "username", "font-medium"),
  column("Name", "display_name"),
  column("Role", "role_label"),
  ["Groups", (account) => account.groups.join(", ") || "-", "text-xs text-slate-400"],
  ["Active", (account) => (account.is_active ? "Yes" : "No")],
];

interface AccountDetailsProps {
  account: Account;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}

function AccountDetails({ account, canEdit, onEdit, onClose }: AccountDetailsProps) {
  const details: [string, string][] = [
    ["Full name", account.display_name],
    ["Phone", account.phone || "-"],
    ["Email", account.email || "-"],
    ["Groups", account.groups.join(", ") || "-"],
    ["Active", account.is_active ? "Yes" : "No"],
    ["Last sign in", formatDateTime(account.last_login) || "Never"],
  ];
  return (
    <Modal title={account.username} subtitle={account.role_label} onClose={onClose}>
      <DetailList items={details} />
      <div className="mt-6 flex justify-end gap-2">
        {canEdit && <Button onClick={onEdit}>Edit</Button>}
        <Button tone="light" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

function Modal({ title, subtitle, onClose, children }: ModalProps) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="modal-title" className="text-base font-semibold text-slate-800">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg px-2 text-2xl leading-none text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type AccountForm = Partial<Account> & {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  new_password: string;
};

export function StaffUsers({ user }: UserProps) {
  const allowed = (codename: string) => may(user, "clinic." + codename);
  const canAdd = allowed("add_user");
  const canEdit = allowed("change_user");
  const canDelete = allowed("delete_user");
  const [filters, setFilters] = useState({ search: "", role: "" });
  const [reload, refresh] = useReload();
  const [viewing, setViewing] = useState<Account | null>(null);
  const editor = useRecordEditor<AccountForm>(refresh);
  const { form: editing, field } = editor;
  const { value: accounts, error } = useApi(() => api.accounts.list(filters), [filters, reload]);
  const filter = bindField(filters, setFilters);
  const isNew = !!editing && !editing.id;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editing.id) {
      editor.save(api.accounts.update(editing.id, withoutBlank(editing, "new_password")), "Account saved.");
      return;
    }
    const body = {
      username: editing.username,
      password: editing.new_password,
      first_name: editing.first_name,
      last_name: editing.last_name,
      email: editing.email,
      role: editing.role,
      is_active: editing.is_active,
    };
    editor.save(api.accounts.create(body), ROLES[editing.role] + " registered.");
  }

  function showDetails(account: Account) {
    setViewing(account);
    editor.close();
  }

  function startEditing(account: Account) {
    editor.open({ ...account, new_password: "" });
    setViewing(null);
  }

  function startRegistering() {
    editor.open({
      username: "",
      first_name: "",
      last_name: "",
      email: "",
      role: "RECEPTIONIST",
      is_active: true,
      new_password: "",
    });
    setViewing(null);
  }

  function deleteAccount(account: Account) {
    const sendDelete = () => {
      setViewing(null);
      return api.accounts.remove(account.id);
    };
    editor.confirmDelete(account.username, sendDelete, "Account deleted.", "This cannot be undone.");
  }

  const registering = !!editing && isNew && canAdd;
  const editingExisting = !!editing && !isNew && canEdit;

  const accountForm = editing && (
    <form onSubmit={save} className="max-w-lg" autoComplete="off">
      <TextField label="Username" autoComplete="off" {...field("username")} required />
      <TwoColumns>
        <TextField label="First name" {...field("first_name")} required={isNew} />
        <TextField label="Last name" {...field("last_name")} />
      </TwoColumns>
      {isNew ? (
        <TextField label="Email" type="email" autoComplete="off" {...field("email")} />
      ) : (
        <TwoColumns>
          <TextField label="Phone" {...field("phone")} />
          <TextField label="Email" type="email" {...field("email")} />
        </TwoColumns>
      )}
      <TwoColumns>
        <SelectField label="Role" {...field("role")}>
          <Options choices={isNew ? STAFF_ROLES : ROLES} />
        </SelectField>
        <SelectField
          label="Account"
          value={editing.is_active ? "yes" : "no"}
          onChange={(event) => editor.setForm({ ...editing, is_active: event.target.value === "yes" })}
        >
          <option value="yes">Active</option>
          <option value="no">Switched off</option>
        </SelectField>
      </TwoColumns>
      <TextField
        label={isNew ? "Password" : "New password"}
        hint={isNew ? undefined : "Leave empty to keep the current one."}
        type="password"
        autoComplete="new-password"
        required={isNew}
        {...field("new_password")}
      />
      <SaveAndClose onClose={editor.close} />
    </form>
  );

  const buttons = (account: Account): RowButton[] => [
    { label: "View", onClick: () => showDetails(account) },
    { label: "Edit", onClick: () => startEditing(account), hidden: !canEdit },
    { label: "Delete", tone: "danger", onClick: () => deleteAccount(account), hidden: !canDelete },
  ];

  return (
    <div>
      {editor.dialog}
      <Card
        title="Users"
        subtitle="View, edit or delete any account in the system"
        action={
          <div className="flex gap-2">
            <FilterBar
              filter={filter}
              search="Search username or name"
              select="role"
              choices={ROLES}
              blank="All roles"
            />
            {canAdd && <Button onClick={startRegistering}>Register Staff</Button>}
          </div>
        }
      >
        <ResultAlert
          loadError={error}
          message={registering || editingExisting ? "" : editor.message}
          tone={editor.tone}
        />
        <DataTable columns={[...ACCOUNT_COLUMNS, actionsColumn(buttons)]} rows={accounts} />
      </Card>

      {viewing && (
        <AccountDetails
          account={viewing}
          canEdit={canEdit}
          onEdit={() => startEditing(viewing)}
          onClose={() => setViewing(null)}
        />
      )}

      {editingExisting && editing && (
        <Modal
          title={"Edit " + editing.username}
          subtitle="Changing the role also changes the permission group"
          onClose={editor.close}
        >
          <Alert tone={editor.tone}>{editor.message}</Alert>
          {accountForm}
        </Modal>
      )}

      {registering && (
        <Modal
          title="Register Staff"
          subtitle="Create a Clinic Manager or Receptionist account"
          onClose={editor.close}
        >
          <Alert tone={editor.tone}>{editor.message}</Alert>
          {accountForm}
        </Modal>
      )}
    </div>
  );
}

export function StaffAccess({ onSaved }: { onSaved: (user: User) => void }) {
  const [reload, reloadAccess] = useReload();
  const refresh = () => {
    reloadAccess();
    api.me().then(onSaved).catch(() => {});
  };
  const { message, tone, run } = useSaving(refresh);
  const { value: access, error } = useApi(api.access, [reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!access) return <Loading />;

  function togglePermission(group: PermissionGroup, permissionId: number) {
    const updatedPermissions = group.permissions.includes(permissionId)
      ? group.permissions.filter((id) => id !== permissionId)
      : [...group.permissions, permissionId];
    run(api.saveGroupPermissions(group.id, updatedPermissions));
  }

  const groupColumns = access.groups.map((group): Column<Permission> => [
    group.name,
    (permission) => (
      <input
        type="checkbox"
        className="h-4 w-4 accent-blue-600"
        checked={group.permissions.includes(permission.id)}
        onChange={() => togglePermission(group, permission.id)}
      />
    ),
    "text-center",
  ]);

  return (
    <Card title="Django permissions" subtitle="Tick a box to change what a role may do">
      <Alert tone={tone}>{message}</Alert>
      <DataTable columns={[column<Permission>("Permission", "label"), ...groupColumns]} rows={access.permissions} />
    </Card>
  );
}

const LOG_COLUMNS: Column<ActivityLogEntry>[] = [
  ["When", (entry) => formatDateTime(entry.created_at), "whitespace-nowrap text-slate-500"],
  column("User", "user_name"),
  [
    "Action",
    (entry) =>
      entry.action_label === "Error" ? (
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Error</span>
      ) : (
        entry.action_label
      ),
  ],
  column("Details", "description"),
  ["IP", (entry) => entry.ip_address || "-", "text-slate-400"],
];

const AUDIT_TAG_COLOURS: Record<AuditLogEntry["action"], string> = {
  CREATE: "bg-emerald-50 text-emerald-700",
  UPDATE: "bg-sky-50 text-sky-700",
  DELETE: "bg-rose-50 text-rose-700",
};

const showValue = (value: string | null) => (value === null || value === "" ? "empty" : value);

function ChangeList({ changes }: { changes: AuditLogEntry["changes"] }) {
  const rows = Object.entries(changes);
  if (rows.length === 0) return <span className="text-slate-400">-</span>;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map(([field, [before, after]]) => (
        <li key={field}>
          <span className="font-medium text-slate-700">{field.replace(/_/g, " ")}</span>
          {": "}
          {before !== null && <span className="text-rose-600 line-through">{showValue(before)}</span>}
          {before !== null && after !== null && " → "}
          {after !== null && <span className="text-emerald-700">{showValue(after)}</span>}
        </li>
      ))}
    </ul>
  );
}

const AUDIT_COLUMNS: Column<AuditLogEntry>[] = [
  ["When", (entry) => formatDateTime(entry.created_at), "whitespace-nowrap text-slate-500"],
  column("User", "user_name"),
  [
    "Action",
    (entry) => (
      <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + AUDIT_TAG_COLOURS[entry.action]}>
        {entry.action_label}
      </span>
    ),
  ],
  ["Record", (entry) => stacked(entry.object_repr, `${entry.model_name} #${entry.object_id}`), "font-medium"],
  ["Changes", (entry) => <ChangeList changes={entry.changes} />, "max-w-md"],
  ["IP", (entry) => entry.ip_address || "-", "text-slate-400"],
];

const ACTIVITY_KINDS: Record<string, string> = {
  activity: "Activity only",
  errors: "Errors only",
};

export function StaffLogs({ user }: UserProps) {
  const canSeeActivity = may(user, "clinic.view_activitylog");
  const canSeeAudit = may(user, "clinic.view_auditlog");
  const [kind, setKind] = useState(canSeeActivity ? "" : "audit");
  const showingAudit = kind === "audit";
  const activity = useApi<ActivityLogEntry[]>(
    () => (canSeeActivity && !showingAudit ? api.logs({ kind }) : Promise.resolve([])),
    [kind, canSeeActivity],
  );
  const audit = useApi<AuditLogEntry[]>(
    () => (canSeeAudit && showingAudit ? api.auditLogs() : Promise.resolve([])),
    [kind, canSeeAudit],
  );
  const choices: Record<string, string> = {
    ...(canSeeActivity ? ACTIVITY_KINDS : {}),
    ...(canSeeAudit ? { audit: "Audit trail" } : {}),
  };

  return (
    <Card
      title="System Logs"
      subtitle={
        showingAudit
          ? "Every record created, changed or deleted, with the old and new values"
          : "Sign ins, changes to clinic records and errors"
      }
      action={
        <div className="w-56">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <Options choices={choices} blank={canSeeActivity ? "All entries" : undefined} />
          </Select>
        </div>
      }
    >
      {showingAudit ? (
        <>
          <Alert>{audit.error}</Alert>
          <DataTable columns={AUDIT_COLUMNS} rows={audit.value} empty="No audit records yet." />
        </>
      ) : (
        <>
          <Alert>{activity.error}</Alert>
          <DataTable columns={LOG_COLUMNS} rows={activity.value} />
        </>
      )}
    </Card>
  );
}