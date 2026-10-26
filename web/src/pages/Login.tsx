import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBox, Field, InfoBox } from '../components/ui';
import { SignInResult, confirmPassword, forgotPassword, signIn } from '../lib/auth';
import { useSession } from '../lib/session';

type Mode = 'login' | 'newPassword' | 'totp' | 'forgot' | 'reset';

export default function Login() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<SignInResult>();
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);

  const handle = async (r: SignInResult) => {
    if (r.kind === 'ok') {
      await refresh();
      navigate('/');
    } else {
      setPending(r);
      setMode(r.kind);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'login') await handle(await signIn(email, password));
      else if (mode === 'newPassword' && pending?.kind === 'newPassword') await handle(await pending.complete(newPassword));
      else if (mode === 'totp' && pending?.kind === 'totp') await handle(await pending.complete(code));
      else if (mode === 'forgot') {
        await forgotPassword(email);
        setInfo('If the email is registered, a reset code is on its way.');
        setMode('reset');
      } else if (mode === 'reset') {
        await confirmPassword(email, code, newPassword);
        setInfo('Password changed. Sign in with your new password.');
        setPassword('');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    login: 'Sign in',
    newPassword: 'Choose a new password',
    totp: 'Enter your authenticator code',
    forgot: 'Reset your password',
    reset: 'Enter the reset code',
  };

  return (
    <div className="min-h-screen flex flex-row">
      <div className="hidden lg:flex w-1/2 bg-hero-pattern bg-cover bg-center items-end p-12">
        <div className="text-white max-w-md">
          <h1 className="mb-3">Compliance for payment networks</h1>
          <p className="opacity-90">Onboard PSPs, watch their customers and correspondents, and act on risky transactions from one place.</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-5">
          <img src="/images/logo.svg" alt="StarLiX" className="h-10 self-start" />
          <h3>{titles[mode]}</h3>
          {info && <InfoBox>{info}</InfoBox>}
          <ErrorBox error={error} />

          {(mode === 'login' || mode === 'forgot' || mode === 'reset') && (
            <Field label="Email">
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={mode === 'reset'} />
            </Field>
          )}
          {mode === 'login' && (
            <Field label="Password">
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          {(mode === 'totp' || mode === 'reset') && (
            <Field label={mode === 'totp' ? 'Six-digit code' : 'Code from the email'}>
              <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
          )}
          {(mode === 'newPassword' || mode === 'reset') && (
            <Field label="New password" hint="At least 12 characters with upper and lower case, a digit and a symbol.">
              <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </Field>
          )}

          <button className="btn-primary justify-center" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset code' : mode === 'login' ? 'Sign in' : 'Continue'}
          </button>
          {mode === 'login' ? (
            <button type="button" className="text-link text-sm self-start" onClick={() => setMode('forgot')}>
              Forgot your password?
            </button>
          ) : (
            <button type="button" className="text-link text-sm self-start" onClick={() => setMode('login')}>
              Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
