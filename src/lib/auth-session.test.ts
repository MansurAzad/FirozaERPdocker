import { describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import { resolveAuthenticatedUser, type AuthMethods } from "./auth-session";

const user = { id: "user-1" } as User;
const session = { user, expires_at: Math.floor(Date.now() / 1000) + 3600 } as Session;

function auth(getUser: AuthMethods["getUser"], getSession: AuthMethods["getSession"]) {
  return { getUser, getSession };
}

describe("resolveAuthenticatedUser", () => {
  it("uses the current user returned by Supabase", async () => {
    const getUser = vi.fn<AuthMethods["getUser"]>().mockResolvedValue({
      data: { user },
      error: null,
    });
    const getSession = vi.fn<AuthMethods["getSession"]>();

    await expect(resolveAuthenticatedUser(auth(getUser, getSession))).resolves.toBe(user);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses an unexpired persisted session when user verification temporarily fails", async () => {
    const getUser = vi.fn<AuthMethods["getUser"]>().mockResolvedValue({
      data: { user: null },
      error: new Error("Network unavailable"),
    });
    const getSession = vi.fn<AuthMethods["getSession"]>().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(resolveAuthenticatedUser(auth(getUser, getSession))).resolves.toBe(user);
  });

  it("does not accept an expired session after user verification fails", async () => {
    const error = new Error("Invalid token");
    const getUser = vi
      .fn<AuthMethods["getUser"]>()
      .mockResolvedValue({ data: { user: null }, error });
    const getSession = vi.fn<AuthMethods["getSession"]>().mockResolvedValue({
      data: { session: { ...session, expires_at: 1 } },
      error: null,
    });

    await expect(resolveAuthenticatedUser(auth(getUser, getSession))).rejects.toBe(error);
  });

  it("uses a valid persisted session without a network verification while offline", async () => {
    const getUser = vi.fn<AuthMethods["getUser"]>();
    const getSession = vi.fn<AuthMethods["getSession"]>().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(resolveAuthenticatedUser(auth(getUser, getSession), true)).resolves.toBe(user);
    expect(getUser).not.toHaveBeenCalled();
  });
});
