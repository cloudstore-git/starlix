import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Country, Empty, ErrorBox, Modal, PageHeader, Pagination, Spinner, StatusPill, Tabs } from '../components/ui';
import { post, qs } from '../lib/api';
import { date } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import { CustomersTable, AddCustomerButton } from './Customers';
import { CorrespondentsTable } from './Correspondents';
import { TxCard } from './Transactions';
import OnboardingPanel from './OnboardingPanel';

export function AddPspModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const results = useApi(`/registry/search${qs({ q })}`);
  const add = useAction(async (registrationNumber: string) => {
    const psp = await post('/psps', { registrationNumber });
    navigate(`/psps/${psp.id}`);
  });
  return (
    <Modal title="Add a PSP" onClose={onClose} wide>
      <p className="text-copy-xlight mb-3">Search the company registry (a stub of Companies House with fictional companies).</p>
      <input type="search" placeholder="Company name or number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ErrorBox error={add.error} />
      <table className="table-data mt-3">
        <tbody>
          {(results.data ?? []).map((r: any) => (
            <tr key={r.company.registrationNumber}>
              <td>
                <div className="font-medium">{r.company.name}</div>
                <div className="text-sm text-copy-2xlight">
                  {r.company.registrationNumber} · {r.company.registeredAddress?.city}
                </div>
              </td>
              <td className="text-right">
                <button className="btn-primary btn-small" disabled={add.busy} onClick={() => add.run(r.company.registrationNumber)}>
                  Add
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.data?.length === 0 && <Empty>No companies match</Empty>}
    </Modal>
  );
}

export default function Psps() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 0);
  const list = useApi(`/psps${qs({ q, status, page })}`);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };

  return (
    <>
      <PageHeader icon="icon-psp" title="PSPs">
        <button className="btn-primary" onClick={() => setAdding(true)}>
          Add PSP
        </button>
      </PageHeader>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="search" className="!w-72" placeholder="Search by name" value={q} onChange={(e) => set('q', e.target.value)} />
        <select className="!w-auto" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {['APPROVED', 'NOT_STARTED', 'WAITING_SIGNUP', 'PENDING', 'CHECKS_IN_PROGRESS', 'CHECKS_FAILED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'EXPIRING', 'EXPIRED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.loading ? (
          <div className="px-4"><Spinner /></div>
        ) : list.data?.items.length ? (
          <table className="table-data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>Registration number</th>
                <th>Customers</th>
                <th>Onboarding</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p: any) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/psps/${p.id}`)}>
                  <td className="font-medium">{p.name}</td>
                  <td><Country code={p.company?.jurisdiction} /></td>
                  <td>{p.company?.registrationNumber}</td>
                  <td>{p.customerCount}</td>
                  <td><StatusPill status={p.onboardingStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No PSPs yet</Empty>
        )}
        <Pagination page={list.data} onPage={(p) => set('page', String(p))} />
      </div>
      {adding && <AddPspModal onClose={() => setAdding(false)} />}
    </>
  );
}

export function CompanyTable({ company }: { company: any }) {
  if (!company) return null;
  const a = company.registeredAddress;
  return (
    <table className="vtable">
      <tbody>
        <tr><th>Name</th><td>{company.name}</td></tr>
        <tr><th>Jurisdiction</th><td><Country code={company.jurisdiction} /></td></tr>
        <tr><th>Registration number</th><td>{company.registrationNumber}</td></tr>
        {company.vatNumber && <tr><th>VAT number</th><td>{company.vatNumber}</td></tr>}
        {company.regulatorNumber && <tr><th>Regulator number</th><td>{company.regulatorNumber}</td></tr>}
        {a && (
          <tr>
            <th>Registered address</th>
            <td>
              {[a.addressLine1, a.addressLine2, a.city, a.postCode].filter(Boolean).join(', ')}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function PspDetail() {
  const { clientId, tab = 'overview' } = useParams();
  const { data, error, loading, reload } = useApi(`/clients/${clientId}`);
  if (loading) return <Spinner />;
  if (!data) return <ErrorBox error={error} />;
  const psp = data.client;
  const base = `/psps/${clientId}`;
  return (
    <>
      <PageHeader icon="icon-psp" title={psp.name} crumbs={[{ to: '/psps', label: 'PSPs' }]}>
        <StatusPill status={psp.onboardingStatus} />
      </PageHeader>
      <Tabs
        active={tab}
        tabs={[
          { key: 'overview', to: base, label: 'Overview' },
          { key: 'customers', to: `${base}/customers`, label: `Customers (${data.customerCount})` },
          { key: 'correspondents', to: `${base}/correspondents`, label: 'Correspondents' },
          { key: 'transactions', to: `${base}/transactions`, label: 'Transactions' },
          { key: 'onboarding', to: `${base}/onboarding`, label: 'Onboarding' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card title="Company">
            <CompanyTable company={psp.company} />
          </Card>
          <Card title="Onboarding" actions={<Link to={`${base}/onboarding`}>Open</Link>}>
            <table className="vtable">
              <tbody>
                <tr><th>Status</th><td><StatusPill status={psp.onboardingStatus} /></td></tr>
                <tr><th>Added</th><td>{date(psp.createdAt)}</td></tr>
                <tr><th>Customers</th><td>{data.customerCount}</td></tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {tab === 'customers' && <PspCustomers pspId={psp.id} />}
      {tab === 'correspondents' && <PspCorrespondents pspId={psp.id} />}
      {tab === 'transactions' && <TxCard title="Transactions" query={{ pspId: psp.id }} showPsp={false} />}
      {tab === 'onboarding' && <OnboardingPanel client={psp} onChange={reload} />}
    </>
  );
}

function PspCustomers({ pspId }: { pspId: string }) {
  const list = useApi(`/clients/${pspId}/customers?size=100`);
  return (
    <Card title="Customers" actions={<AddCustomerButton pspId={pspId} onAdded={list.reload} />}>
      {list.loading ? <Spinner /> : <CustomersTable items={list.data?.items ?? []} showPsp={false} />}
    </Card>
  );
}

function PspCorrespondents({ pspId }: { pspId: string }) {
  const list = useApi(`/correspondents?pspId=${pspId}&size=100`);
  return <Card title="Correspondents">{list.loading ? <Spinner /> : <CorrespondentsTable items={list.data?.items ?? []} showPsp={false} />}</Card>;
}
