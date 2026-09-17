/*
 * ui.tsx: the shared building blocks every page uses, so screens look
 * and behave the same.
 * - Form parts: Input, Select, TextField, SelectField, password and
 *   gender/birth-date fields, FilterBar, and bindField, which keeps a form
 *   object in sync with its inputs.
 * - Layout: Card, InlineForm, TwoColumns, CenteredBox, DetailList.
 * - Display: Button, Alert, StatCard, StatusTag, BarChart, and DataTable
 *   with an actions column for row buttons.
 * - Confirmation: useConfirm shows a Yes/No dialog, and askDelete is the
 *   standard delete question.
 * - Data hooks: useApi loads data and reloads on change, useReload
 *   triggers a refresh, and useSaving shows success or error after a save.
 * - Helpers: status and gender labels, date and time formatting, and may(),
 *   which checks a user's permission to hide buttons.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type DependencyList,
  type FormEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { AppointmentStatus, Doctor, Gender, User } from "./types";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 " +
  "placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

// Choice lists map the value stored by the API to the label shown on screen.
export const STATUSES: Record<AppointmentStatus, string> = {
  BOOKED: "Waiting",
  APPROVED: "Approved",
  POSTPONED: "Postponed",
  TRANSFERRED: "Transferred",
  VISITED: "Visited",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
export const GENDERS: Record<Gender, string> = { F: "Female", M: "Male" };

// A visit in one of these still needs the doctor to approve or reject it.
export const WAITING_STATUSES: AppointmentStatus[] = ["BOOKED", "POSTPONED", "TRANSFERRED"];

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={INPUT_CLASS} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={INPUT_CLASS} />;
}

export function Options({ choices, blank }: { choices: Record<string, string>; blank?: string }) {
  return (
    <>
      {blank && <option value="">{blank}</option>}
      {Object.entries(choices).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

interface Labelled {
  label: ReactNode;
  hint?: ReactNode;
}

export function Field({ label, hint, children }: Labelled & { children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextField({ label, hint, ...inputProps }: Labelled & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint}>
      <Input {...inputProps} />
    </Field>
  );
}

export function SelectField({ label, hint, ...selectProps }: Labelled & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint}>
      <Select {...selectProps} />
    </Field>
  );
}

// The API rejects passwords shorter than 8 characters, so the browser checks it first.
export function NewPasswordField(props: Labelled & InputHTMLAttributes<HTMLInputElement>) {
  return <TextField hint="At least 8 characters." type="password" minLength={8} {...props} />;
}

export function TwoColumns({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export interface FieldProps {
  value: string | number;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}
export type FieldBinder<Form> = (name: keyof Form & string, transform?: (text: string) => unknown) => FieldProps;

// <Input {...field("phone")} /> keeps one key of a form object in sync.
export function bindField<Form extends object>(values: Form, setValues: (next: Form) => void): FieldBinder<Form> {
  return (name, transform = (text) => text) => ({
    value: (values[name] ?? "") as string | number,
    onChange: (event) => setValues({ ...values, [name]: transform(event.target.value) }),
  });
}

// Leaves out the named fields when they are empty, so the API keeps its current values.
export function withoutBlank<Form extends object>(values: Form, ...names: (keyof Form)[]): Partial<Form> {
  return Object.fromEntries(
    Object.entries(values).filter(([name, value]) => value || !names.includes(name as keyof Form)),
  ) as Partial<Form>;
}

// A search box (placeholder `search`) plus a dropdown for the `select` filter.
export function FilterBar<Filters extends { search: string }>(props: {
  filter: FieldBinder<Filters>;
  search: string;
  select: keyof Filters & string;
  choices: Record<string, string>;
  blank: string;
}) {
  const { filter, search, select, choices, blank } = props;
  return (
    <div className="flex gap-2">
      <Input placeholder={search} {...filter("search")} />
      <Select {...filter(select)}>
        <Options choices={choices} blank={blank} />
      </Select>
    </div>
  );
}

export function GenderAndBirthDate<Form extends { gender: string; date_of_birth: string | null }>({
  field,
}: {
  field: FieldBinder<Form>;
}) {
  return (
    <TwoColumns>
      <SelectField label="Gender" {...field("gender")} required>
        <Options choices={GENDERS} blank="Choose" />
      </SelectField>
      <TextField label="Date of birth" type="date" max={todayLocal()} {...field("date_of_birth")} />
    </TwoColumns>
  );
}

const BUTTON_TONES = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  light: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50",
  red: "bg-rose-600 text-white hover:bg-rose-700",
};
export type ButtonTone = keyof typeof BUTTON_TONES;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; small?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = "primary", small, className = "", ...rest },
  ref,
) {
  const size = small ? "px-3 py-1.5" : "px-4 py-2.5";
  const classes = ["rounded-lg text-sm font-medium disabled:opacity-50", size, BUTTON_TONES[tone], className];
  return <button ref={ref} {...rest} className={classes.join(" ")} />;
});

type AlertTone = "ok" | "error";

export function Alert({ children, tone }: { children: ReactNode; tone?: AlertTone }) {
  if (!children) return null;
  const colours = tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return <div className={"mb-4 rounded-lg px-3.5 py-2.5 text-sm " + colours}>{children}</div>;
}

// Shows a load error if there is one, otherwise the last save result.
export function ResultAlert({ loadError, message, tone }: { loadError: string; message: string; tone: AlertTone }) {
  return <Alert tone={loadError ? "error" : tone}>{loadError || message}</Alert>;
}

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function Card({ title, subtitle, action, children }: CardProps) {
  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function SaveAndClose({ onClose, saveDisabled }: { onClose: () => void; saveDisabled?: boolean }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" disabled={saveDisabled}>
        Save
      </Button>
      <Button tone="light" type="button" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

interface InlineFormProps {
  title?: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
  children: ReactNode;
}

export function InlineForm({ title, onSubmit, onClose, children }: InlineFormProps) {
  return (
    <form onSubmit={onSubmit} className="mb-6 max-w-lg rounded-xl bg-slate-50 p-4">
      {title && <h3 className="mb-4 text-sm font-semibold text-blue-950">{title}</h3>}
      {children}
      <SaveAndClose onClose={onClose} />
    </form>
  );
}

const STAT_BARS = { blue: "bg-blue-600", sky: "bg-sky-400", navy: "bg-blue-900", grey: "bg-slate-400" };

export function StatCard(props: { label: string; value: number; colour?: keyof typeof STAT_BARS }) {
  const { label, value, colour = "blue" } = props;
  return (
    <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <span className={"w-1.5 shrink-0 " + STAT_BARS[colour]} />
      <div className="p-5">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <p className="mt-2 text-3xl font-bold text-blue-950">{value}</p>
      </div>
    </div>
  );
}

const STATUS_COLOURS: Record<AppointmentStatus, string> = {
  BOOKED: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  APPROVED: "bg-blue-600 text-white",
  POSTPONED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  TRANSFERRED: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  VISITED: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  COMPLETED: "bg-emerald-600 text-white",
  CANCELLED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

export function StatusTag({ status, label }: { status: AppointmentStatus; label: string }) {
  const colours = STATUS_COLOURS[status] || "bg-slate-100 text-slate-600";
  return <span className={"whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium " + colours}>{label}</span>;
}

export type Column<Row> = [heading: string, renderCell: (row: Row) => ReactNode, className?: string];

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[] | null;
  empty?: string;
}

export function DataTable<Row extends { id: number }>(props: DataTableProps<Row>) {
  const { columns, rows, empty = "Nothing to show yet." } = props;
  const items = rows || [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            {columns.map(([heading], index) => (
              <th key={index} className="px-3 py-3 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-slate-400">
                {empty}
              </td>
            </tr>
          )}
          {items.map((row) => (
            <tr key={row.id} className="border-b border-slate-50 text-slate-700 last:border-0">
              {columns.map(([, renderCell, className = ""], index) => (
                <td key={index} className={"px-3 py-3.5 " + className}>
                  {renderCell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface RowButton {
  label: string;
  onClick: () => void;
  tone?: ButtonTone;
  hidden?: boolean;
}

// tone defaults to "light" so only the exceptions (danger) need to name one.
export function actionsColumn<Row>(getButtons: (row: Row) => RowButton[]): Column<Row> {
  const renderCell = (row: Row) => (
    <div className="flex flex-wrap justify-end gap-2">
      {getButtons(row)
        .filter((button) => !button.hidden)
        .map(({ label, onClick, tone = "light" }) => (
          <Button key={label} small tone={tone} onClick={onClick}>
            {label}
          </Button>
        ))}
    </div>
  );
  return ["", renderCell, "text-right"];
}

export function stacked(main: ReactNode, detail: ReactNode) {
  return (
    <>
      {main}
      <span className="block text-xs text-slate-400">{detail}</span>
    </>
  );
}

// Label/value pairs laid out in two columns.
export function DetailList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-slate-400">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CenteredBox({ wide, children }: { wide?: boolean; children: ReactNode }) {
  const width = wide ? "max-w-md" : "max-w-sm";
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className={"w-full rounded-2xl bg-white p-8 shadow-sm " + width}>{children}</div>
    </div>
  );
}

export function Loading() {
  return <p className="text-sm text-slate-500">Loading...</p>;
}

export function BarChart({ points }: { points: { month: string; bookings: number }[] }) {
  const highest = Math.max(...points.map((point) => point.bookings));
  if (highest === 0) {
    return <p className="py-12 text-center text-sm text-slate-400">No bookings in the last six months.</p>;
  }

  return (
    <div className="flex h-56 gap-4">
      {points.map(({ month, bookings }) => (
        <div key={month} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="text-xs font-semibold text-blue-700">{bookings}</span>
          <div
            className="w-full rounded-t-md bg-blue-600"
            style={{ height: Math.max((bookings / highest) * 100, 2) + "%" }}
          />
          <span className="text-xs text-slate-500">{month}</span>
        </div>
      ))}
    </div>
  );
}

export interface Question {
  title: string;
  message: string;
  yesText?: string;
  noText?: string;
  danger?: boolean;
}

type ConfirmDialogProps = Question & { onYes: () => void; onNo: () => void };

function ConfirmDialog({ title, message, yesText = "Yes", noText = "No", danger, onYes, onNo }: ConfirmDialogProps) {
  const noButton = useRef<HTMLButtonElement>(null);

  // Start on the safe choice so an accidental Enter does not delete anything.
  useEffect(() => noButton.current?.focus(), []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onNo();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onNo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onNo}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-slate-800">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={noButton} tone="light" onClick={onNo}>
            {noText}
          </Button>
          <Button tone={danger ? "red" : "primary"} onClick={onYes}>
            {yesText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type Ask = (question: Question) => Promise<boolean>;

// const [dialog, ask] = useConfirm();
// if (await ask({ title, message })) { ... }
// The screen has to render {dialog} for the question to appear.
export function useConfirm(): [ReactNode, Ask] {
  const [question, setQuestion] = useState<(Question & { resolve: (confirmed: boolean) => void }) | null>(null);

  const ask: Ask = (options) => new Promise((resolve) => setQuestion({ ...options, resolve }));

  function answer(confirmed: boolean) {
    question?.resolve(confirmed);
    setQuestion(null);
  }

  const dialog = question && <ConfirmDialog {...question} onYes={() => answer(true)} onNo={() => answer(false)} />;
  return [dialog, ask];
}

export function askDelete(ask: Ask, name: string, extra?: string) {
  return ask({
    title: "Delete",
    message: "Are you sure to delete " + name + "?" + (extra ? " " + extra : ""),
    yesText: "Delete",
    noText: "Cancel",
    danger: true,
  });
}

// toISOString() alone would give the UTC date, which is wrong near midnight.
export function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const shortTime = (time: string) => time.slice(0, 5);

export const formatDateTime = (isoText: string | null) => (isoText ? isoText.replace("T", " ").slice(0, 16) : "");

export const doctorLabel = (doctor: Doctor) => `Dr. ${doctor.full_name} (${doctor.specialization})`;

// These two only hide buttons; the server enforces the same rules on every request.
export const isManager = (user: User) => user.is_superuser || user.role === "MANAGER";

export function may(user: User, permission: string): boolean {
  return user.is_superuser || user.permissions.includes(permission);
}

// Loads again whenever a value in `watch` changes. `load` is usually an inline
// arrow function, so it is deliberately left out of the effect dependencies.
export function useApi<T>(load: () => Promise<T>, watch: DependencyList = []) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    load()
      .then((loaded) => {
        if (!active) return;
        setValue(loaded);
        setError("");
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, watch);

  return { value, error };
}

// Pass the counter to useApi's `watch` list; calling reload() fetches again.
export function useReload(): [number, () => void] {
  const [count, setCount] = useState(0);
  return [count, () => setCount((previous) => previous + 1)];
}

export function useNote() {
  const [note, setNote] = useState({ text: "", ok: true });
  return {
    message: note.text,
    tone: (note.ok ? "ok" : "error") as AlertTone,
    showSuccess: (text = "") => setNote({ text, ok: true }),
    showError: (text: string) => setNote({ text, ok: false }),
    clear: () => setNote({ text: "", ok: true }),
  };
}

// run() resolves to true on success, so the caller can close its form.
export function useSaving(afterSave: () => void) {
  const note = useNote();

  const run = (request: Promise<unknown>, successText?: string): Promise<boolean> =>
    request
      .then(() => {
        note.showSuccess(successText);
        afterSave();
        return true;
      })
      .catch((requestError: Error) => {
        note.showError(requestError.message);
        return false;
      });

  return { ...note, run };
}