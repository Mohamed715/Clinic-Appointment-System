/*
 * api.ts: the single place where the React app talks to the Django backend.
 * It stores the sign-in token and user in localStorage, and sends every
 * request as JSON with the token attached (except login, signup and
 * forgot password). DRF errors become one readable message. An expired
 * token (401) clears the session and returns to sign-in. The api object
 * lists every endpoint, grouped by user:
 * - account: sign in, profile, password
 * - staff: dashboard, reports, logs, patients, doctors, users, permissions,
 *   appointment actions
 * - doctors: time slots, appointments, report
 * - patients: booking, own appointments, notifications
 */

import type {
  AccessMatrix,
  Account,
  ActivityLogEntry,
  Booking,
  ClinicReport,
  Dashboard,
  Doctor,
  DoctorReport,
  Notification,
  Patient,
  Session,
  Slot,
  Specialization,
  User,
} from "./types";

// Address of the Django API. Change it here if the backend runs elsewhere.
const API_URL = "http://127.0.0.1:8000/api";
const TOKEN_KEY = "clinic.token";
const USER_KEY = "clinic.user";

// A stale token on these makes DRF reject the request before reading the form.
const TOKENLESS_PATHS = ["/auth/login/", "/auth/signup/", "/auth/forgot/"];

export type Filters = Record<string, string | number | null | undefined>;

export interface AuditLogEntry {
  id: number;
  created_at: string;
  user_name: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  action_label: string;
  model_name: string;
  object_id: string;
  object_repr: string;
  changes: Record<string, [string | null, string | null]>;
  ip_address: string | null;
}
type RequestBody = object;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// A user without a token is a leftover from a session that ended, not a signed in user.
export function getStoredUser(): User | null {
  if (!getToken()) return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "null");
  } catch {
    // Stored value was edited or corrupted; treat it as signed out.
    return null;
  }
}

export function saveSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  updateStoredUser(user);
}

export function updateStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// DRF sends either {"detail": "..."} or {"field": ["...", ...]}; show one line.
function errorMessage(responseBody: Record<string, unknown>): string {
  if (responseBody.detail) return String(responseBody.detail);
  const firstField = Object.keys(responseBody)[0];
  if (!firstField) return "Something went wrong.";
  const fieldErrors = responseBody[firstField];
  return Array.isArray(fieldErrors) ? fieldErrors.join(" ") : String(fieldErrors);
}

async function request<T>(path: string, method = "GET", body?: RequestBody): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  const sendToken = Boolean(token) && !TOKENLESS_PATHS.includes(path);
  if (sendToken) {
    headers.Authorization = "Token " + token;
  }

  const response = await fetch(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  // DELETE answers 204 with no body; callers of those endpoints ignore the value.
  if (response.status === 204) return null as T;
  // Error pages from a crashed server are HTML, not JSON.
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    // A 401 on a request that carried a token means the token has expired.
    // A wrong password also gets 401, but login sends no token, so that
    // case falls through and the message is shown.
    if (response.status === 401 && sendToken) {
      clearSession();
      window.history.replaceState(null, "", window.location.pathname);
      window.location.reload();
    }
    throw new Error(errorMessage(responseBody));
  }
  return responseBody as T;
}

// {search: "ali", status: ""} -> "?search=ali"
function query(filters: Filters = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== "" && value != null) params.append(name, String(value));
  }
  const text = params.toString();
  return text ? "?" + text : "";
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: RequestBody) => request<T>(path, "POST", body);
const patch = <T>(path: string, body: RequestBody) => request<T>(path, "PATCH", body);
const remove = (path: string) => request<null>(path, "DELETE");

// The list/create/edit/delete endpoints DRF's router gives each table.
function resource<T>(path: string) {
  return {
    list: (filters?: Filters) => get<T[]>(path + query(filters)),
    save: (id: number | undefined, form: RequestBody) => (id ? patch<T>(`${path}${id}/`, form) : post<T>(path, form)),
    update: (id: number, form: RequestBody) => patch<T>(`${path}${id}/`, form),
    remove: (id: number) => remove(`${path}${id}/`),
  };
}

