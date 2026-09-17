/*
 * settings.tsx: the Settings page every signed-in user can open.
 * - My profile: edit first name, last name, phone and email.
 * - Change password: needs the current password. The server issues a new
 *   sign-in token, which is saved so the user stays signed in.
 * Success and error messages appear above each form.
 */

import { useState, type FormEvent } from "react";
import api, { saveSession, updateStoredUser } from "./api";
import type { User } from "./types";
import { Alert, Button, Card, NewPasswordField, TextField, TwoColumns, bindField, useSaving } from "./ui";

export interface SettingsProps {
  user: User;
  onSaved: (user: User) => void;
}

// Accounts without stored names fall back to their display name.
function namesFromDisplayName(user: User) {
  const [firstName = "", ...otherNames] = (user.display_name || "").split(" ");
  return { firstName, lastName: otherNames.join(" ") };
}

function ProfileCard({ user, onSaved }: SettingsProps) {
  const fallbackNames = namesFromDisplayName(user);
  const [profile, setProfile] = useState({
    first_name: user.first_name || fallbackNames.firstName,
    last_name: user.last_name || fallbackNames.lastName,
    email: user.email || "",
    phone: user.phone || "",
  });
  const note = useSaving(() => {});
  const field = bindField(profile, setProfile);

  function save(event: FormEvent) {
    event.preventDefault();
    const request = api.updateProfile(profile).then((updatedUser) => {
      updateStoredUser(updatedUser);
      onSaved(updatedUser);
    });
    note.run(request, "Your details were saved.");
  }

  return (
    <Card title="My profile" subtitle={`Signed in as ${user.username} (${user.role_label})`}>
      <Alert tone={note.tone}>{note.message}</Alert>
      <form onSubmit={save} className="max-w-lg">
        <TwoColumns>
          <TextField label="First name" {...field("first_name")} required />
          <TextField label="Last name" {...field("last_name")} />
        </TwoColumns>
        <TwoColumns>
          <TextField label="Phone" {...field("phone")} />
          <TextField label="Email" type="email" {...field("email")} />
        </TwoColumns>
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}

const EMPTY_PASSWORDS = { current_password: "", new_password: "" };

function PasswordCard({ user }: { user: User }) {
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const note = useSaving(() => {});
  const field = bindField(passwords, setPasswords);

  function save(event: FormEvent) {
    event.preventDefault();
    const request = api.changePassword(passwords).then(({ token }) => {
      // Changing the password revokes the old token and the server issues a new one.
      saveSession(token, user);
      setPasswords(EMPTY_PASSWORDS);
    });
    note.run(request, "Your new password was saved.");
  }

  return (
    <Card title="Change password" subtitle="You need your current password to set a new one">
      <Alert tone={note.tone}>{note.message}</Alert>
      <form onSubmit={save} className="max-w-lg">
        <TextField label="Current password" type="password" required {...field("current_password")} />
        <NewPasswordField label="New password" required {...field("new_password")} />
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}

export default function Settings({ user, onSaved }: SettingsProps) {
  return (
    <div>
      <ProfileCard user={user} onSaved={onSaved} />
      <PasswordCard user={user} />
    </div>
  );
}