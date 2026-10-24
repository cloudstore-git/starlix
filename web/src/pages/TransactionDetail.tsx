import { ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Country, ErrorBox, FileList, FileUpload, Icon, InfoBox, PageHeader, Spinner, StatusPill } from '../components/ui';
import { post } from '../lib/api';
import { dateTime, label, money } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';
import type { StoredFile } from '../lib/types';

const DOC_TYPES = ['Invoice', 'Contract', 'Proof of funds', 'Bank statement', 'Other'];

function FlowStep({ title, name, sub, to }: { title: string; name: string; sub?: ReactNode; to?: string }) {
  return (
    <div className="flex-1 min-w-[150px] rounded-lg border border-ring bg-white px-4 py-3">
      <div className="text-sm text-copy-2xlight">{title}</div>
      <div className="font-medium">{to ? <Link to={to}>{name}</Link> : name}</div>
      {sub && <div className="text-sm text-copy-xlight">{sub}</div>}
    </div>
  );
}

const Arrow = () => <Icon name="arrow-right" className="w-4 h-4 bg-copy-2xlight self-center" />;

function fixHint(target: string, tx: any, customerId: string, pspId: string, correspondentId?: string) {
  const dir = tx.type === 'INCOMING' ? 'incoming' : 'outgoing';
  switch (target) {
    case 'CUSTOMER':
    case 'SENDER':
    case 'BENEFICIARY':
      return <Link to={`/customers/${customerId}/settings/${dir}`}>Review the customer's {dir} limits</Link>;
    case 'PSP':
      return <Link to={`/psps/${pspId}/onboarding`}>Open the PSP's onboarding</Link>;
    case 'CORRESPONDENT':
      return correspondentId ? <Link to={`/correspondents/${correspondentId}`}>Check the correspondent's licence</Link> : null;
    case 'TRANSACTION':
      return <span>Upload supporting documents below</span>;
    default:
      return null;
  }
}

export default function TransactionDetail() {
  const { transactionId } = useParams();
  const { data, error, loading, reload } = useApi(`/transactions/${transactionId}`);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const save = useAction(async () => {
    await post(`/transactions/${transactionId}/documents`, { type: docType, files });
    setFiles([]);
    await reload();
  });

  if (loading) return <Spinner />;
  if (!data) return <ErrorBox error={error} />;
  const { transaction: t, customer, psp, correspondent } = data;
  const incoming = t.type === 'INCOMING';
  const counterparty = incoming ? t.sender : t.beneficiary;
  const bank = incoming ? t.senderBank : t.beneficiaryBank;
  const byTarget: Record<string, any[]> = {};
  for (const r of t.risks) (byTarget[r.target] ??= []).push(r);

  const outsideSteps = [
    <FlowStep key="cp" title={incoming ? 'Sender' : 'Beneficiary'} name={counterparty?.name ?? 'Unknown'} sub={<Country code={counterparty?.individual?.nationality} />} />,
    bank ? <FlowStep key="bank" title={incoming ? "Sender's bank" : "Beneficiary's bank"} name={bank.name} sub={<Country code={bank.jurisdiction} />} /> : null,
    correspondent ? (
      <FlowStep key="corr" title={`Correspondent ${correspondent.type === 'BANK' ? 'bank' : 'PSP'}`} name={correspondent.name} sub={<Country code={correspondent.company.jurisdiction} />} to={`/correspondents/${correspondent.id}`} />
    ) : null,
  ].filter(Boolean);
  const insideSteps = [
    <FlowStep key="psp" title="PSP" name={psp.name} sub={<StatusPill status={psp.onboardingStatus} />} to={`/psps/${psp.id}`} />,
    <FlowStep key="cust" title="Customer" name={customer.name} sub={customer.uniqueReference} to={`/customers/${customer.id}`} />,
  ];
  const steps = incoming ? [...outsideSteps, ...insideSteps] : [...insideSteps.reverse(), ...[...outsideSteps].reverse()];

  return (
    <>
      <PageHeader
        icon="icon-transactions"
        title={`${incoming ? 'Incoming' : 'Outgoing'} ${money(t.sentAmount, t.sentCurrency)}`}
        crumbs={[{ to: '/transactions', label: 'Transactions' }]}
      >
        <StatusPill status={t.status} />
      </PageHeader>

      <div className="flex flex-row flex-wrap gap-3 mb-6">
        {steps.map((s, i) => (
          <div key={i} className="contents">
            {i > 0 && <Arrow />}
            {s}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Details">
          <table className="vtable">
            <tbody>
              <tr><th>Date</th><td>{dateTime(t.timestamp)}</td></tr>
              <tr><th>Sent</th><td>{money(t.sentAmount, t.sentCurrency)}</td></tr>
              <tr><th>Received</th><td>{money(t.receivedAmount, t.receivedCurrency)}</td></tr>
              <tr><th>FX rate</th><td>{t.fxRate.toFixed(4)}</td></tr>
              <tr><th>GBP value</th><td>{money(t.gbpAmount)}</td></tr>
              <tr><th>Route</th><td>{incoming ? 'Inbound' : correspondent ? `Correspondent ${correspondent.type === 'BANK' ? 'bank' : 'PSP'}` : 'SWIFT'}</td></tr>
              <tr><th>Reference</th><td className="font-mono text-sm">{t.id}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title={t.risks.length ? `${t.risks.length} risk${t.risks.length > 1 ? 's' : ''} holding this transaction` : 'Risks'}>
          {t.risks.length === 0 ? (
            <InfoBox tone="success">All rules passed. This transaction is approved.</InfoBox>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(byTarget).map(([target, risks]) => (
                <div key={target} className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <div className="text-sm font-medium text-orange-800 mb-1">{label(target)}</div>
                  {risks.map((r, i) => (
                    <div key={i} className="mb-2">
                      <div className="flex items-center gap-2 font-medium">
                        <Icon name="icon-warning" className="w-4 h-4 bg-warning-darker" />
                        {r.ruleName}
                      </div>
                      <div className="text-copy-light">{r.message}</div>
                    </div>
                  ))}
                  <div className="text-sm">{fixHint(target, t, customer.id, psp.id, correspondent?.id)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Supporting documents" className="xl:col-span-2">
          {t.supportingDocuments.length ? (
            <div className="flex flex-col gap-3 mb-5">
              {t.supportingDocuments.map((d: any) => (
                <div key={d.type}>
                  <div className="text-sm font-medium text-copy-xlight mb-1">{d.type}</div>
                  <FileList files={d.files} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-copy-xlight mb-4">No documents yet.</p>
          )}
          <div className="flex flex-wrap items-end gap-4 border-t border-separator pt-4">
            <div className="flex flex-col gap-1 w-56">
              <label>Document type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <FileUpload files={files} onChange={setFiles} />
            <button className="btn-primary" disabled={!files.length || save.busy} onClick={() => save.run()}>
              {save.busy ? 'Saving…' : 'Attach and re-check'}
            </button>
          </div>
          <ErrorBox error={save.error} />
        </Card>
      </div>
    </>
  );
}
