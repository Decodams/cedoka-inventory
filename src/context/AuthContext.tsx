import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { clearQueryCache } from '@/hooks/useSupabaseQuery';
import type { UserProfile, Role } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  roles: Role[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  registerStaff: (fullName: string, email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const rolesLoadedRef = useRef(false);
  const profileFetchRef = useRef<{ id: string; at: number } | null>(null);

  const fetchUserProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select(
        `*,
        role:roles(*),
        business:businesses!user_profiles_business_id_fkey(*),
        branch:branches!user_profiles_branch_id_fkey(*)`,
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
    profileFetchRef.current = { id: session.user.id, at: Date.now() };
    setUser(profile);
  }, [session, fetchUserProfile]);

  const loadProfile = useCallback(
    async (userId: string): Promise<UserProfile | null> => {
      const profile = await fetchUserProfile(userId);
      profileFetchRef.current = { id: userId, at: Date.now() };
      setUser(profile);
      return profile;
    },
    [fetchUserProfile],
  );

  const loadRolesOnce = useCallback(async (): Promise<void> => {
    if (rolesLoadedRef.current) return;
    rolesLoadedRef.current = true;
    const { data: rolesData } = await supabase.from('roles').select('id,name,display_name,description,is_system').order('name');
    if (rolesData) setRoles(rolesData as Role[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!mounted) return;
      setSession(currentSession);

      if (currentSession?.user?.id) {
        const uid = currentSession.user.id;
        Promise.all([
          fetchUserProfile(uid),
          supabase.from('roles').select('id,name,display_name,description,is_system').order('name'),
        ]).then(([profile, rolesResult]) => {
          if (!mounted) return;
          setUser(profile);
          profileFetchRef.current = { id: uid, at: Date.now() };
          if (rolesResult.data) {
            setRoles(rolesResult.data as Role[]);
            rolesLoadedRef.current = true;
          }
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // INITIAL_SESSION duplicates the getSession() bootstrap above — ignore it
      // so the profile + roles are fetched once, not twice, on every app load.
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        clearQueryCache();
        if (mounted) {
          setUser(null);
          setSession(null);
          setLoading(false);
        }
        return;
      }
      setSession(newSession);
      window.setTimeout(() => {
        (async () => {
          if (newSession?.user?.id) {
            const uid = newSession.user.id;
            // signIn() already loaded + validated this profile seconds ago — skip the duplicate.
            // Token refreshes don't change the profile, so only SIGNED_IN/USER_UPDATED refresh it.
            const last = profileFetchRef.current;
            const fresh = last !== null && last.id === uid && Date.now() - last.at < 10_000;
            if (!fresh && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
              const profile = await fetchUserProfile(uid);
              profileFetchRef.current = { id: uid, at: Date.now() };
              if (mounted) setUser(profile);
            }
            await loadRolesOnce();
          } else if (mounted) {
            setUser(null);
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        console.error('Supabase sign-in failed:', error);
        return { error: error.message || 'Unable to sign in.' };
      }
      const profile = data.user ? await loadProfile(data.user.id) : null;
      if (!profile) {
        await supabase.auth.signOut();
        return { error: 'Your account profile is not ready. Contact an administrator.' };
      }
      if (profile.approval_status === 'pending') {
        await supabase.auth.signOut();
        return { error: 'Your registration is awaiting administrator approval.' };
      }
      if (profile.approval_status === 'rejected' || !profile.is_active) {
        await supabase.auth.signOut();
        return { error: profile.approval_reason || 'This account is not active. Contact an administrator.' };
      }
      return { error: null };
    },
    [loadProfile],
  );

  const registerStaff = useCallback(async (fullName: string, email: string, password: string) => {
    const { error } = await supabase.functions.invoke('register-staff', {
      body: { full_name: fullName.trim(), email: email.trim().toLowerCase(), password },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    clearQueryCache();
    profileFetchRef.current = null;
    rolesLoadedRef.current = false;
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;

    let timeoutId: number | undefined;
    const resetInactivityTimer = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void signOut();
      }, 120_000);
    };
    const activityEvents = ['mousedown', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    activityEvents.forEach((event) => window.addEventListener(event, resetInactivityTimer));
    resetInactivityTimer();

    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, resetInactivityTimer));
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [session?.user?.id, signOut]);

  return (
    <AuthContext.Provider value={{ session, user, roles, loading, signIn, registerStaff, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
