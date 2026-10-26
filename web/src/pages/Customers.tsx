import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Country, CountrySelect, Empty, ErrorBox, Field, Icon, InfoBox, Modal, PageHeader, Pagination, Spinner, StatusPill, Tabs } from '../components/ui';
import { post, put, qs } from '../lib/api';
import { countryName } from '../lib/countries';
import { date, money } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Individual, TxSettings } from '../lib/types';
import { CompanyTable } from './Psps';
import { TxCard } from './Transactions';

export function CustomersTable({ items, showPsp = true }: { items: any[]; showPsp?: boolean }) {
  const navigate = useNavigate();
  if (!items.length) return <Empty>No customers</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Reference</th>
          {showPsp && <th>PSP</th>}
          <th>Country</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
            <td className="font-medium">
              <span className="inline-flex items-center gap-2">
                <Icon name={c.type === 'COMPANY' ? 'icon-company' : 'icon-individual'} className="w-4 h-4 bg-copy-xlight" />
                {c.name}
              </span>
            </td>
            <td>{c.type === 'COMPANY' ? 'Company' : 'Individual'}</td>
            <td>{c.uniqueReference}</td>
            {showPsp && <td>{c.pspName}</td>}
            <td><Country code={c.company?.jurisdiction ?? c.individual?.nationality} /></td>
            <td><StatusPill status={c.onboardingStatus} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const emptyIndividual = (): Individual => ({
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  nationality: 'GB',
  address: { addressLine1: '', city: '', postCode: '', countryCode: 'GB' },
});

export function IndividualFields({ value, onChange, disabled }: { value: Individual; onChange: (v: Individual) => void; disabled?: boolean }) {
  const set = (k: keyof Individual, v: any) => onChange({ ...value, [k]: v });
  const setAddr = (k: string, v: string) => onChange({ ...value, address: { ...(value.address ?? { addressLine1: '', city: '', postCode: '', countryCode: '' }), [k]: v } });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="First name"><input type="text" value={value.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} disabled={disabled} required /></Field>
      <Field label="Last name"><input type="text" value={value.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} disabled={disabled} required /></Field>
      <Field label="Date of birth"><input type="date" value={value.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} disabled={disabled} /></Field>
      <Field label="Nationality"><CountrySelect value={value.nationality} onChange={(v) => set('nationality', v)} disabled={disabled} /></Field>
      <Field label="Email"><input type="email" value={value.email ?? ''} onChange={(e) => set('email', e.target.value)} disabled={disabled} /></Field>
      <Field label="Phone"><input type="text" value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} disabled={disabled} /></Field>
      <Field label="Address line 1"><input type="text" value={value.address?.addressLine1 ?? ''} onChange={(e) => setAddr('addressLine1', e.target.value)} disabled={disabled} /></Field>
      <Field label="Address line 2"><input type="text" value={value.address?.addressLine2 ?? ''} onChange={(e) => setAddr('addressLine2', e.target.value)} disabled={disabled} /></Field>
      <Field label="City"><input type="text" value={value.address?.city ?? ''} onChange={(e) => setAddr('city', e.target.value)} disabled={disabled} /></Field>
      <Field label="Post code"><input type="text" value={value.address?.postCode ?? ''} onChange={(e) => setAddr('postCode', e.target.value)} disabled={disabled} /></Field>
      <Field label="Country"><CountrySelect value={value.address?.countryCode} onChange={(v) => setAddr('countryCode', v)} disabled={disabled} /></Field>
    </div>
  );
}

