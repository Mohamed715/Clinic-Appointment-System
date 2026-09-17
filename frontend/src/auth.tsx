/*
 * auth.tsx: the screens shown before signing in.
 * - Sign in: username and password.
 * - Sign up: new patients create an account with name, username, phone,
 *   gender, birth date and password.
 * - Forgot password: patients reset it using their phone number.
 * A successful sign in or sign up saves the session and opens the app.
 * Errors appear above the form.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import api, { saveSession } from "./api";
import type { Session, User } from "./types";
import {
  Alert,
  Button,
  CenteredBox,
  GenderAndBirthDate,
  NewPasswordField,
  TextField,
  bindField,
  todayLocal,
  useNote,
} from "./ui";

interface AuthFormProps {
  subtitle: string;
  wide?: boolean;
  onSubmit: (event: FormEvent) => void;
  alert: ReactNode;
  busy: boolean;
  submitText: string;
  busyText: string;
  footer: ReactNode;
  children: ReactNode;
}

function AuthForm({ subtitle, wide, onSubmit, alert, busy, submitText, busyText, footer, children }: AuthFormProps) {
  return (
    <CenteredBox wide={wide}>
      <form onSubmit={onSubmit}>
        <h1 className="text-center text-xl font-bold text-blue-950">Clinic Appointment System</h1>
        <p className="mb-6 mt-1 text-center text-sm text-slate-500">{subtitle}</p>
        {alert}
        {children}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? busyText : submitText}
        </Button>
        {footer}
      </form>
    </CenteredBox>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="font-medium text-blue-600" onClick={onClick}>
      {children}
    </button>
  );
}

// Sends a sign in or sign up request; on failure shows the error and re-enables the button.
function useSessionRequest() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function send(request: Promise<void>) {
    setError("");
    setBusy(true);
    request.catch((requestError: Error) => {
      setError(requestError.message);
      setBusy(false);
    });
  }

  return { error, busy, send };
}

// Staff cannot reset here; the manager sets their password on the Users page.
function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({ username: "", phone: "", date_of_birth: "", new_password: "" });
  const [busy, setBusy] = useState(false);
  const note = useNote();
  const field = bindField(form, setForm);

  function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    api
      .forgotPassword(form)
      .then(({ detail }) => note.showSuccess(detail))
      .catch((requestError: Error) => note.showError(requestError.message))
      .finally(() => setBusy(false));
  }

  return (
    <AuthForm
      subtitle="Set a new password"
      onSubmit={submit}
      alert={<Alert tone={note.tone}>{note.message}</Alert>}
      busy={busy}
      submitText="Save"
      busyText="Saving..."
      footer={
        <p className="mt-5 text-center text-sm text-slate-500">
          <LinkButton onClick={onBack}>Back to sign in</LinkButton>
        </p>
      }
    >
      <TextField label="Username" {...field("username")} required autoFocus />
      <TextField label="Phone number" hint="The number the clinic has for you." {...field("phone")} required />
      <TextField
        label="Date of birth"
        hint="Only if the clinic has it on file."
        type="date"
        max={todayLocal()}
        {...field("date_of_birth")}
      />
      <NewPasswordField label="New password" required {...field("new_password")} />
    </AuthForm>
  );
}

type StartSession = (request: Promise<Session>) => Promise<void>;

function SignUp({ onBack, startSession }: { onBack: () => void; startSession: StartSession }) {
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    phone: "",
    gender: "",
    date_of_birth: "",
    password: "",
  });
  const { error, busy, send } = useSessionRequest();
  const field = bindField(form, setForm);

  function submit(event: FormEvent) {
    event.preventDefault();
    send(startSession(api.signup({ ...form, date_of_birth: form.date_of_birth || null })));
  }

  return (
    <AuthForm
      wide
      subtitle="Create your patient account"
      onSubmit={submit}
      alert={<Alert>{error}</Alert>}
      busy={busy}
      submitText="Create account"
      busyText="Creating account..."
      footer={
        <p className="mt-5 text-center text-sm text-slate-500">
          Already registered? <LinkButton onClick={onBack}>Sign in</LinkButton>
        </p>
      }
    >
      <TextField label="Full name" {...field("full_name")} required autoFocus />
      <TextField
        label="Username"
        hint="3 to 12 letters, no spaces. You will sign in with this."
        pattern="[A-Za-z]{3,12}"
        minLength={3}
        maxLength={12}
        required
        {...field("username", (text) => text.replace(/[^A-Za-z]/g, ""))}
      />
      <TextField label="Phone number" {...field("phone")} required />
      <GenderAndBirthDate field={field} />
      <NewPasswordField label="Password" required {...field("password")} />
    </AuthForm>
  );
}

type Screen = "signin" | "signup" | "forgot";

export default function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [screen, setScreen] = useState<Screen>("signin");
  const [form, setForm] = useState({ username: "", password: "" });
  const { error, busy, send } = useSessionRequest();
  const field = bindField(form, setForm);

  const startSession: StartSession = (request) =>
    request.then(({ token, user }) => {
      saveSession(token, user);
      onSignedIn(user);
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    send(startSession(api.login(form.username.trim(), form.password)));
  }

  const showSignIn = () => setScreen("signin");
  if (screen === "forgot") return <ForgotPassword onBack={showSignIn} />;
  if (screen === "signup") return <SignUp onBack={showSignIn} startSession={startSession} />;

  return (
    <AuthForm
      subtitle="Sign in to your account"
      onSubmit={submit}
      alert={<Alert>{error}</Alert>}
      busy={busy}
      submitText="Sign in"
      busyText="Signing in..."
      footer={
        <>
          <p className="mt-4 text-center text-sm">
            <LinkButton onClick={() => setScreen("forgot")}>Forgot your password?</LinkButton>
          </p>
          <p className="mt-3 text-center text-sm text-slate-500">
            New patient? <LinkButton onClick={() => setScreen("signup")}>Create an account</LinkButton>
          </p>
        </>
      }
    >
      <TextField label="Username" {...field("username")} required autoFocus />
      <TextField label="Password" type="password" {...field("password")} required />
    </AuthForm>
  );
}