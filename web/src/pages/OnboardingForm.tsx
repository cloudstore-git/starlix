import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Country, CountrySelect, Empty, ErrorBox, Field, FileUpload, Icon, InfoBox, PageHeader, Spinner, StatusPill } from '../components/ui';
import { post, put } from '../lib/api';
import { dateTime, label } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { useSession } from '../lib/session';
import { CHECK_LEVELS, Company, Entity, Individual } from '../lib/types';
import { IndividualFields } from './Customers';

const uid = () => crypto.randomUUID();

// ---------- Section editors ----------

interface EditorProps {
  data: any;
  disabled: boolean;
  onSave: (data: any) => Promise<void>;
  busy: boolean;
}

function SaveBar({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  if (disabled) return null;
  return (
    <div className="pt-4">
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
    </div>
  );
}

function CompanyFields({ value, onChange, disabled }: { value: Company; onChange: (c: Company) => void; disabled?: boolean }) {
  const set = (k: keyof Company, v: any) => onChange({ ...value, [k]: v });
  const addr = value.registeredAddress ?? { addressLine1: '', city: '', postCode: '', countryCode: value.jurisdiction ?? 'GB' };
  const setAddr = (k: string, v: string) => onChange({ ...value, registeredAddress: { ...addr, [k]: v } });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Company name"><input type="text" value={value.name ?? ''} onChange={(e) => set('name', e.target.value)} disabled={disabled} /></Field>
      <Field label="Jurisdiction"><CountrySelect value={value.jurisdiction} onChange={(v) => set('jurisdiction', v)} disabled={disabled} /></Field>
      <Field label="Registration number"><input type="text" value={value.registrationNumber ?? ''} onChange={(e) => set('registrationNumber', e.target.value)} disabled={disabled} /></Field>
      <Field label="VAT number"><input type="text" value={value.vatNumber ?? ''} onChange={(e) => set('vatNumber', e.target.value)} disabled={disabled} /></Field>
      <Field label="Regulator number"><input type="text" value={value.regulatorNumber ?? ''} onChange={(e) => set('regulatorNumber', e.target.value)} disabled={disabled} /></Field>
      <Field label="HMRC number"><input type="text" value={value.hmrcNumber ?? ''} onChange={(e) => set('hmrcNumber', e.target.value)} disabled={disabled} /></Field>
      <Field label="Registered address"><input type="text" value={addr.addressLine1 ?? ''} onChange={(e) => setAddr('addressLine1', e.target.value)} disabled={disabled} /></Field>
      <Field label="City"><input type="text" value={addr.city ?? ''} onChange={(e) => setAddr('city', e.target.value)} disabled={disabled} /></Field>
      <Field label="Post code"><input type="text" value={addr.postCode ?? ''} onChange={(e) => setAddr('postCode', e.target.value)} disabled={disabled} /></Field>
      <Field label="Country"><CountrySelect value={addr.countryCode} onChange={(v) => setAddr('countryCode', v)} disabled={disabled} /></Field>
    </div>
  );
}

function CompanySection({ data, disabled, onSave, busy }: EditorProps) {
  const [company, setCompany] = useState<Company>(data?.company ?? { name: '', jurisdiction: 'GB', registrationNumber: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ company }); }}>
      <CompanyFields value={company} onChange={setCompany} disabled={disabled} />
      <SaveBar disabled={disabled} busy={busy} />
    </form>
  );
}

const blankPerson = (): Individual => ({ firstName: '', lastName: '', dateOfBirth: '', email: '', nationality: 'GB', address: { addressLine1: '', city: '', postCode: '', countryCode: 'GB' } });

function PersonSection({ data, disabled, onSave, busy }: EditorProps) {
  const [individual, setIndividual] = useState<Individual>(data?.individual ?? blankPerson());
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ individual }); }}>
      <IndividualFields value={individual} onChange={setIndividual} disabled={disabled} />
      <SaveBar disabled={disabled} busy={busy} />
    </form>
  );
}

