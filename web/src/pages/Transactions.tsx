import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Empty, ErrorBox, Icon, PageHeader, Pagination, Spinner, StatusPill } from '../components/ui';
import { qs } from '../lib/api';
import { countryName } from '../lib/countries';
import { dateTime, money } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export function counterpartyName(t: any): string {
  return t.type === 'INCOMING' ? (t.sender?.name ?? '') : (t.beneficiary?.name ?? '');
}

export function counterpartyCountry(t: any): string | undefined {
  return t.type === 'INCOMING' ? t.senderBank?.jurisdiction : (t.beneficiaryBank?.jurisdiction ?? t.beneficiary?.individual?.nationality);
}

export function TransactionsTable({ items, showPsp = true, showCustomer = true }: { items: any[]; showPsp?: boolean; showCustomer?: boolean }) {
  const navigate = useNavigate();
  if (!items.length) return <Empty>No transactions</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table-data">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            {showCustomer && <th>Customer</th>}
            {showPsp && <th>PSP</th>}
            <th>Counterparty</th>
            <th className="text-right">Amount</th>
            <th>Status</th>
            <th>Risks</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`/transactions/${t.id}`)}>
              <td className="whitespace-nowrap">{dateTime(t.timestamp)}</td>
              <td>
                <span className="inline-flex items-center gap-2">
                  <Icon name={`icon-tx-${t.type}`} className={`w-4 h-4 ${t.type === 'INCOMING' ? 'bg-green-700' : 'bg-blue-700'}`} />
                  {t.type === 'INCOMING' ? 'In' : 'Out'}
                </span>
              </td>
              {showCustomer && <td>{t.clientName}</td>}
              {showPsp && <td>{t.pspName}</td>}
              <td>
                <div>{counterpartyName(t)}</div>
                <div className="text-sm text-copy-2xlight">{countryName(counterpartyCountry(t))}</div>
              </td>
              <td className="text-right whitespace-nowrap">
                <div className="font-medium">{money(t.sentAmount, t.sentCurrency)}</div>
                {t.sentCurrency !== t.receivedCurrency && <div className="text-sm text-copy-2xlight">{money(t.receivedAmount, t.receivedCurrency)}</div>}
              </td>
              <td>
                <StatusPill status={t.status} />
              </td>
              <td className="text-sm text-copy-light max-w-xs">{t.risks.map((r: any) => r.ruleName).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Transactions() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const isRoot = me?.client?.kind === 'ROOT';
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const pspId = params.get('pspId') ?? '';
  const page = Number(params.get('page') ?? 0);
  const list = useApi(`/transactions${qs({ status, type, pspId, page, size: 25 })}`);
  const psps = useApi(isRoot ? '/psps?size=200' : null);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader icon="icon-transactions" title="Transactions" />
      <div className="flex flex-wrap gap-3 mb-4">
        <select className="!w-auto" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="ON_HOLD">On hold</option>
          <option value="APPROVED">Approved</option>
        </select>
        <select className="!w-auto" value={type} onChange={(e) => set('type', e.target.value)}>
          <option value="">Incoming and outgoing</option>
          <option value="INCOMING">Incoming</option>
          <option value="OUTGOING">Outgoing</option>
        </select>
        {isRoot && (
          <select className="!w-auto" value={pspId} onChange={(e) => set('pspId', e.target.value)}>
            <option value="">All PSPs</option>
            {(psps.data?.items ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.loading ? <div className="px-4"><Spinner /></div> : <TransactionsTable items={list.data?.items ?? []} showPsp={isRoot} />}
        <Pagination page={list.data} onPage={(p) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; })} />
      </div>
      {!isRoot && (
        <p className="text-sm text-copy-xlight mt-4">
          Transactions come from your customers' activity. Use <Link to="/customers">a customer page</Link> to simulate one.
        </p>
      )}
    </>
  );
}

export function TxCard({ title, query, showPsp, showCustomer }: { title: string; query: Record<string, string>; showPsp?: boolean; showCustomer?: boolean }) {
  const list = useApi(`/transactions${qs({ ...query, size: 50 })}`);
  return (
    <Card title={title}>
      {list.loading ? <Spinner /> : <TransactionsTable items={list.data?.items ?? []} showPsp={showPsp} showCustomer={showCustomer} />}
    </Card>
  );
}
