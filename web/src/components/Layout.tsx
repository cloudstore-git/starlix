import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Icon } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

export function navFor(me: ReturnType<typeof useSession>['me']): NavItem[] {
  if (!me) return [];
  const items: NavItem[] = [];
  const kind = me.client?.kind;
  if (me.client && me.onboardingRequired) {
    items.push({ to: '/my-onboarding', label: 'Onboarding', icon: 'icon-list' });
  } else if (kind === 'ROOT') {
    items.push(
      { to: '/dashboard', label: 'Dashboard', icon: 'icon-dashboard' },
      { to: '/psps', label: 'PSPs', icon: 'icon-psp' },
      { to: '/customers', label: 'Customers', icon: 'icon-clients' },
      { to: '/correspondents', label: 'Correspondents', icon: 'icon-correspondent' },
      { to: '/transactions', label: 'Transactions', icon: 'icon-transactions' },
      { to: '/reviews', label: 'Onboarding', icon: 'icon-list' },
    );
  } else if (kind === 'PSP') {
    items.push(
      { to: '/dashboard', label: 'Dashboard', icon: 'icon-dashboard' },
      { to: '/customers', label: 'Customers', icon: 'icon-clients' },
      { to: '/correspondents', label: 'Correspondents', icon: 'icon-correspondent' },
      { to: '/transactions', label: 'Transactions', icon: 'icon-transactions' },
      { to: '/my-onboarding', label: 'My onboarding', icon: 'icon-list' },
    );
  }
  if (me.user.isAdmin) items.push({ to: '/admin/users', label: 'Users', icon: 'icon-individual' });
  items.push({ to: '/settings', label: 'Settings', icon: 'icon-settings' });
  return items;
}

export function Layout({ children }: { children: ReactNode }) {
  const { me, signOut } = useSession();
  const navigate = useNavigate();
  const items = navFor(me);
  return (
    <div className="min-h-screen flex flex-row">
      <aside className="w-60 shrink-0 bg-white border-r border-ring flex flex-col">
        <div className="px-6 py-6">
          <img src={me?.branding.logo ?? '/images/logo.svg'} alt={me?.branding.name ?? 'StarLiX'} className="h-9" />
        </div>
        <nav className="flex flex-col gap-1 px-3 flex-1">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 hover:no-underline ${
                  isActive ? 'bg-primary-5xlight text-primary font-medium' : 'text-copy-light hover:bg-copy-5xlight'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={i.icon} className={`w-5 h-5 ${isActive ? 'bg-primary' : 'bg-copy-xlight'}`} />
                  {i.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 text-sm text-copy-xlight border-t border-separator">
          <div className="font-medium text-copy truncate">{me?.client?.name ?? (me?.user.isAdmin ? 'Platform admin' : '')}</div>
          <div className="truncate">{me?.user.email}</div>
          <button
            className="mt-3 flex items-center gap-2 text-link hover:underline"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            <Icon name="icon-logout" className="w-4 h-4 bg-link" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-8 py-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