function EntityEditor({ onAdd, onCancel }: { onAdd: (e: Entity) => void; onCancel: () => void }) {
  const [type, setType] = useState<'INDIVIDUAL' | 'COMPANY'>('INDIVIDUAL');
  const [person, setPerson] = useState<Individual>(blankPerson());
  const [company, setCompany] = useState<Company>({ name: '', jurisdiction: 'GB', registrationNumber: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = uid();
    onAdd(type === 'INDIVIDUAL'
      ? { id, type, name: `${person.firstName} ${person.lastName}`.trim(), individual: person }
      : { id, type, name: company.name, company });
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-ring p-4 bg-page flex flex-col gap-4">
      <div className="flex gap-4">
        {(['INDIVIDUAL', 'COMPANY'] as const).map((t) => (
          <label key={t} className="flex items-center gap-2 text-base text-copy">
            <input type="radio" checked={type === t} onChange={() => setType(t)} /> {t === 'INDIVIDUAL' ? 'Person' : 'Company'}
          </label>
        ))}
      </div>
      {type === 'INDIVIDUAL' ? <IndividualFields value={person} onChange={setPerson} /> : <CompanyFields value={company} onChange={setCompany} />}
      <div className="flex gap-3">
        <button className="btn-primary">Add</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EntityName({ e }: { e: Entity }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon name={e.type === 'COMPANY' ? 'icon-company' : 'icon-individual'} className="w-4 h-4 bg-copy-xlight" />
      <span className="font-medium">{e.name}</span>
      <Country code={e.type === 'COMPANY' ? e.company?.jurisdiction : e.individual?.nationality} />
    </span>
  );
}

function DirectorsSection({ data, disabled, onSave, busy }: EditorProps) {
  const [directors, setDirectors] = useState<any[]>(data?.directors ?? []);
  const [adding, setAdding] = useState(false);
  const update = (id: string, patch: any) => setDirectors(directors.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-4">
      {directors.length ? (
        <table className="table-data">
          <thead><tr><th>Director</th><th>Shareholder</th><th>Beneficial owner</th><th>Source</th><th /></tr></thead>
          <tbody>
            {directors.map((d) => (
              <tr key={d.id}>
                <td><EntityName e={d.entity} /></td>
                <td><input type="checkbox" checked={!!d.shareholder} disabled={disabled} onChange={(e) => update(d.id, { shareholder: e.target.checked })} /></td>
                <td><input type="checkbox" checked={!!d.beneficialOwner} disabled={disabled} onChange={(e) => update(d.id, { beneficialOwner: e.target.checked })} /></td>
                <td className="text-sm text-copy-xlight">{d.source}</td>
                <td className="text-right">{!disabled && <button className="text-link text-sm" onClick={() => setDirectors(directors.filter((x) => x.id !== d.id))}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No directors yet</Empty>
      )}
      {!disabled && (adding ? (
        <EntityEditor onCancel={() => setAdding(false)} onAdd={(entity) => { setDirectors([...directors, { id: uid(), entity, shareholder: false, beneficialOwner: false, source: 'Entered manually' }]); setAdding(false); }} />
      ) : (
        <div><button className="btn-secondary" onClick={() => setAdding(true)}>Add director</button></div>
      ))}
      <p className="text-sm text-copy-xlight">Ticking "Shareholder" also adds the director to the Shareholders section.</p>
      {!disabled && <div><button className="btn-primary" disabled={busy} onClick={() => onSave({ directors })}>{busy ? 'Saving…' : 'Save and continue'}</button></div>}
    </div>
  );
}

function ShareholdersSection({ data, disabled, onSave, busy }: EditorProps) {
  const [shareholders, setShareholders] = useState<any[]>(data?.shareholders ?? []);
  const [adding, setAdding] = useState(false);
  useEffect(() => setShareholders(data?.shareholders ?? []), [data]);
  return (
    <div className="flex flex-col gap-4">
      {shareholders.length ? (
        <table className="table-data">
          <thead><tr><th>Shareholder</th><th>Share %</th><th>Source</th><th /></tr></thead>
          <tbody>
            {shareholders.map((s) => (
              <tr key={s.id}>
                <td><EntityName e={s.entity} /></td>
                <td className="w-32">
                  <input type="number" min={0} max={100} value={s.sharePercent ?? ''} disabled={disabled}
                    onChange={(e) => setShareholders(shareholders.map((x) => (x.id === s.id ? { ...x, sharePercent: e.target.value === '' ? undefined : Number(e.target.value) } : x)))} />
                </td>
                <td className="text-sm text-copy-xlight">{s.directorId ? 'Also a director' : s.source}</td>
                <td className="text-right">{!disabled && !s.directorId && <button className="text-link text-sm" onClick={() => setShareholders(shareholders.filter((x) => x.id !== s.id))}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No shareholders yet</Empty>
      )}
      {!disabled && (adding ? (
        <EntityEditor onCancel={() => setAdding(false)} onAdd={(entity) => { setShareholders([...shareholders, { id: uid(), entity, source: 'Entered manually' }]); setAdding(false); }} />
      ) : (
        <div><button className="btn-secondary" onClick={() => setAdding(true)}>Add shareholder</button></div>
      ))}
      {!disabled && <div><button className="btn-primary" disabled={busy} onClick={() => onSave({ shareholders })}>{busy ? 'Saving…' : 'Save and continue'}</button></div>}
    </div>
  );
}

function FieldsSection({ data, disabled, onSave, busy, fields, filesKey, filesLabel }: EditorProps & { fields: { key: string; label: string; type?: string }[]; filesKey?: string; filesLabel?: string }) {
  const [v, setV] = useState<any>(data ?? {});
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(v); }} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === 'textarea' ? (
              <textarea rows={4} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} disabled={disabled} />
            ) : (
              <input type={f.type ?? 'text'} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} disabled={disabled} />
            )}
          </Field>
        ))}
      </div>
      {filesKey && (
        <Field label={filesLabel ?? 'Documents'}>
          <FileUpload files={v[filesKey] ?? []} onChange={(files) => setV({ ...v, [filesKey]: files })} disabled={disabled} />
        </Field>
      )}
      <SaveBar disabled={disabled} busy={busy} />
    </form>
  );
}

function SectionEditor({ name, ...props }: EditorProps & { name: string }) {
  switch (name) {
    case 'company-information':
      return <CompanySection {...props} />;
    case 'primary-contact':
    case 'mlro':
      return <PersonSection {...props} />;
    case 'directors':
      return <DirectorsSection {...props} />;
    case 'shareholders':
      return <ShareholdersSection {...props} />;
    case 'licensing-information':
      return <FieldsSection {...props} fields={[{ key: 'regulator', label: 'Regulator' }, { key: 'licenseNumber', label: 'Licence number' }, { key: 'licenseExpires', label: 'Licence expires', type: 'date' }]} filesKey="licensingDocuments" filesLabel="Licence documents" />;
    case 'independent-audit':
      return <FieldsSection {...props} fields={[{ key: 'conductedBy', label: 'Conducted by' }, { key: 'auditDate', label: 'Audit date', type: 'date' }]} filesKey="auditFiles" filesLabel="Audit report" />;
    case 'banking-details':
      return <FieldsSection {...props} fields={[{ key: 'accountName', label: 'Account name' }, { key: 'accountNumber', label: 'Account number' }, { key: 'sortCode', label: 'Sort code' }, { key: 'iban', label: 'IBAN (optional)' }]} />;
    default:
      return <FieldsSection {...props} fields={[{ key: 'comment', label: 'Comment', type: 'textarea' }]} filesKey="files" filesLabel="Documents" />;
  }
}

// ---------- Synthetic pages: checks, notes, submit, review ----------

function ChecksPage({ formId, status }: { formId: string; status: string }) {
  const { data, loading } = useApi(`/onboarding/${formId}/checks`, { pollMs: status === 'CHECKS_IN_PROGRESS' ? 2000 : undefined });
  if (loading) return <Spinner />;
  if (!data?.length) return <Empty>Checks run when the form is submitted.</Empty>;
  return (
    <table className="table-data">
      <thead><tr><th>Entity</th><th>Section</th><th>Level</th><th>Status</th><th>Result</th></tr></thead>
      <tbody>
        {data.map((c: any) => (
          <tr key={c.id}>
            <td><EntityName e={c.entity} /></td>
            <td>{label(c.sectionName.replace(/-/g, '_'))}</td>
            <td>{CHECK_LEVELS[c.level as keyof typeof CHECK_LEVELS]?.label} <span className="text-sm text-copy-2xlight">({CHECK_LEVELS[c.level as keyof typeof CHECK_LEVELS]?.checkTypes.join(', ')})</span></td>
            <td><StatusPill status={c.status} /></td>
            <td className="text-sm text-copy-light">{c.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NotesPage({ formId, notes, sections, onAdded }: { formId: string; notes: any[]; sections: any[]; onAdded: () => void }) {
  const [comment, setComment] = useState('');
  const [rel, setRel] = useState<string[]>([]);
  const add = useAction(async () => {
    await post(`/onboarding/${formId}/notes`, { comment, relevantSectionNames: rel });
    setComment('');
    setRel([]);
    onAdded();
  });
  const labelOf = (n: string) => sections.find((s) => s.requirement.sectionName === n)?.requirement.sectionLabel ?? n;
  return (
    <div className="flex flex-col gap-6">
      {notes.length ? (
        <ul className="flex flex-col gap-4">
          {[...notes].reverse().map((n, i) => (
            <li key={i} className="rounded-lg border border-ring bg-white px-4 py-3">
              <div className="text-sm text-copy-xlight mb-1">{n.authorEmail} · {dateTime(n.timestamp)}</div>
              <div className="whitespace-pre-wrap">{n.comment}</div>
              {n.relevantSectionNames?.length ? <div className="text-sm text-copy-2xlight mt-1">About: {n.relevantSectionNames.map(labelOf).join(', ')}</div> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No notes yet</Empty>
      )}
      <div className="flex flex-col gap-3">
        <textarea rows={3} placeholder="Add a note for everyone working on this onboarding" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex flex-wrap gap-3">
          {sections.map((s) => (
            <label key={s.requirement.sectionName} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rel.includes(s.requirement.sectionName)} onChange={(e) => setRel(e.target.checked ? [...rel, s.requirement.sectionName] : rel.filter((x) => x !== s.requirement.sectionName))} />
              {s.requirement.sectionLabel}
            </label>
          ))}
        </div>
        <ErrorBox error={add.error} />
        <div><button className="btn-primary" disabled={!comment.trim() || add.busy} onClick={() => add.run()}>Add note</button></div>
      </div>
    </div>
  );
}

function SubmitPage({ view, onSubmitted }: { view: any; onSubmitted: () => void }) {
  const submit = useAction(async () => {
    await post(`/onboarding/${view.form.id}/submit`);
    onSubmitted();
  });
  const incomplete = view.sections.filter((s: any) => s.missing.length);
  const checkCount = view.sections.filter((s: any) => s.requirement.checkLevels.length).length;
  return (
    <div className="flex flex-col gap-4">
      {incomplete.length ? (
        <InfoBox tone="warning">
          <div className="font-medium mb-1">These sections still need information:</div>
          <ul className="list-disc ml-5">
            {incomplete.map((s: any) => (
              <li key={s.requirement.sectionName}>
                <Link to={`/onboarding/${view.form.id}/${s.requirement.sectionName}`}>{s.requirement.sectionLabel}</Link>
                <span className="text-sm text-copy-xlight"> missing {s.missing.join(', ')}</span>
              </li>
            ))}
          </ul>
        </InfoBox>
      ) : (
        <InfoBox tone="success">Every section is complete.</InfoBox>
      )}
      <p className="text-copy-light">
        Submitting runs the identity and company checks on {checkCount} section{checkCount === 1 ? '' : 's'} (stubbed providers).
        {view.form.inviteEmail ? ' After the checks, the onboarding goes to review.' : ' If every check passes, the onboarding is approved.'}
      </p>
      <ErrorBox error={submit.error} />
      <div><button className="btn-primary" disabled={!!incomplete.length || submit.busy || !view.permissions.canEdit} onClick={() => submit.run()}>{submit.busy ? 'Submitting…' : 'Submit onboarding'}</button></div>
    </div>
  );
}

function ReviewPage({ view, onDone }: { view: any; onDone: () => void }) {
  const [note, setNote] = useState('');
  const review = useAction(async (result: string) => {
    await post(`/onboarding/${view.form.id}/review`, { result, note });
    onDone();
  });
  if (!view.permissions.canReview) return <Empty>This onboarding is not waiting for your review.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      {view.form.status === 'CHECKS_FAILED' && <InfoBox tone="warning">Some checks failed. See the <Link to={`/onboarding/${view.form.id}/checks`}>checks</Link> before you decide.</InfoBox>}
      <Field label="Note (shared with the PSP)"><textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorBox error={review.error} />
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" disabled={review.busy} onClick={() => review.run('APPROVE')}>Approve</button>
        <button className="btn-secondary" disabled={review.busy} onClick={() => review.run('REQUEST_CHANGES')}>Request changes</button>
        <button className="btn-red" disabled={review.busy} onClick={() => review.run('REJECT')}>Reject</button>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function OnboardingForm() {
  const { formId, section } = useParams();
  const navigate = useNavigate();
  const { me, refresh: refreshMe } = useSession();
  const { data: view, error, loading, reload } = useApi(`/onboarding/${formId}`, { pollMs: undefined });
  const [saved, setSaved] = useState<string>();
  const save = useAction(async (name: string, data: any) => {
    await put(`/onboarding/${formId}/sections/${name}`, { data });
    await reload();
    setSaved(name);
    const names = view.sections.map((s: any) => s.requirement.sectionName);
    const next = names[names.indexOf(name) + 1];
    navigate(`/onboarding/${formId}/${next ?? 'submit'}`);
  });

  useEffect(() => setSaved(undefined), [section]);
  // Keep the status fresh while checks run
  useEffect(() => {
    if (view?.form.status !== 'CHECKS_IN_PROGRESS') return;
    const t = setInterval(async () => {
      await reload();
    }, 2500);
    return () => clearInterval(t);
  }, [view?.form.status, reload]);
  useEffect(() => {
    // An invited PSP leaves the onboarding-only view once approved
    if (view?.permissions.isSelfOnboarding && ['APPROVED'].includes(view.form.status) && me?.onboardingRequired) refreshMe();
  }, [view?.form.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />;
  if (!view) return <ErrorBox error={error} />;
  const { form, sections, permissions } = view;
  const current = section ?? sections[0]?.requirement.sectionName;
  const currentSection = sections.find((s: any) => s.requirement.sectionName === current);
  const isSelf = permissions.isSelfOnboarding;
  const crumbs = isSelf ? [] : [{ to: '/psps', label: 'PSPs' }, { to: `/psps/${form.clientId}/onboarding`, label: form.clientName }];

  const navItem = (key: string, text: string, done?: boolean) => (
    <Link
      key={key}
      to={`/onboarding/${form.id}/${key}`}
      className={`flex items-center gap-2 rounded-md px-3 py-2 hover:no-underline ${current === key ? 'bg-primary-5xlight text-primary font-medium' : 'text-copy-light hover:bg-copy-5xlight'}`}
    >
      {done === undefined ? <span className="w-4" /> : done ? <Icon name="icon-greentick" className="w-4 h-4 bg-green-700" /> : <span className="w-4 h-4 rounded-full border-2 border-copy-4xlight" />}
      <span className="truncate">{text}</span>
    </Link>
  );

  return (
    <>
      <PageHeader icon="icon-list" title={`Onboarding: ${form.clientName}`} crumbs={crumbs}>
        <StatusPill status={form.status} />
      </PageHeader>
      {form.status === 'CHANGES_REQUESTED' && <InfoBox tone="warning">Changes were requested. See the <Link to={`/onboarding/${form.id}/notes`}>notes</Link>, update the sections and submit again.</InfoBox>}
      {form.status === 'CHECKS_IN_PROGRESS' && <InfoBox>Checks are running. This page updates by itself.</InfoBox>}
      {form.status === 'WAITING_SIGNUP' && <InfoBox>Waiting for {form.inviteEmail} to sign in and fill in the form.</InfoBox>}
      {isSelf && form.status === 'IN_REVIEW' && <InfoBox>Thank you. Your onboarding is with the compliance team for review.</InfoBox>}
      {permissions.canReview && current !== 'review' && <InfoBox tone="warning">This onboarding is waiting for your review. <Link to={`/onboarding/${form.id}/review`}>Review it</Link></InfoBox>}

      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="lg:w-72 shrink-0 card p-3 flex flex-col gap-1 self-start">
          {sections.map((s: any) => navItem(s.requirement.sectionName, s.requirement.sectionLabel, s.missing.length === 0))}
          <div className="border-t border-separator my-2" />
          {navItem('checks', 'Checks')}
          {navItem('notes', `Notes (${view.notes.length})`)}
          {permissions.canEdit && navItem('submit', 'Submit')}
          {permissions.canReview && navItem('review', 'Review')}
        </nav>
        <div className="flex-1 min-w-0">
          <Card title={currentSection?.requirement.sectionLabel ?? label(current)}>
            {saved && saved === current && <InfoBox tone="success">Saved.</InfoBox>}
            <ErrorBox error={save.error} />
            {currentSection ? (
              <>
                {currentSection.missing.length > 0 && !permissions.canEdit && <p className="text-sm text-copy-xlight mb-3">Not filled in yet.</p>}
                <SectionEditor
                  key={`${current}-${currentSection.updatedAt}`}
                  name={current}
                  data={currentSection.data}
                  disabled={!permissions.canEdit}
                  busy={save.busy}
                  onSave={async (d) => { await save.run(current, d); }}
                />
              </>
            ) : current === 'checks' ? (
              <ChecksPage formId={form.id} status={form.status} />
            ) : current === 'notes' ? (
              <NotesPage formId={form.id} notes={view.notes} sections={sections} onAdded={reload} />
            ) : current === 'submit' ? (
              <SubmitPage view={view} onSubmitted={async () => { await reload(); navigate(`/onboarding/${form.id}/checks`); }} />
            ) : current === 'review' ? (
              <ReviewPage view={view} onDone={async () => { await reload(); navigate(`/psps/${form.clientId}/onboarding`); }} />
            ) : (
              <Empty>Unknown section</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Landing page for an invited PSP user: shows their own form. */
export function MyOnboarding() {
  const { me } = useSession();
  const navigate = useNavigate();
  const { data, loading, error } = useApi(me?.client ? `/clients/${me.client.id}/onboarding` : null);
  useEffect(() => {
    if (data?.form) navigate(`/onboarding/${data.form.id}`, { replace: true });
  }, [data, navigate]);
  if (loading) return <Spinner />;
  return (
    <>
      <PageHeader icon="icon-list" title="Onboarding" />
      <ErrorBox error={error} />
      {!data?.form && <Empty>There is no onboarding for {me?.client?.name} yet.</Empty>}
    </>
  );
}
