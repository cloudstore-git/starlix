import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Stat, StatusPill } from '../components/ui';
import { TransactionsTable } from './Transactions';
import { label, money } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function Dashboard() {
  const { me } = useSession();
  const isRoot = me?.client?.kind === 'ROOT';
  const dash = useApi('/dashboard');
  const psps = useApi(isRoot ? '/psps?size=200' : null);

  if (dash.loading) return <Spinner />;
  const d = dash.data;
  const pspStatus: Record<string, number> = {};
  for (const p of psps.data?.items ?? []) pspStatus[p.onboardingStatus] = (pspStatus[p.onboardingStatus] ?? 0) + 1;
  const attention = (psps.data?.items ?? []).filter((p: any) => !['APPROVED', 'EXPIRING'].includes(p.onboardingStatus));

  return (
    <>
      <PageHeader icon="icon-dashboard" title="Dashboard" />
      <ErrorBox error={dash.error} />
      {d && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {d.onHold.count > 0 ? (
            <Stat
              tone="warning"
              label="On hold"
              value={`${d.onHold.count} transactions`}
              sub={`${money(d.onHold.amount)} volume · view transactions`}
              to="/transactions?status=ON_HOLD"
            />
          ) : (
            <Stat tone="ok" label="On hold" value="None" sub="No transactions on hold" to="/transactions" />
          )}
          <Stat label="Last 30 days" value={`${d.last30Days.count} transactions`} sub={`${money(d.last30Days.incoming)} in · ${money(d.last30Days.outgoing)} out`} to="/transactions" />
          {isRoot ? (
            <Stat
              label="PSPs"
              value={`${psps.data?.total ?? 0} PSPs`}
              sub={attention.length ? `${attention.length} need attention` : 'All onboarded'}
              to="/psps"
            />
          ) : (
            <Stat label="Onboarding" value={<StatusPill status={me?.client?.onboardingStatus} />} sub="Your own onboarding status" to="/my-onboarding" />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card title="Why transactions are on hold" className="xl:col-span-1">
          {d && Object.keys(d.riskCounts).length ? (
            <ul className="flex flex-col gap-3">
              {Object.entries(d.riskCounts as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .map(([type, n]) => (
                  <li key={type} className="flex items-center gap-3">
                    <span className="w-40 text-copy-light">{label(type)}</span>
                    <span className="flex-1 h-2 rounded bg-copy-5xlight overflow-hidden">
                      <span className="block h-2 bg-orange-500" style={{ width: `${(100 * n) / Math.max(...(Object.values(d.riskCounts) as number[]))}%` }} />
                    </span>
                    <span className="w-8 text-right font-medium">{n}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>Nothing on hold</Empty>
          )}
        </Card>

        {isRoot && (
          <Card title="PSP onboarding" className="xl:col-span-2" actions={<Link to="/psps">All PSPs</Link>}>
            <div className="flex flex-wrap gap-3 mb-4">
              {Object.entries(pspStatus).map(([s, n]) => (
                <span key={s} className="flex items-center gap-2">
                  <StatusPill status={s} /> <span className="font-medium">{n}</span>
                </span>
              ))}
            </div>
            {attention.length ? (
              <table className="table-data">
                <thead>
                  <tr>
                    <th>PSP needing attention</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {attention.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <StatusPill status={p.onboardingStatus} />
                      </td>
                      <td className="text-right">
                        <Link to={`/psps/${p.id}/onboarding`}>Open onboarding</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>Every PSP is onboarded</Empty>
            )}
          </Card>
        )}
      </div>

      {d?.latestOnHold?.length ? (
        <Card title="Latest transactions on hold" className="mt-6" actions={<Link to="/transactions?status=ON_HOLD">View all</Link>}>
          <TransactionsTable items={d.latestOnHold} showPsp={isRoot} />
        </Card>
      ) : null}
    </>
  );
}
