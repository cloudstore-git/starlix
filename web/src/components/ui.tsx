import { ReactElement, ReactNode, cloneElement, isValidElement, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { openFile, uploadFile } from '../lib/api';
import { COUNTRIES, countryName } from '../lib/countries';
import { label } from '../lib/format';
import type { StoredFile } from '../lib/types';

export function Icon({ name, className = 'w-5 h-5 bg-copy' }: { name: string; className?: string }) {
  const url = `url(/images/${name}.svg)`;
  return <span className={`icon-mask ${className}`} style={{ WebkitMaskImage: url, maskImage: url }} aria-hidden />;
}

export function Flag({ code, className = 'w-5 h-auto' }: { code?: string; className?: string }) {
  if (!code) return null;
  return <img src={`/images/flags/4x3/${code.toLowerCase()}.svg`} alt="" className={`${className} rounded-sm border border-ring`} />;
}

export function Country({ code }: { code?: string }) {
  if (!code) return <span className="text-copy-2xlight">None</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Flag code={code} />
      {countryName(code)}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-800',
  PASSED: 'bg-green-100 text-green-800',
  ON_HOLD: 'bg-orange-100 text-orange-800',
  PENDING: 'bg-sky-100 text-sky-800',
  WAITING_SIGNUP: 'bg-sky-100 text-sky-800',
  IN_REVIEW: 'bg-blue-100 text-blue-800',
  CHECKS_IN_PROGRESS: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  CHANGES_REQUESTED: 'bg-amber-100 text-amber-800',
  EXPIRING: 'bg-amber-100 text-amber-800',
  CHECKS_FAILED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  ERROR: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-red-100 text-red-800',
  LICENSE_EXPIRED: 'bg-red-100 text-red-800',
  NOT_STARTED: 'bg-slate-100 text-slate-600',
};

export function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-medium whitespace-nowrap ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {label(status)}
    </span>
  );
}

export function PageHeader({ icon, title, children, crumbs }: { icon?: string; title: ReactNode; children?: ReactNode; crumbs?: { to: string; label: string }[] }) {
  return (
    <div className="mb-6">
      {crumbs?.length ? (
        <div className="text-sm text-copy-xlight mb-2 flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <span key={c.to} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <Link to={c.to}>{c.label}</Link>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-row items-center gap-3">
          {icon && <Icon name={icon} className="w-6 h-6 bg-copy" />}
          <h2>{title}</h2>
        </div>
        <div className="flex flex-row items-center gap-3">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ text = 'Loading' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 text-copy-xlight py-8">
      <img src="/images/loading.gif" alt="" className="w-5 h-5" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      {text}…
    </div>
  );
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="rounded-md border border-red-200 bg-red-50 text-red-800 px-4 py-3 my-3">{error}</div>;
}

export function InfoBox({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  const cls = {
    info: 'bg-info-box border-info-box-border',
    warning: 'bg-amber-50 border-amber-200',
    success: 'bg-green-50 border-green-200',
  }[tone];
  return <div className={`rounded-md border px-4 py-3 my-3 ${cls}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-copy-xlight py-10 text-center">{children}</div>;
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-separator gap-3">
          <h4>{title}</h4>
          <div className="flex gap-2">{actions}</div>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export function Pagination({ page, onPage }: { page?: Page<unknown>; onPage: (p: number) => void }) {
  if (!page || page.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-copy-xlight">
      <span>
        {page.total} results · page {page.page + 1} of {page.totalPages}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary btn-small" disabled={page.page === 0} onClick={() => onPage(page.page - 1)}>
          Previous
        </button>
        <button className="btn-secondary btn-small" disabled={page.page + 1 >= page.totalPages} onClick={() => onPage(page.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { to: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="flex flex-row gap-1 border-b border-ring mb-6 overflow-x-auto">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`px-4 py-2 -mb-px border-b-2 whitespace-nowrap hover:no-underline ${
            t.key === active ? 'border-primary text-primary font-medium' : 'border-transparent text-copy-xlight hover:text-copy'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} mt-12`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-separator">
          <h4>{title}</h4>
          <button onClick={onClose} aria-label="Close">
            <Icon name="icon-x" className="w-4 h-4 bg-copy-xlight" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label: text, children, error, hint }: { label: string; children: ReactNode; error?: string; hint?: string }) {
  // Ties the label to a single control so clicking the label focuses it and screen readers announce it
  const id = useId();
  const single = isValidElement(children) && !(children.props as any).id;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={single ? id : undefined}>{text}</label>
      {single ? cloneElement(children as ReactElement<any>, { id }) : children}
      {hint && <span className="text-sm text-copy-2xlight">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function CountrySelect({ value, onChange, disabled, id }: { value?: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">Select a country</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function FileList({ files, onRemove }: { files: StoredFile[]; onRemove?: (f: StoredFile) => void }) {
  if (!files?.length) return <span className="text-copy-2xlight text-sm">No files</span>;
  return (
    <ul className="flex flex-col gap-1">
      {files.map((f) => (
        <li key={f.key} className="flex items-center gap-2">
          <Icon name="icon-file" className="w-4 h-4 bg-copy-xlight" />
          <button className="text-link hover:underline text-left" onClick={() => openFile(f.key)}>
            {f.name}
          </button>
          {onRemove && (
            <button onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`}>
              <Icon name="icon-remove" className="w-4 h-4 bg-red-700" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FileUpload({ files, onChange, disabled }: { files: StoredFile[]; onChange: (files: StoredFile[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const uploaded = [];
      for (const f of Array.from(list)) uploaded.push(await uploadFile(f));
      onChange([...(files ?? []), ...uploaded]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <FileList files={files ?? []} onRemove={disabled ? undefined : (f) => onChange(files.filter((x) => x.key !== f.key))} />
      {!disabled && (
        <div>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
          <button type="button" className="btn-secondary btn-small" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="icon-upload" className="w-4 h-4 bg-primary" />
            {busy ? 'Uploading…' : 'Upload files'}
          </button>
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function Stat({ label: text, value, sub, tone = 'default', to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warning' | 'ok'; to?: string }) {
  const cls = tone === 'warning' ? 'bg-orange-500 text-white' : tone === 'ok' ? 'bg-green-600 text-white' : 'bg-white text-copy border border-ring';
  const body = (
    <div className={`rounded-xl shadow-sm px-6 py-5 flex flex-col gap-2 h-full ${cls}`}>
      <div className="font-medium opacity-90">{text}</div>
      <div className="text-3xl font-semibold">{value}</div>
      {sub && <div className="text-sm opacity-90">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="hover:no-underline text-inherit">
      {body}
    </Link>
  ) : (
    body
  );
}
