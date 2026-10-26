import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, PageHeader, Spinner, StatusPill } from '../components/ui';
import { qs } from '../lib/api';
import { dateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { OnboardingForm } from '../lib/types';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'IN_REVIEW', label: 'Waiting for review' },
  { key: 'CHECKS_FAILED', label: 'Checks failed' },
  { key: 'PENDING', label: 'Being filled in' },
  { key: 'WAITING_SIGNUP', label: 'Invited' },
  { key: 'APPROVED', label: 'Approved' },
];

/** Every onboarding the signed-in client started, newest first. */
export default function Reviews() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const list = useApi<OnboardingForm[]>(`/onboarding/forms${qs({ status })}`);
  return (
    <>
      <PageHeader icon="icon-list" title="Onboarding" />
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={status === f.key ? 'btn-primary btn-small' : 'btn-secondary btn-small'}
            onClick={() => setParams(new URLSearchParams({ status: f.key }))}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ErrorBox error={list.error} />
      <div className="card">
        {list.loading ? (
          <div className="px-4"><Spinner /></div>
        ) : list.data?.length ? (
          <table className="table-data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th>Filled in by</th>
                <th>Started</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((f) => (
                <tr key={f.id} className="cursor-pointer" onClick={() => navigate(f.status === 'IN_REVIEW' || f.status === 'CHECKS_FAILED' ? `/onboarding/${f.id}/review` : `/onboarding/${f.id}`)}>
                  <td className="font-medium">{f.clientName}</td>
                  <td>{f.onboardingType === 'REGULATED' ? 'Regulated' : 'Non-regulated'}</td>
                  <td>{f.inviteEmail ?? 'Your team'}</td>
                  <td>{dateTime(f.createdAt)}</td>
                  <td>{f.submittedAt ? dateTime(f.submittedAt) : ''}</td>
                  <td><StatusPill status={f.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No onboardings here</Empty>
        )}
      </div>
    </>
  );
}
