import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { get } from './api';
import { currentSession, signOut as cognitoSignOut } from './auth';
import type { Client } from './types';

export interface Me {
  user: { id: string; email: string; groups: string[]; isAdmin: boolean };
  client: Client | null;
  account: { id: string; name: string } | null;
  onboardingRequired: boolean;
  branding: { name: string; logo: string; primaryColor: string };
}

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionState>({ me: null, loading: true, refresh: async () => {}, signOut: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const session = await currentSession();
      setMe(session?.isValid() ? await get<Me>('/me') : null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setMe(null);
  }, []);

  return <SessionContext.Provider value={{ me, loading, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
