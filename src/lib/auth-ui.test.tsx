import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  entryMock,
  getSessionMock,
  navigateMock,
  onAuthStateChangeMock,
  signInMock,
  signUpMock,
  signInWithOAuthMock,
  toastErrorMock,
  toastSuccessMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  entryMock: { value: undefined as "brandshops" | "house" | undefined },
  getSessionMock: vi.fn(),
  navigateMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signInMock: vi.fn(),
  signUpMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/branding-context", () => ({
  useBranding: () => ({ name: "FIROZA ENTERPRISE" }),
}));

vi.mock("@/lib/branding.functions", () => ({
  getSiteBranding: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: signInMock,
      signUp: signUpMock,
    },
  },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: {
    auth: { signInWithOAuth: signInWithOAuthMock },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

import { AuthPage } from "../components/auth-page";

describe("sign-in flow", () => {
  let authStateCallback:
    ((event: string, session: { expires_at: number } | null) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    entryMock.value = undefined;
    authStateCallback = undefined;
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    onAuthStateChangeMock.mockImplementation((callback) => {
      authStateCallback = callback;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });
    navigateMock.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  async function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "staff@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/ }));
  }

  it("opens the dashboard after successful sign-in", async () => {
    const signedInSession = { expires_at: Math.floor(Date.now() / 1000) + 3600 };
    signInMock.mockImplementation(async () => {
      authStateCallback?.("SIGNED_IN", signedInSession);
      return { data: { session: signedInSession }, error: null };
    });
    render(<AuthPage entry={entryMock.value} />);

    await fillAndSubmit();

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith({
        email: "staff@example.com",
        password: "correct-horse-battery",
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/app", replace: true });
    });
  });

  it("preserves the selected brand-shop destination after sign-in", async () => {
    entryMock.value = "brandshops";
    const signedInSession = { expires_at: Math.floor(Date.now() / 1000) + 3600 };
    signInMock.mockImplementation(async () => {
      authStateCallback?.("SIGNED_IN", signedInSession);
      return { data: { session: signedInSession }, error: null };
    });
    render(<AuthPage entry={entryMock.value} />);

    await fillAndSubmit();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/app/brand-shops", replace: true });
    });
  });

  it("shows a network error and re-enables sign-in after a rejected request", async () => {
    signInMock.mockRejectedValue(new Error("Network unavailable"));
    render(<AuthPage entry={entryMock.value} />);

    await fillAndSubmit();

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Network unavailable");
      expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeEnabled();
    });
  });

  it("does not redirect to the dashboard with an expired persisted session", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { expires_at: 1 } },
      error: null,
    });
    render(<AuthPage entry={entryMock.value} />);

    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
