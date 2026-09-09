import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { UserProfile, Role } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  roles: Role[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUserProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select(
        `*,
        role:roles(*),
        business:businesses(*),
        branch:branches(*)`,
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
    return data as UserProfile;
  }, []);

  const refreshUser = useCallback(async () => {
    if (!session?.user?.id) return;
    const profile = await fetchUserProfile(session.user.id);
    setUser(profile);
  }, [session, fetchUserProfile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!mounted) return;
      setSession(currentSession);

      if (currentSession?.user?.id) {
        Promise.all([
          fetchUserProfile(currentSession.user.id),
          supabase.from('roles').select('*').order('name'),
        ]).then(([profile, rolesResult]) => {
          if (!mounted) return;
          setUser(profile);
          if (rolesResult.data) setRoles(rolesResult.data as Role[]);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      window.setTimeout(() => {
        (async () => {
          if (newSession?.user?.id) {
            const profile = await fetchUserProfile(newSession.user.id);
            if (mounted) setUser(profile);
            if (mounted && roles.length === 0) {
              const { data: rolesData } = await supabase.from('roles').select('*').order('name');
              if (mounted && rolesData) setRoles(rolesData as Role[]);
            }
          } else {
            if (mounted) setUser(null);
          }
          if (mounted) setLoading(false);
        })();
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const normalizedEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        console.error('Supabase sign-in failed:', error);
        return { error: error.message || 'Unable to sign in.' };
      }
      return { error: null };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, roles, loading, signIn, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
