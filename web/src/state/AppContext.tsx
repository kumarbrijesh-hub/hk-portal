import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { AppConfig, SessionUser } from '../types';

interface AppState {
  booting: boolean;
  user: SessionUser | null;
  config: AppConfig | null;
  /** Bumped by every server-sent change event; pages depend on it to refetch. */
  revision: number;
  connected: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  bumpRevision: () => void;
}

const AppContext = createContext<AppState | null>(null);

const EVENT_TYPES = [
  'disruption:created',
  'disruption:updated',
  'live-update:added',
  'live-update:edited',
  'sync:status',
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const bumpRevision = useCallback(() => setRevision((value) => value + 1), []);

  const refreshConfig = useCallback(async () => {
    const next = await api.get<AppConfig>('/api/config');
    setConfig(next);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<{ user: SessionUser }>('/api/auth/me');
        setUser(me.user);
        await refreshConfig();
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshConfig]);

  // Live refresh (spec section 20): one SSE stream drives every page.
  useEffect(() => {
    if (!user) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
      return;
    }

    const source = new EventSource('/api/events');
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, () => bumpRevision());
    }

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [user, bumpRevision]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<{ user: SessionUser }>('/api/auth/login', { email, password });
      setUser(result.user);
      await refreshConfig();
    },
    [refreshConfig],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
    setConfig(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({ booting, user, config, revision, connected, login, logout, refreshConfig, bumpRevision }),
    [booting, user, config, revision, connected, login, logout, refreshConfig, bumpRevision],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

/** Config is guaranteed present on authenticated pages. */
export function useConfig(): AppConfig {
  const { config } = useApp();
  if (!config) throw new Error('Config not loaded');
  return config;
}
