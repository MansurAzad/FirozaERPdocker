import type { Session, User } from "@supabase/supabase-js";

export type AuthMethods = {
  getUser: () => Promise<{ data: { user: User | null }; error: Error | null }>;
  getSession: () => Promise<{ data: { session: Session | null }; error: Error | null }>;
};

function isValidSession(session: Session | null): session is Session {
  return Boolean(session && (!session.expires_at || session.expires_at * 1000 > Date.now()));
}

export async function resolveAuthenticatedUser(
  auth: AuthMethods,
  offline = false,
): Promise<User | null> {
  if (offline) {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    return isValidSession(data.session) ? data.session.user : null;
  }

  const { data, error } = await auth.getUser();
  if (!error) return data.user;

  const { data: sessionData, error: sessionError } = await auth.getSession();
  if (sessionError) throw error;
  if (isValidSession(sessionData.session)) return sessionData.session.user;
  throw error;
}
