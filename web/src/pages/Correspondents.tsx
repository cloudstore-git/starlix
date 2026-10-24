import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Country, Empty, ErrorBox, FileList, PageHeader, Spinner, StatusPill } from '../components/ui';
import { date } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';
import { CompanyTable } from './Psps';

export function CorrespondentsTable({ items, showPsp = true }: { items: any[]; showPsp?: boolean }) {
  const navigate = useNavigate();
  if (!items.length) return <Empty>No correspondents</Empty>;
  return (
    <table className="table-data">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          {showPsp && <th>PSP</th>}
          <th>Country</th>
          <th>Licence expires</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/correspondents/${c.id}`)}>
            <td className="font-medium">{c.name}</td>
            <td>{c.type === 'BANK' ? 'Bank' : 'Partner PSP'}</td>
            {showPsp && <td>{c.pspName}</td>}
            <td><Country code={c.company.jurisdiction} /></td>
            <td className={c.licenseExpired ? 'text-red-700 font-medium' : ''}>{date(c.licenseExpires)}</td>
            <td><StatusPill status={c.licenseExpired ? 'LICENSE_EXPIRED' : c.onboardingStatus} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Correspondents() {
  const { me } = useSession();
  const list = useApi('/correspondents?size=200');
  return (
    <>
      <PageHeader icon="icon-correspondent" title="Correspondents" />
      <ErrorBox error={list.error} />
      <div className="card">
        {list.loading ? <div className="px-4"><Spinner /></div> : <CorrespondentsTable items={list.data?.items ?? []} showPsp={me?.client?.kind === 'ROOT'} />}
      </div>
    </>
  );
}

export function CorrespondentDetail() {
  const { correspondentId } = useParams();
  const { data, error, loading } = useApi(`/correspondents/${correspondentId}`);
  if (loading) return <Spinner />;
  if (!data) return <ErrorBox error={error} />;
  const c = data.correspondent;
  return (
    <>
      <PageHeader icon="icon-correspondent" title={c.name} crumbs={[{ to: '/correspondents', label: 'Correspondents' }]}>
        <StatusPill status={c.licenseExpired ? 'LICENSE_EXPIRED' : c.onboardingStatus} />
      </PageHeader>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Company"><CompanyTable company={c.company} /></Card>
        <Card title="Relationship">
          <table className="vtable">
            <tbody>
              <tr><th>Type</th><td>{c.type === 'BANK' ? 'Correspondent bank' : 'Partner PSP'}</td></tr>
              <tr><th>PSP</th><td><Link to={`/psps/${data.psp.id}`}>{data.psp.name}</Link></td></tr>
              <tr><th>Licence expires</th><td className={c.licenseExpired ? 'text-red-700 font-medium' : ''}>{date(c.licenseExpires)}{c.licenseExpired ? ' (expired)' : ''}</td></tr>
              {c.corridors?.length ? <tr><th>Corridors</th><td className="flex flex-col gap-1">{c.corridors.map((x: string) => <Country key={x} code={x} />)}</td></tr> : null}
              {c.iban && <tr><th>IBAN</th><td className="font-mono text-sm">{c.iban}</td></tr>}
              <tr><th>Licence documents</th><td><FileList files={c.licenseDocuments} /></td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
