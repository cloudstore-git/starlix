import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { getConfig } from './config';

// Local mode (npm run local) keeps the signed-in email in localStorage and sends it as the token.
const LOCAL_KEY = 'starlix.localUser';
const local = () => !!getConfig().localAuth;
const localSession = (email: string) => ({ isValid: () => true, getIdToken: () => ({ getJwtToken: () => `Local ${email}` }) }) as unknown as CognitoUserSession;

let pool: CognitoUserPool | undefined;
function userPool() {
  if (!pool) {
    const c = getConfig();
    pool = new CognitoUserPool({ UserPoolId: c.userPoolId, ClientId: c.userPoolClientId });
  }
  return pool;
}

export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'newPassword'; complete: (password: string) => Promise<SignInResult> }
  | { kind: 'totp'; complete: (code: string) => Promise<SignInResult> };

export function signIn(email: string, password: string): Promise<SignInResult> {
  if (local()) {
    localStorage.setItem(LOCAL_KEY, email.trim().toLowerCase());
    return Promise.resolve({ kind: 'ok' });
  }
  const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool() });
  const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
  return new Promise((resolve, reject) => {
    const callbacks = {
      onSuccess: () => resolve({ kind: 'ok' as const }),
      onFailure: (err: any) => reject(new Error(err?.message ?? 'Sign in failed')),
      newPasswordRequired: () =>
        resolve({
          kind: 'newPassword',
          complete: (newPassword: string) =>
            new Promise<SignInResult>((res2, rej2) =>
              user.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: () => res2({ kind: 'ok' }),
                onFailure: (e: any) => rej2(new Error(e?.message ?? 'Could not set password')),
              }),
            ),
        }),
      totpRequired: () =>
        resolve({
          kind: 'totp',
          complete: (code: string) =>
            new Promise<SignInResult>((res2, rej2) =>
              user.sendMFACode(code, {
                onSuccess: () => res2({ kind: 'ok' }),
                onFailure: (e: any) => rej2(new Error(e?.message ?? 'Invalid code')),
              }, 'SOFTWARE_TOKEN_MFA'),
            ),
        }),
    };
    user.authenticateUser(details, callbacks);
  });
}

export function currentSession(): Promise<CognitoUserSession | null> {
  if (local()) {
    const email = localStorage.getItem(LOCAL_KEY);
    return Promise.resolve(email ? localSession(email) : null);
  }
  const user = userPool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    // getSession refreshes expired tokens with the refresh token
    user.getSession((err: Error | null, session: CognitoUserSession | null) => resolve(err ? null : session));
  });
}

export async function idToken(): Promise<string | null> {
  const s = await currentSession();
  return s?.isValid() ? s.getIdToken().getJwtToken() : null;
}

export function signOut() {
  if (local()) return localStorage.removeItem(LOCAL_KEY);
  userPool().getCurrentUser()?.signOut();
}

export function forgotPassword(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool() });
  return new Promise((resolve, reject) =>
    user.forgotPassword({ onSuccess: () => resolve(), onFailure: (e) => reject(e), inputVerificationCode: () => resolve() }),
  );
}

export function confirmPassword(email: string, code: string, password: string): Promise<void> {
  const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool() });
  return new Promise((resolve, reject) =>
    user.confirmPassword(code, password, { onSuccess: () => resolve(), onFailure: (e) => reject(e) }),
  );
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (local()) return;
  const user = userPool().getCurrentUser();
  if (!user || !(await currentSession())) throw new Error('Not signed in');
  return new Promise((resolve, reject) =>
    user.changePassword(oldPassword, newPassword, (err) => (err ? reject(err) : resolve())),
  );
}