const appointment = (id: number, action: string, body?: RequestBody) =>
  post<Booking>(`/appointments/${id}/${action}/`, body);
const doctorAppointment = (id: number, action: string, body?: RequestBody) =>
  post<Booking>(`/doctor/appointments/${id}/${action}/`, body);
const portalAppointment = (id: number, action: string, body?: RequestBody) =>
  post<Booking>(`/portal/appointments/${id}/${action}/`, body);

const api = {
  // Sign in and own account
  login: (username: string, password: string) => post<Session>("/auth/login/", { username, password }),
  signup: (form: RequestBody) => post<Session>("/auth/signup/", form),
  logout: () => post<{ detail: string }>("/auth/logout/"),
  me: () => get<User>("/auth/me/"),
  updateProfile: (form: RequestBody) => patch<User>("/auth/me/", form),
  changePassword: (form: RequestBody) => post<{ token: string }>("/auth/password/", form),
  forgotPassword: (form: RequestBody) => post<{ detail: string }>("/auth/forgot/", form),

  // Manager and reception pages
  dashboard: () => get<Dashboard>("/dashboard/"),
  reports: () => get<ClinicReport>("/reports/"),
  logs: (filters?: Filters) => get<ActivityLogEntry[]>("/logs/" + query(filters)),
  auditLogs: (filters?: Filters) => get<AuditLogEntry[]>("/audit-logs/" + query(filters)),
  patients: resource<Patient>("/patients/"),
  doctors: resource<Doctor>("/doctors/"),
  specializations: resource<Specialization>("/specializations/"),
  accounts: {
    ...resource<Account>("/accounts/"),
    create: (form: RequestBody) => post<Account>("/accounts/", form),
  },
  access: () => get<AccessMatrix>("/access/"),
  saveGroupPermissions: (group: number, permissions: number[]) => patch("/access/", { group, permissions }),
  appointments: (filters: Filters) => get<Booking[]>("/appointments/" + query(filters)),
  setStatus: (id: number, status: string) => appointment(id, "decide", { status }),
  cancelAppointment: (id: number) => appointment(id, "cancel"),
  deleteAppointment: (id: number) => remove(`/appointments/${id}/`),
  postpone: (id: number, slot: number) => appointment(id, "postpone", { slot }),
  transfer: (id: number, slot: number) => appointment(id, "transfer", { slot }),
  openSlots: (doctor: number | string) => get<Slot[]>("/open-slots/" + query({ doctor })),

  // Doctor pages
  mySlots: (filters: Filters) => get<Slot[]>("/doctor/slots/" + query(filters)),
  generateSlots: (form: RequestBody) => post<{ added: number }>("/doctor/slots/generate/", form),
  toggleBlock: (id: number) => post<Slot>(`/doctor/slots/${id}/block/`),
  myAppointments: (filters: Filters) => get<Booking[]>("/doctor/appointments/" + query(filters)),
  mySetStatus: (id: number, status: string) => doctorAppointment(id, "decide", { status }),
  myTransfer: (id: number, slot: number) => doctorAppointment(id, "transfer", { slot }),
  myCancel: (id: number) => doctorAppointment(id, "cancel"),
  myReport: () => get<DoctorReport>("/doctor/appointments/report/"),

  // Patient pages
  portalDoctors: () => get<Doctor[]>("/portal/doctors/"),
  portalSlots: (doctor: number | string) => get<Slot[]>("/portal/slots/" + query({ doctor })),
  myBookings: () => get<Booking[]>("/portal/appointments/"),
  book: (form: RequestBody) => post<Booking>("/portal/appointments/", form),
  cancelBooking: (id: number) => portalAppointment(id, "cancel"),
  rescheduleBooking: (id: number, slot: number) => portalAppointment(id, "reschedule", { slot }),
  notifications: () => get<Notification[]>("/portal/notifications/"),
  markNotificationsRead: () => post<{ detail: string }>("/portal/notifications/"),
};

export default api;