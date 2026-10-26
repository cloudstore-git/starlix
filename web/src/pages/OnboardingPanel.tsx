import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBox, Field, Icon, InfoBox, Spinner, StatusPill } from '../components/ui';
import { post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { CHECK_LEVELS, ChecksLevel, Client, EntityType } from '../lib/types';

/** Mirrors services/domain/onboarding.ts SECTIONS. */
export const SECTION_DEFS: { name: string; label: string; entityTypes: EntityType[]; defaults: ChecksLevel[] }[] = [
  { name: 'company-information', label: 'Company information', entityTypes: ['COMPANY'], defaults: ['COMPANY_STANDARD'] },
  { name: 'primary-contact', label: 'Primary contact', entityTypes: ['INDIVIDUAL'], defaults: ['INDIVIDUAL_STANDARD'] },
  { name: 'mlro', label: 'Money Laundering Reporting Officer', entityTypes: ['INDIVIDUAL'], defaults: ['INDIVIDUAL_ENHANCED'] },
  { name: 'directors', label: 'Directors', entityTypes: ['INDIVIDUAL', 'COMPANY'], defaults: ['INDIVIDUAL_STANDARD', 'COMPANY_BASIC'] },
  { name: 'shareholders', label: 'Shareholders', entityTypes: ['INDIVIDUAL', 'COMPANY'], defaults: ['INDIVIDUAL_BASIC', 'COMPANY_BASIC'] },
  { name: 'licensing-information', label: 'Licensing information', entityTypes: [], defaults: [] },
  { name: 'independent-audit', label: 'Independent audit', entityTypes: [], defaults: [] },
  { name: 'banking-details', label: 'Banking details', entityTypes: [], defaults: [] },
];

const TYPE_SECTIONS: Record<string, string[]> = {
  REGULATED: SECTION_DEFS.map((s) => s.name),
  NON_REGULATED: ['company-information', 'primary-contact', 'directors', 'shareholders', 'banking-details'],
};

const levelsFor = (t: EntityType) => (Object.keys(CHECK_LEVELS) as ChecksLevel[]).filter((l) => CHECK_LEVELS[l].entityType === t);

function StartOnboarding({ client, onStarted }: { client: Client; onStarted: () => void }) {
  const [type, setType] = useState<'REGULATED' | 'NON_REGULATED'>('REGULATED');
  const [sections, setSections] = useState<string[]>(TYPE_SECTIONS.REGULATED);
  const [checks, setChecks] = useState<Record<string, ChecksLevel[]>>(Object.fromEntries(SECTION_DEFS.map((s) => [s.name, s.defaults])));
  const [custom, setCustom] = useState<string[]>([]);
  const [customName, setCustomName] = useState('');
  const [expires, setExpires] = useState(12);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [prefill, setPrefill] = useState(true);
  const [invited, setInvited] = useState<{ email: string; temporaryPassword?: string }>();

  const start = useAction(async () => {
    const form = await post(`/clients/${client.id}/onboarding`, {
      onboardingType: type,
      sectionNames: sections,
      sectionChecks: checks,
      customSections: custom,
      expiresMonths: expires,
      invite,
      inviteEmail: invite ? email : undefined,
      prefill,
    });
    if (invite) {
      try {
        setInvited(await post('/invites', { clientId: client.id, email }));
      } catch (e: any) {
        setInvited({ email });
        throw new Error(`Onboarding started, but the login could not be created: ${e.message}`);
      }
    }
    if (!invite) onStarted();
    return form;
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.run();
  };

  if (invited) {
    return (
      <Card title="Invitation sent">
        <p className="mb-3">
          {client.name} can now sign in as <b>{invited.email}</b> and fill in its onboarding.
        </p>
        {invited.temporaryPassword && (
          <InfoBox>
            Cognito emailed a temporary password. For the demo it is also shown here: <span className="font-mono font-semibold">{invited.temporaryPassword}</span>
          </InfoBox>
        )}
        <ErrorBox error={start.error} />
        <button className="btn-primary" onClick={onStarted}>Continue</button>
      </Card>
    );
  }

  return (
    <Card title={`Start onboarding for ${client.name}`}>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex gap-6">
          {(['REGULATED', 'NON_REGULATED'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2 text-base text-copy">
              <input
                type="radio"
                checked={type === t}
                onChange={() => {
                  setType(t);
                  setSections(TYPE_SECTIONS[t]);
                }}
              />
              {t === 'REGULATED' ? 'Regulated entity' : 'Non-regulated entity'}
            </label>
          ))}
        </div>

        <div>
          <h4 className="mb-2">Sections and checks</h4>
          <table className="table-data">
            <thead>
              <tr>
                <th>Section</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {SECTION_DEFS.map((s) => {
                const on = sections.includes(s.name);
                return (
                  <tr key={s.name}>
                    <td>
                      <label className="flex items-center gap-2 text-base text-copy">
                        <input type="checkbox" checked={on} onChange={(e) => setSections(e.target.checked ? [...sections, s.name] : sections.filter((x) => x !== s.name))} />
                        {s.label}
                      </label>
                    </td>
                    <td>
                      {s.entityTypes.length === 0 ? (
                        <span className="text-copy-2xlight text-sm">Documents only</span>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          {s.entityTypes.map((et) => {
                            const current = checks[s.name]?.find((l) => CHECK_LEVELS[l].entityType === et) ?? '';
                            return (
                              <label key={et} className="flex items-center gap-2">
                                <span>{et === 'COMPANY' ? 'Companies' : 'People'}</span>
                                <select
                                  className="!w-auto !py-1"
                                  disabled={!on}
                                  value={current}
                                  onChange={(e) => {
                                    const others = (checks[s.name] ?? []).filter((l) => CHECK_LEVELS[l].entityType !== et);
                                    setChecks({ ...checks, [s.name]: e.target.value ? [...others, e.target.value as ChecksLevel] : others });
                                  }}
                                >
                                  <option value="">No checks</option>
                                  {levelsFor(et).map((l) => (
                                    <option key={l} value={l}>
                                      {CHECK_LEVELS[l].label} ({CHECK_LEVELS[l].checkTypes.join(', ')})
                                    </option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {custom.map((c) => (
                <tr key={c}>
                  <td className="flex items-center gap-2">
                    <Icon name="icon-file" className="w-4 h-4 bg-copy-xlight" /> {c}
                  </td>
                  <td>
                    <button type="button" className="text-link text-sm" onClick={() => setCustom(custom.filter((x) => x !== c))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-3 max-w-md">
            <input type="text" placeholder="Extra document request, e.g. AML policy" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            <button type="button" className="btn-secondary" disabled={!customName.trim()} onClick={() => { setCustom([...custom, customName.trim()]); setCustomName(''); }}>
              Add
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <Field label="Onboarding valid for">
            <select value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
              {[6, 12, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}
            </select>
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-base text-copy">
            <input type="checkbox" checked={prefill} onChange={(e) => setPrefill(e.target.checked)} /> Prefill company details and directors from the registry
          </label>
          <label className="flex items-center gap-2 text-base text-copy">
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Invite {client.name} to fill this in themselves
          </label>
          {invite && (
            <div className="max-w-md">
              <Field label="Their email" hint="They get a Starlix login and see only their own onboarding until it is approved.">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
            </div>
          )}
        </div>

        <ErrorBox error={start.error} />
        <div>
          <button className="btn-primary" disabled={start.busy || !sections.length}>
            {start.busy ? 'Starting…' : invite ? 'Start and invite' : 'Start onboarding'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** The onboarding tab of a PSP, seen by the client above it. */
export default function OnboardingPanel({ client, onChange }: { client: Client; onChange?: () => void }) {
  const { data, loading, error, reload } = useApi(`/clients/${client.id}/onboarding`);
  const [restart, setRestart] = useState(false);
  if (loading) return <Spinner />;
  const form = data?.form;
  const refresh = async () => {
    setRestart(false);
    await reload();
    onChange?.();
  };
  if (!form || restart) return <StartOnboarding client={client} onStarted={refresh} />;
  const reopenable = ['APPROVED', 'EXPIRING', 'EXPIRED', 'REJECTED'].includes(form.status);
  return (
    <Card
      title="Onboarding"
      actions={
        <>
          {reopenable && (
            <button className="btn-secondary btn-small" onClick={() => setRestart(true)}>
              Start a new onboarding
            </button>
          )}
          <Link className="btn-primary btn-small" to={`/onboarding/${form.id}`}>
            Open form
          </Link>
        </>
      }
    >
      <ErrorBox error={error} />
      <table className="vtable">
        <tbody>
          <tr><th>Status</th><td><StatusPill status={form.status} /></td></tr>
          <tr><th>Type</th><td>{form.onboardingType === 'REGULATED' ? 'Regulated' : 'Non-regulated'}</td></tr>
          <tr><th>Filled in by</th><td>{form.inviteEmail ? `${client.name} (${form.inviteEmail})` : 'Your team'}</td></tr>
          <tr><th>Started</th><td>{dateTime(form.createdAt)}</td></tr>
          {form.submittedAt && <tr><th>Submitted</th><td>{dateTime(form.submittedAt)}</td></tr>}
          {form.approvedAt && <tr><th>Approved</th><td>{dateTime(form.approvedAt)}</td></tr>}
          <tr><th>Sections</th><td>{data.sections.filter((s: any) => s.missing.length === 0).length} of {data.sections.length} complete</td></tr>
        </tbody>
      </table>
      {data.permissions.canReview && <InfoBox tone="warning">This onboarding is waiting for your review. <Link to={`/onboarding/${form.id}/review`}>Review it</Link></InfoBox>}
    </Card>
  );
}
