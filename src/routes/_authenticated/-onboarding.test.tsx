import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, signOutMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/branding-context", () => ({
  useBranding: () => ({ name: "FIROZA ENTERPRISE" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: signOutMock,
    },
  },
}));

import { Onboarding } from "./onboarding";

describe("onboarding access-pending flow", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signOutMock.mockReset();
  });

  it("shows the access-pending message and routes to the app or sign-out flow", async () => {
    render(<Onboarding />);

    expect(screen.getByText("অ্যাকাউন্ট তৈরি হয়েছে")).toBeInTheDocument();
    expect(
      screen.getByText(/Owner-কে আপনার ইমেইলটি Team পেজ থেকে যোগ করে/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /অ্যাক্সেস যাচাই করুন/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/app", replace: true });

    navigateMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /সাইন আউট/i }));
    expect(signOutMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith({ to: "/auth", replace: true });
    });
  });
});
