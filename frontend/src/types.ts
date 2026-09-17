/*
 * types.ts: TypeScript shapes for the JSON the Django API sends,
 * matching clinic/serializers.py. It covers roles, appointment statuses,
 * users and sessions, patients, doctors, specializations, time slots,
 * bookings, notifications, activity logs, dashboard and report data,
 * and the permission groups used by the Permissions page.
 */

export type Role = "MANAGER" | "RECEPTIONIST" | "DOCTOR" | "PATIENT";

export type AppointmentStatus =
  "BOOKED" | "APPROVED" | "POSTPONED" | "TRANSFERRED" | "VISITED" | "COMPLETED" | "REJECTED" | "CANCELLED";

export type Gender = "F" | "M";

export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  phone: string;
  role: Role;
  role_label: string;
  is_superuser: boolean;
  is_active: boolean;
  permissions: string[];
}

export interface Session {
  token: string;
  user: User;
}

export interface Account {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  display_name: string;
  phone: string;
  role: Role;
  role_label: string;
  is_active: boolean;
  last_login: string | null;
  groups: string[];
}

export interface Patient {
  id: number;
  full_name: string;
  phone: string;
  gender: Gender;
  gender_label: string;
  date_of_birth: string | null;
  has_account: boolean;
  username: string;
  created_at: string;
}

export interface Doctor {
  id: number;
  full_name: string;
  specialization: string;
  room: string;
  phone: string;
  is_active: boolean;
}

export interface Specialization {
  id: number;
  name: string;
  doctor_count: number;
}

export interface Slot {
  id: number;
  doctor: number;
  date: string;
  time: string;
  is_blocked: boolean;
  is_booked: boolean;
  is_open: boolean;
}

export interface Booking {
  id: number;
  patient: number;
  patient_name: string;
  patient_phone: string;
  doctor: number;
  doctor_name: string;
  specialization: string;
  slot: number;
  date: string;
  time: string;
  reason: string;
  status: AppointmentStatus;
  status_label: string;
  notes: string;
  reschedule_count: number;
  postpone_count: number;
  transfer_count: number;
  can_change: boolean;
  created_at: string;
}

export interface Notification {
  id: number;
  appointment: number | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ActivityLogEntry {
  id: number;
  user_name: string;
  action: string;
  action_label: string;
  description: string;
  ip_address: string | null;
  created_at: string;
}

export interface Dashboard {
  appointments_today: number;
  transfers_total: number;
  waiting: number;
  patients_total: number;
  doctors_active: number;
  by_status: Record<string, number>;
  trend: { month: string; bookings: number }[];
  today: Booking[];
}

export interface PatientReportRow {
  id: number;
  full_name: string;
  phone: string;
  booked: number;
  cancelled: number;
  rescheduled: number;
  postponed: number;
}

export interface DoctorReportRow {
  id: number;
  full_name: string;
  specialization: string;
  waiting: number;
  approved: number;
  visited: number;
  completed: number;
  cancelled: number;
  rejected: number;
  rescheduled: number;
}

export interface ClinicReport {
  transfers_total: number;
  appointments_deleted: number;
  patients: PatientReportRow[];
  doctors: DoctorReportRow[];
}

export interface DoctorReport {
  totals: Record<Lowercase<AppointmentStatus>, number>;
  rescheduled: number;
  transfers: number;
  rows: Booking[];
}

export interface PermissionGroup {
  id: number;
  name: string;
  permissions: number[];
}

export interface Permission {
  id: number;
  codename: string;
  label: string;
}

export interface AccessMatrix {
  groups: PermissionGroup[];
  permissions: Permission[];
}