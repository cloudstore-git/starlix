import { FormEvent, useState } from 'react';
import { ErrorBox, Field, InfoBox, Modal, PageHeader, Spinner, StatusPill } from '../components/ui';
import { del, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

interface User {
  username: string;
  email: string;
  clientId?: string;
  clientName?: string;
  enabled: boolean;
  status: string;
  createdAt: string;
  groups: string[];
}

function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const accounts = useApi<{ id: string; name: string; clientId: string }[]>('/admin/accounts');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'USER'>('USER');
  const [clientId, setClientId] = useState('');
  const [created, setCreated] = useState<{ temporaryPassword?: string }>();
  const create = useAction(async () => {
    setCreated(await post('/admin/users', { email, role, clientId: role === 'USER' ? clientId : undefined }));
    onAdded();
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.run();
  };
  if (created) {
    return (
      <Modal title="User created" onClose={onClose}>
        <p className="mb-3">Cognito emailed {email} a temporary password. They choose a new one at first sign-in.</p>
        {created.temporaryPassword && (
          <InfoBox>
            For the demo it is also shown here: <span className="font-mono font-semibold">{created.temporaryPassword}</span>
          </InfoBox>
        )}
        <button className="btn-primary mt-3" onClick={onClose}>Done</button>
      </Modal>
    );
  }
  return (
    <Modal title="Add a user" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'USER')}>
            <option value="USER">User of a client</option>
            <option value="ADMIN">Platform admin</option>
          </select>
        </Field>
        {role === 'USER' && (
          <Field label="Client">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              <option value="">Choose a client</option>
              {(accounts.data ?? [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => (
                  <option key={a.id} value={a.clientId}>{a.name}</option>
                ))}
            </select>
          </Field>
        )}
        <ErrorBox error={create.error ?? accounts.error} />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={create.busy}>{create.busy ? 'Creating…' : 'Create user'}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const { me } = useSession();
  const list = useApi<User[]>('/admin/users');
  const [adding, setAdding] = useState(false);
  const act = useAction(async (u: User, action: 'enable' | 'disable' | 'delete') => {
    if (action === 'delete') {
      if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
      await del(`/admin/users/${encodeURIComponent(u.username)}`);
    } else {
      await post(`/admin/users/${encodeURIComponent(u.username)}/${action}`);
    }
    await list.reload();
  });
  const users = (list.data ?? []).slice().sort((a, b) => a.email.localeCompare(b.email));
  return (
    <>
      <PageHeader icon="icon-individual" title="Users">
        <button className="btn-primary" onClick={() => setAdding(true)}>Add user</button>
      </PageHeader>
      <ErrorBox error={list.error ?? act.error} />
      <div className="card">
        {list.loading ? (
          <div className="px-4"><Spinner /></div>
        ) : (
          <table className="table-data">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Client</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.email === me?.user.email;
                return (
                  <tr key={u.username}>
                    <td className="font-medium">{u.email}</td>
                    <td>{u.groups.includes('ADMIN') ? 'Admin' : 'User'}</td>
                    <td>{u.clientName ?? ''}</td>
                    <td><StatusPill status={u.enabled ? u.status : 'DISABLED'} /></td>
                    <td>{dateTime(u.createdAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      {!self && (
                        <div className="flex gap-2 justify-end">
                          <button className="btn-secondary btn-small" disabled={act.busy} onClick={() => act.run(u, u.enabled ? 'disable' : 'enable')}>
                            {u.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button className="btn-red btn-small" disabled={act.busy} onClick={() => act.run(u, 'delete')}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {adding && <AddUserModal onClose={() => setAdding(false)} onAdded={list.reload} />}
    </>
  );
}