export function AddCustomerButton({ pspId, onAdded }: { pspId: string; onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'INDIVIDUAL' | 'COMPANY'>('INDIVIDUAL');
  const [individual, setIndividual] = useState<Individual>(emptyIndividual());
  const [reference, setReference] = useState('');
  const [q, setQ] = useState('');
  const registry = useApi(open && type === 'COMPANY' ? `/registry/search${qs({ q })}` : null);
  const navigate = useNavigate();
  const save = useAction(async (body: any) => {
    const c = await post(`/clients/${pspId}/customers`, { ...body, uniqueReference: reference || undefined });
    setOpen(false);
    onAdded?.();
    navigate(`/customers/${c.id}`);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run({ type: 'INDIVIDUAL', individual });
  };
  return (
    <>
      <button className="btn-primary btn-small" onClick={() => setOpen(true)}>Add customer</button>
      {open && (
        <Modal title="Add a customer" onClose={() => setOpen(false)} wide>
          <div className="flex gap-4 mb-4">
            {(['INDIVIDUAL', 'COMPANY'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 text-base text-copy">
                <input type="radio" checked={type === t} onChange={() => setType(t)} /> {t === 'INDIVIDUAL' ? 'Individual' : 'Company'}
              </label>
            ))}
          </div>
          <div className="mb-4 max-w-xs">
            <Field label="Your reference (optional)"><input type="text" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <ErrorBox error={save.error} />
          {type === 'INDIVIDUAL' ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <IndividualFields value={individual} onChange={setIndividual} />
              <div><button className="btn-primary" disabled={save.busy}>Add individual</button></div>
            </form>
          ) : (
            <>
              <input type="search" placeholder="Search the company registry" value={q} onChange={(e) => setQ(e.target.value)} />
              <table className="table-data mt-3">
                <tbody>
                  {(registry.data ?? []).map((r: any) => (
                    <tr key={r.company.registrationNumber}>
                      <td>
                        <div className="font-medium">{r.company.name}</div>
                        <div className="text-sm text-copy-2xlight">{r.company.registrationNumber}</div>
                      </td>
                      <td className="text-right">
                        <button className="btn-primary btn-small" disabled={save.busy} onClick={() => save.run({ type: 'COMPANY', registrationNumber: r.company.registrationNumber })}>Add</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export default function Customers() {
  const { me } = useSession();
  const isRoot = me?.client?.kind === 'ROOT';
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const pspId = params.get('pspId') ?? '';
  const page = Number(params.get('page') ?? 0);
  const list = useApi(`/customers${qs({ q, type, pspId, page })}`);
  const psps = useApi(isRoot ? '/psps?size=200' : null);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };
  return (
    <>
      <PageHeader icon="icon-clients" title="Customers">
        {!isRoot && me?.client && <AddCustomerButton pspId={me.client.id} onAdded={list.reload} />}
      </PageHeader>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="search" className="!w-72" placeholder="Search by name or reference" value={q} onChange={(e) => set('q', e.target.value)} />
        <select className="!w-auto" value={type} onChange={(e) => set('type', e.target.value)}>
          <option value="">Individuals and companies</option>
          <option value="INDIVIDUAL">Individuals</option>
          <option value="COMPANY">Companies</option>
        </select>
        {isRoot && (
          <select className="!w-auto" value={pspId} onChange={(e) => set('pspId', e.target.value)}>
            <option value="">All PSPs</option>
            {(psps.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.loading ? <div className="px-4"><Spinner /></div> : <CustomersTable items={list.data?.items ?? []} showPsp={isRoot} />}
        <Pagination page={list.data} onPage={(p) => set('page', String(p))} />
      </div>
    </>
  );
}

function SettingsView({ s, dir }: { s: TxSettings; dir: string }) {
  return (
    <table className="vtable">
      <tbody>
        <tr><th>Maximum {dir} amount</th><td>{money(s.maxTransactionAmount)}</td></tr>
        <tr><th>Documents required above</th><td>{money(s.requireDocsWhenGreaterThan)}</td></tr>
        <tr><th>Monthly total</th><td>{money(s.transactionTotalPerMonth)}</td></tr>
        <tr><th>Transactions per month</th><td>{s.transactionsPerMonth}</td></tr>
        <tr><th>Allowed bank countries</th><td>{s.jurisdictions.map(countryName).join(', ') || 'None'}</td></tr>
      </tbody>
    </table>
  );
}

const AMOUNT_STEPS = [5_000, 10_000, 20_000, 30_000, 50_000, 100_000, 200_000, 500_000, 1_000_000].map((n) => n * 100);

function AmountSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = AMOUNT_STEPS.includes(value) ? AMOUNT_STEPS : [...AMOUNT_STEPS, value].sort((a, b) => a - b);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((a) => <option key={a} value={a}>{money(a)}</option>)}
    </select>
  );
}

function SettingsForm({ client, dir, onSaved }: { client: any; dir: 'incoming' | 'outgoing'; onSaved: () => void }) {
  const [s, setS] = useState<TxSettings>(structuredClone(dir === 'incoming' ? client.incomingTxSettings : client.outgoingTxSettings));
  const [country, setCountry] = useState('');
  const [reprocess, setReprocess] = useState(true);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    await put(`/clients/${client.id}/tx-settings/${dir}`, { settings: s, reprocessTransactions: reprocess });
    setSaved(true);
    onSaved();
  });
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={`Maximum ${dir} transaction`}><AmountSelect value={s.maxTransactionAmount} onChange={(v) => setS({ ...s, maxTransactionAmount: v })} /></Field>
        <Field label="Require documents above"><AmountSelect value={s.requireDocsWhenGreaterThan} onChange={(v) => setS({ ...s, requireDocsWhenGreaterThan: v })} /></Field>
        <Field label="Monthly total"><AmountSelect value={s.transactionTotalPerMonth} onChange={(v) => setS({ ...s, transactionTotalPerMonth: v })} /></Field>
        <Field label="Transactions per month">
          <input type="number" min={0} value={s.transactionsPerMonth} onChange={(e) => setS({ ...s, transactionsPerMonth: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Allowed bank countries">
        <div className="flex flex-wrap gap-2 mb-2">
          {s.jurisdictions.map((j) => (
            <span key={j} className="inline-flex items-center gap-2 rounded-full bg-copy-5xlight px-3 py-1">
              <Country code={j} />
              <button onClick={() => setS({ ...s, jurisdictions: s.jurisdictions.filter((x) => x !== j) })} aria-label={`Remove ${j}`}>
                <Icon name="icon-x" className="w-3 h-3 bg-copy-xlight" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 max-w-md">
          <CountrySelect value={country} onChange={setCountry} />
          <button className="btn-secondary" disabled={!country} onClick={() => { setS({ ...s, jurisdictions: [...new Set([...s.jurisdictions, country])].sort() }); setCountry(''); }}>Add</button>
        </div>
      </Field>
      <label className="flex items-center gap-2 text-base text-copy">
        <input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} />
        Re-check this customer's existing transactions with the new limits
      </label>
      <ErrorBox error={save.error} />
      {saved && <InfoBox tone="success">Saved. Existing transactions are being re-checked.</InfoBox>}
      <div><button className="btn-primary" disabled={save.busy} onClick={() => save.run()}>{save.busy ? 'Saving…' : 'Save limits'}</button></div>
    </div>
  );
}

export function CustomerDetail() {
  const { clientId, tab = 'overview', dir } = useParams();
  const { data, error, loading, reload } = useApi(`/clients/${clientId}`);
  const [simulated, setSimulated] = useState<any>();
  const simulate = useAction(async (type: string) => setSimulated(await post('/transactions/simulate', { clientId, type })));
  if (loading) return <Spinner />;
  if (!data) return <ErrorBox error={error} />;
  const c = data.client;
  const base = `/customers/${clientId}`;
  const psp = data.chain.find((x: any) => x.id === c.parentClientId);
  const crumbs = [{ to: '/customers', label: 'Customers' }, ...(psp && psp.kind === 'PSP' ? [{ to: `/psps/${psp.id}`, label: psp.name }] : [])];
  return (
    <>
      <PageHeader icon={c.type === 'COMPANY' ? 'icon-company' : 'icon-individual'} title={c.name} crumbs={crumbs}>
        <StatusPill status={c.onboardingStatus} />
      </PageHeader>
      <Tabs
        active={tab}
        tabs={[
          { key: 'overview', to: base, label: 'Overview' },
          { key: 'settings', to: `${base}/settings/incoming`, label: 'Transaction limits' },
          { key: 'transactions', to: `${base}/transactions`, label: 'Transactions' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card title={c.type === 'COMPANY' ? 'Company' : 'Individual'}>
            {c.type === 'COMPANY' ? (
              <CompanyTable company={c.company} />
            ) : (
              <table className="vtable">
                <tbody>
                  <tr><th>Name</th><td>{c.name}</td></tr>
                  <tr><th>Date of birth</th><td>{c.individual?.dateOfBirth ? date(c.individual.dateOfBirth) : ''}</td></tr>
                  <tr><th>Nationality</th><td><Country code={c.individual?.nationality} /></td></tr>
                  <tr><th>Email</th><td>{c.individual?.email}</td></tr>
                  <tr><th>Reference</th><td>{c.uniqueReference}</td></tr>
                  {psp && <tr><th>PSP</th><td><Link to={`/psps/${psp.id}`}>{psp.name}</Link></td></tr>}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Simulate activity">
            <p className="text-copy-xlight mb-4">Creates a random transaction for this customer and runs it through the risk rules, as a PSP integration would.</p>
            <div className="flex gap-3">
              <button className="btn-secondary" disabled={simulate.busy} onClick={() => simulate.run('INCOMING')}>Simulate incoming</button>
              <button className="btn-secondary" disabled={simulate.busy} onClick={() => simulate.run('OUTGOING')}>Simulate outgoing</button>
            </div>
            <ErrorBox error={simulate.error} />
            {simulated && (
              <InfoBox tone={simulated.status === 'ON_HOLD' ? 'warning' : 'success'}>
                {money(simulated.sentAmount, simulated.sentCurrency)} {simulated.type.toLowerCase()} was {simulated.status === 'ON_HOLD' ? 'put on hold' : 'approved'}.{' '}
                <Link to={`/transactions/${simulated.id}`}>Open it</Link>
              </InfoBox>
            )}
          </Card>
          <Card title="Incoming limits" actions={<Link to={`${base}/settings/incoming`}>Edit</Link>}><SettingsView s={c.incomingTxSettings} dir="incoming" /></Card>
          <Card title="Outgoing limits" actions={<Link to={`${base}/settings/outgoing`}>Edit</Link>}><SettingsView s={c.outgoingTxSettings} dir="outgoing" /></Card>
        </div>
      )}
      {tab === 'settings' && (
        <Card
          title="Transaction limits"
          actions={
            <div className="flex gap-2">
              <Link className={dir === 'incoming' ? 'font-semibold' : ''} to={`${base}/settings/incoming`}>Incoming</Link>
              <span>·</span>
              <Link className={dir === 'outgoing' ? 'font-semibold' : ''} to={`${base}/settings/outgoing`}>Outgoing</Link>
            </div>
          }
        >
          <SettingsForm key={`${dir}-${c.id}`} client={c} dir={dir === 'outgoing' ? 'outgoing' : 'incoming'} onSaved={reload} />
        </Card>
      )}
      {tab === 'transactions' && <TxCard title="Transactions" query={{ clientId: c.id }} showCustomer={false} showPsp={false} />}
    </>
  );
}
