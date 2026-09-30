import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";

// A stand-in for Supabase auth: tests set whether it is configured, the stored session,
// and push auth changes through the captured listener.
const auth = vi.hoisted(() => ({
  configured: true,
  session: null as Session | null,
  listeners: new Set<(s: Session | null) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  isConfigured: () => auth.configured,
  getSession: vi.fn(async () => auth.session),
  onAuthChange: (cb: (s: Session | null) => void) => {
    auth.listeners.add(cb);
    return () => auth.listeners.delete(cb);
  },
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));

import * as supabase from "@/lib/supabase";
import { AuthGate } from "./AuthGate";
import { AccountControls } from "./AccountControls";

const session = { user: { email: "someone@example.com" } } as Session;

function emit(s: Session | null) {
  act(() => auth.listeners.forEach((cb) => cb(s)));
}

beforeEach(() => {
  auth.configured = true;
  auth.session = null;
  auth.listeners.clear();
  vi.mocked(supabase.signIn).mockReset().mockResolvedValue(undefined);
});

describe("AuthGate", () => {
  it("explains the setup when Supabase is not configured", () => {
    auth.configured = false;
    render(<AuthGate>秘密の中身</AuthGate>);
    expect(screen.getByText("Supabase が未設定です")).toBeTruthy();
    expect(screen.queryByText("秘密の中身")).toBeNull();
  });

  it("shows the content straight away when a session is stored", async () => {
    auth.session = session;
    render(<AuthGate>ダッシュボード</AuthGate>);
    expect(screen.getByRole("status").textContent).toBe("読み込み中…");
    expect(await screen.findByText("ダッシュボード")).toBeTruthy();
  });

  it("signs in with the email and password and then shows the content", async () => {
    const user = userEvent.setup();
    render(<AuthGate>ダッシュボード</AuthGate>);
    // The only thing to do on this screen is type the address, so the cursor is already there (SHIG 41, 65).
    const email = await screen.findByLabelText("メールアドレス");
    expect(document.activeElement).toBe(email);
    await user.type(email, "someone@example.com");
    await user.type(screen.getByLabelText("パスワード"), "pw{Enter}");
    expect(supabase.signIn).toHaveBeenCalledWith("someone@example.com", "pw");

    emit(session);
    expect(screen.getByText("ダッシュボード")).toBeTruthy();
    // Signing out elsewhere brings the form back.
    emit(null);
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });

  it("shows why signing in failed and lets the user try again", async () => {
    vi.mocked(supabase.signIn).mockRejectedValueOnce(new Error("Invalid login credentials"));
    const user = userEvent.setup();
    render(<AuthGate>ダッシュボード</AuthGate>);
    await user.type(await screen.findByLabelText("メールアドレス"), "someone@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    // The raw Supabase message is translated into what to do next.
    expect(screen.getByRole("alert").textContent).toBe("メールアドレスかパスワードが違います。");
    expect(screen.getByRole("button", { name: "ログイン" }).hasAttribute("disabled")).toBe(false);
  });

  it("disables the button while signing in", async () => {
    let finish!: () => void;
    vi.mocked(supabase.signIn).mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    const user = userEvent.setup();
    render(<AuthGate>ダッシュボード</AuthGate>);
    await user.type(await screen.findByLabelText("メールアドレス"), "someone@example.com");
    await user.type(screen.getByLabelText("パスワード"), "pw");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(screen.getByRole("button", { name: "認証中…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });

  it("stops listening after unmounting", async () => {
    const { unmount } = render(<AuthGate>x</AuthGate>);
    await screen.findByLabelText("メールアドレス");
    expect(auth.listeners.size).toBe(1);
    unmount();
    expect(auth.listeners.size).toBe(0);
  });
});

describe("AccountControls", () => {
  it("renders nothing while signed out or unconfigured", async () => {
    auth.configured = false;
    const { container } = render(<AccountControls />);
    expect(container.textContent).toBe("");
  });

  it("shows the account and signs out", async () => {
    auth.session = session;
    const user = userEvent.setup();
    const { unmount } = render(<AccountControls />);
    expect(await screen.findByText("someone@example.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(supabase.signOut).toHaveBeenCalled();
    emit(null);
    expect(screen.queryByText("someone@example.com")).toBeNull();
    unmount();
    expect(auth.listeners.size).toBe(0);
  });
});
