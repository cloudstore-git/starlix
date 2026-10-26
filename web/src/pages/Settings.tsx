import { FormEvent, useState } from 'react';
import { Card, ErrorBox, Field, InfoBox, PageHeader } from '../components/ui';
import { changePassword } from '../lib/auth';
import { useAction } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function Settings() {
  const { me } = useSession();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const change = useAction(async () => {
    if (newPassword !== repeat) throw new Error('The new passwords do not match');
    await changePassword(oldPassword, newPassword);
    setOld('');
    setNew('');
    setRepeat('');
    setDone(true);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    change.run();
  };
  return (
    <>
      <PageHeader icon="icon-settings" title="Settings" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Profile">
          <table className="vtable">
            <tbody>
              <tr><th>Email</th><td>{me?.user.email}</td></tr>
              <tr><th>Role</th><td>{me?.user.isAdmin ? 'Platform admin' : 'User'}</td></tr>
              {me?.client && <tr><th>Organisation</th><td>{me.client.name}</td></tr>}
              {me?.account && <tr><th>Account</th><td>{me.account.name}</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="flex flex-col gap-4 max-w-md">
            <Field label="Current password">
              <input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 12 characters with upper and lower case letters, a number and a symbol.">
              <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required minLength={12} autoComplete="new-password" />
            </Field>
            <Field label="Repeat new password">
              <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required autoComplete="new-password" />
            </Field>
            <ErrorBox error={change.error} />
            {done && <InfoBox tone="success">Your password has been changed.</InfoBox>}
            <div>
              <button className="btn-primary" disabled={change.busy}>{change.busy ? 'Saving…' : 'Change password'}</button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
