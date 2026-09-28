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

  it("explains database constraint errors without database words", () => {
    expect(
      friendlyError('duplicate key value violates unique constraint "readings_user_building_utility_period_key"')
    ).toBe("同じ建物・種別・期間の記録がすでにあります。期間か建物を確認してください。");
    expect(friendlyError('new row for relation "buildings" violates check constraint "buildings_period_check"')).toBe(
      "期間の終わりが始まりより前になっています。日付を確認してください。"
    );
    expect(friendlyError('invalid input syntax for type date: ""')).toBe("日付が正しくありません。日付を入れ直してください。");
    expect(friendlyError('date/time field value out of range: "2026-02-30"')).toBe(
      "日付が正しくありません。日付を入れ直してください。"
    );
  });

  it("keeps Japanese messages written by the app as they are", () => {
    expect(friendlyError(new Error("この建物に紐づくレコードがあるため削除できません。"))).toBe(
      "この建物に紐づくレコードがあるため削除できません。"
    );
  });

  it("wraps unknown messages with a next step", () => {
    expect(friendlyError("permission denied for table readings")).toBe(
      "うまくいきませんでした。時間をおいて再度お試しください。（詳細: permission denied for table readings）"
    );
  });
});
