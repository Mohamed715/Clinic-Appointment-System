/*
 * app.tsx: the main layout and router of the clinic app.
 * Shows the sign-in page, or the sidebar menu and current page for the
 * signed-in user. Each role has its own menu, and items are hidden when
 * their permission is unticked. It refreshes the user's permissions every
 * 30 seconds, counts unread patient notifications, and confirms before
 * signing out.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";
import api, { clearSession, getStoredUser, getToken, updateStoredUser } from "./api";
import SignIn from "./auth";
import { DoctorAppointments, DoctorReport, DoctorSchedule } from "./doctor";
import { PatientAppointments, PatientBooking, PatientNotifications } from "./patient";
import {
  DoctorsPage,
  StaffAccess,
  StaffAppointments,
  StaffDashboard,
  StaffLogs,
  StaffPatients,
  StaffReports,
  StaffUsers,
} from "./staff";
import Settings from "./settings";
import type { Role, User } from "./types";
import { Button, CenteredBox, may, useConfirm } from "./ui";

// Every page receives the same props and uses the ones it needs.
interface PageProps {
  user: User;
  onSaved: (user: User) => void;
  onRead: () => void;
}

interface MenuEntry {
  path: string;
  label: string;
  page: ComponentType<PageProps>;
  permission?: string | string[];
}

const USER_POLL_MS = 30000;

const SETTINGS: MenuEntry = { path: "settings", label: "Settings", page: Settings, permission: "clinic.view_settings" };
const DESK_PAGES: MenuEntry[] = [
  { path: "dashboard", label: "Overview", page: StaffDashboard, permission: "clinic.view_overview" },
  { path: "appointments", label: "Appointments", page: StaffAppointments, permission: "clinic.view_appointment" },
  { path: "patients", label: "Patients", page: StaffPatients, permission: "clinic.view_patient" },
  { path: "doctors", label: "Doctors", page: DoctorsPage, permission: "clinic.view_doctor" },
];

// A role can only open the pages listed for it; anything else shows Forbidden.
const MENUS: Record<Role, MenuEntry[]> = {
  MANAGER: [
    ...DESK_PAGES,
    { path: "reports", label: "Reports", page: StaffReports, permission: "clinic.view_reports" },
    { path: "users", label: "Users", page: StaffUsers, permission: "clinic.view_user" },
    { path: "roles", label: "Permissions", page: StaffAccess },
    {
      path: "logs",
      label: "System Logs",
      page: StaffLogs,
      permission: ["clinic.view_activitylog", "clinic.view_auditlog"],
    },
    SETTINGS,
  ],
  RECEPTIONIST: [...DESK_PAGES, SETTINGS],
  DOCTOR: [
    { path: "schedule", label: "My schedule", page: DoctorSchedule, permission: "clinic.view_slot" },
    { path: "appointments", label: "Appointments", page: DoctorAppointments, permission: "clinic.view_appointment" },
    { path: "reports", label: "Reports", page: DoctorReport, permission: "clinic.view_reports" },
    SETTINGS,
  ],
  PATIENT: [
    { path: "book", label: "Book appointment", page: PatientBooking, permission: "clinic.view_booking" },
    {
      path: "appointments",
      label: "My appointments",
      page: PatientAppointments,
      permission: "clinic.view_appointment",
    },
    {
      path: "notifications",
      label: "Notifications",
      page: PatientNotifications,
      permission: "clinic.view_notification",
    },
    SETTINGS,
  ],
};

function allowedMenu(user: User): MenuEntry[] {
  return (MENUS[user.role] ?? []).filter((entry) => {
    if (!entry.permission) return true;
    const needed = Array.isArray(entry.permission) ? entry.permission : [entry.permission];
    return needed.some((permission) => may(user, permission));
  });
}

function goToFirstPage() {
  if (!window.location.hash) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function readHash(): string {
  return window.location.hash.replace("#/", "");
}

function useHash() {
  const [hash, setHash] = useState(readHash());
  useEffect(() => {
    const update = () => setHash(readHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash;
}

function Forbidden() {
  return (
    <CenteredBox>
      <div className="text-center">
        <p className="text-3xl font-bold text-rose-600">403</p>
        <h1 className="mt-2 text-lg font-semibold text-slate-800">Access denied</h1>
        <p className="mt-2 text-sm text-slate-500">Your account cannot open this page.</p>
        <Button className="mt-6" onClick={goToFirstPage}>
          Back to my pages
        </Button>
      </div>
    </CenteredBox>
  );
}

function NoPages({ onSignOut }: { onSignOut: () => void }) {
  return (
    <CenteredBox>
      <div className="text-center">
        <h1 className="text-lg font-semibold text-slate-800">No pages available</h1>
        <p className="mt-2 text-sm text-slate-500">Your role has no permissions yet. Ask the clinic manager.</p>
        <Button className="mt-6" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </CenteredBox>
  );
}

const UNREAD_POLL_MS = 60000;

// Kept stable with useCallback: the notifications page lists it as an effect dependency.
function useUnreadCount(isPatient: boolean): [number, () => void] {
  const [unreadCount, setUnreadCount] = useState(0);

  const reloadUnreadCount = useCallback(() => {
    api
      .notifications()
      .then((notifications) => setUnreadCount(notifications.filter((item) => !item.is_read).length))
      // The badge is a hint; a failed refresh just keeps the last count.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isPatient) return undefined;
    reloadUnreadCount();
    const timer = setInterval(reloadUnreadCount, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [isPatient, reloadUnreadCount]);

  return [unreadCount, reloadUnreadCount];
}

const MENU_LINK_CLASSES = {
  sidebar: {
    base: "px-3 py-2.5",
    active: "bg-white font-medium text-blue-900",
    idle: "text-blue-100 hover:bg-blue-800",
  },
  mobile: {
    base: "whitespace-nowrap px-3 py-2",
    active: "bg-blue-600 font-medium text-white",
    idle: "bg-white text-slate-600 ring-1 ring-slate-200",
  },
};

interface MenuLinkProps {
  entry: MenuEntry;
  active: boolean;
  unread: number;
  mobile: boolean;
}

function MenuLink({ entry, active, unread, mobile }: MenuLinkProps) {
  const classes = MENU_LINK_CLASSES[mobile ? "mobile" : "sidebar"];
  const state = active ? classes.active : classes.idle;
  const className = `flex items-center justify-between rounded-lg text-sm ${classes.base} ${state}`;
  return (
    <a href={"#/" + entry.path} className={className}>
      {entry.label}
      {unread > 0 && (
        <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span>
      )}
    </a>
  );
}

interface ShellProps {
  user: User;
  onSignOut: () => void;
  onUserChange: (user: User) => void;
  onRefreshUser: () => void;
}

function Shell({ user, onSignOut, onUserChange, onRefreshUser }: ShellProps) {
  const hash = useHash();
  const [dialog, ask] = useConfirm();
  const isPatient = user.role === "PATIENT" && may(user, "clinic.view_notification");
  const [unreadCount, reloadUnreadCount] = useUnreadCount(isPatient);
  const menu = allowedMenu(user);
  const requestedPage = menu.find((entry) => entry.path === hash);

  useEffect(() => {
    if (isPatient) reloadUnreadCount();
  }, [hash, isPatient, reloadUnreadCount]);

  useEffect(() => {
    onRefreshUser();
  }, [hash, onRefreshUser]);

  if (menu.length === 0) return <NoPages onSignOut={onSignOut} />;
  const current = hash ? requestedPage : menu[0];
  if (!current) return <Forbidden />;
  const Page = current.page;

  async function confirmSignOut() {
    const confirmed = await ask({
      title: "Sign out",
      message: "Are you going to exit?",
      yesText: "Exit",
      noText: "Stay",
    });
    if (confirmed) onSignOut();
  }

  const menuLinks = (mobile: boolean) =>
    menu.map((entry) => (
      <MenuLink
        key={entry.path}
        mobile={mobile}
        entry={entry}
        active={entry.path === current.path}
        unread={entry.path === "notifications" ? unreadCount : 0}
      />
    ));

  return (
    <div className="flex min-h-screen">
      {dialog}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-blue-900 p-4 text-blue-100 lg:flex">
        <div className="px-2 pb-5 pt-2">
          <p className="text-sm font-bold text-white">Clinic Appointment</p>
          <p className="text-xs text-blue-300">System</p>
        </div>
        <nav className="space-y-1">{menuLinks(false)}</nav>
        <div className="mt-auto border-t border-blue-800 pt-4">
          <p className="px-3 text-sm font-medium text-white">{user.display_name}</p>
          <p className="px-3 text-xs text-blue-300">{user.role_label}</p>
          <button
            onClick={confirmSignOut}
            className="mt-3 w-full rounded-lg px-3 py-2.5 text-left text-sm text-blue-100 hover:bg-blue-800"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 lg:ml-60 lg:p-6">
        <nav className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
          {menuLinks(true)}
          <button
            onClick={confirmSignOut}
            className="whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm text-rose-600 ring-1 ring-slate-200"
          >
            Sign out
          </button>
        </nav>
        <h1 className="mb-6 text-xl font-semibold text-blue-950">{current.label}</h1>
        <Page user={user} onSaved={onUserChange} onRead={reloadUnreadCount} />
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(getStoredUser());

  const changeUser = useCallback((latestUser: User) => {
    updateStoredUser(latestUser);
    setUser(latestUser);
  }, []);

  const refreshUser = useCallback(() => {
    if (!getToken()) return;
    api
      .me()
      .then(changeUser)
      .catch(() => {});
  }, [changeUser]);

  // The stored copy may be stale, for example after a manager changed the role.
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(changeUser)
      .catch(() => {
        clearSession();
        setUser(null);
      });
  }, [changeUser]);

  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(refreshUser, USER_POLL_MS);
    window.addEventListener("focus", refreshUser);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshUser);
    };
  }, [user?.id, refreshUser]);

  useEffect(() => {
    if (!user) goToFirstPage();
  }, [user]);

  function signOut() {
    // Clear the local session even if the server cannot be reached.
    api
      .logout()
      .catch(() => {})
      .finally(() => {
        clearSession();
        goToFirstPage();
        setUser(null);
      });
  }

  function handleSignedIn(signedInUser: User) {
    goToFirstPage();
    setUser(signedInUser);
  }

  if (!user) return <SignIn onSignedIn={handleSignedIn} />;
  return <Shell user={user} onSignOut={signOut} onUserChange={changeUser} onRefreshUser={refreshUser} />;
}