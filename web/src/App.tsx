import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Me, useSession } from './lib/session';
import AdminUsers from './pages/AdminUsers';
import Correspondents, { CorrespondentDetail } from './pages/Correspondents';
import Customers, { CustomerDetail } from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import OnboardingForm, { MyOnboarding } from './pages/OnboardingForm';
import Psps, { PspDetail } from './pages/Psps';
import Reviews from './pages/Reviews';
import Settings from './pages/Settings';
import TransactionDetail from './pages/TransactionDetail';
import Transactions from './pages/Transactions';

/** Where a user lands after sign-in. */
function home(me: Me): string {
  if (me.client && me.onboardingRequired) return '/my-onboarding';
  if (me.client) return '/dashboard';
  if (me.user.isAdmin) return '/admin/users';
  return '/settings';
}

type Need = 'client' | 'root' | 'admin' | 'any';

function Guard({ need = 'client', children }: { need?: Need; children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading && !me) return <div className="p-8"><Spinner /></div>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const allowed =
    need === 'any' ||
    (need === 'admin' && me.user.isAdmin) ||
    (need === 'root' && me.client?.kind === 'ROOT' && !me.onboardingRequired) ||
    (need === 'client' && !!me.client && !me.onboardingRequired);
  // Onboarding pages stay open to a client that still has to finish its own onboarding.
  const onboardingPage = location.pathname.startsWith('/onboarding/') || location.pathname === '/my-onboarding';
  if (!allowed && !(onboardingPage && me.client)) return <Navigate to={home(me)} replace />;
  return <Layout>{children}</Layout>;
}

function Home() {
  const { me, loading } = useSession();
  if (loading && !me) return <div className="p-8"><Spinner /></div>;
  return <Navigate to={me ? home(me) : '/login'} replace />;
}

export default function App() {
  const { me } = useSession();
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={home(me)} replace /> : <Login />} />
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
      <Route path="/psps" element={<Guard need="root"><Psps /></Guard>} />
      <Route path="/psps/:clientId" element={<Guard need="root"><PspDetail /></Guard>} />
      <Route path="/psps/:clientId/:tab" element={<Guard need="root"><PspDetail /></Guard>} />
      <Route path="/customers" element={<Guard><Customers /></Guard>} />
      <Route path="/customers/:clientId" element={<Guard><CustomerDetail /></Guard>} />
      <Route path="/customers/:clientId/:tab" element={<Guard><CustomerDetail /></Guard>} />
      <Route path="/customers/:clientId/:tab/:dir" element={<Guard><CustomerDetail /></Guard>} />
      <Route path="/correspondents" element={<Guard><Correspondents /></Guard>} />
      <Route path="/correspondents/:correspondentId" element={<Guard><CorrespondentDetail /></Guard>} />
      <Route path="/transactions" element={<Guard><Transactions /></Guard>} />
      <Route path="/transactions/:transactionId" element={<Guard><TransactionDetail /></Guard>} />
      <Route path="/onboarding/:formId" element={<Guard><OnboardingForm /></Guard>} />
      <Route path="/onboarding/:formId/:section" element={<Guard><OnboardingForm /></Guard>} />
      <Route path="/my-onboarding" element={<Guard><MyOnboarding /></Guard>} />
      <Route path="/reviews" element={<Guard need="root"><Reviews /></Guard>} />
      <Route path="/admin/users" element={<Guard need="admin"><AdminUsers /></Guard>} />
      <Route path="/settings" element={<Guard need="any"><Settings /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
