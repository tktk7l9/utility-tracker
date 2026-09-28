import { describe, it, expect } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("explains wrong credentials", () => {
    expect(friendlyError(new Error("Invalid login credentials"))).toBe("メールアドレスかパスワードが違います。");
  });

  it("explains network failures", () => {
    const expected = "通信できませんでした。電波を確認して再度お試しください。";
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe(expected);
    expect(friendlyError("NetworkError when attempting to fetch resource.")).toBe(expected);
    expect(friendlyError("Load failed")).toBe(expected);
  });

  it("explains an unconfirmed email address", () => {
    expect(friendlyError("Email not confirmed")).toBe("メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください。");
  });

  it("explains an expired session", () => {
    const expected = "ログインの有効期限が切れました。ログインし直してください。";
    expect(friendlyError("JWT expired")).toBe(expected);
    expect(friendlyError("Invalid Refresh Token: Refresh Token Not Found")).toBe(expected);
  });

  it("keeps Japanese messages written by the app as they are", () => {
    expect(friendlyError(new Error("この建物に紐づくレコードがあるため削除できません。"))).toBe(
      "この建物に紐づくレコードがあるため削除できません。"
    );
  });

  it("wraps unknown messages with a next step", () => {
    expect(friendlyError("duplicate key value")).toBe(
      "うまくいきませんでした。時間をおいて再度お試しください。（詳細: duplicate key value）"
    );
  });
});
