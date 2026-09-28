// User-facing error text (SHIG 55: constructive errors / 11: the user's language).
// Maps common Supabase and network messages to what to do next.

const RULES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "メールアドレスかパスワードが違います。"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "通信できませんでした。電波を確認して再度お試しください。"],
  [/email not confirmed/i, "メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください。"],
  [/jwt expired|invalid jwt|refresh token/i, "ログインの有効期限が切れました。ログインし直してください。"],
  // Postgres constraint errors the record editor can hit (unique key, date checks, empty dates).
  [/duplicate key|unique constraint/i, "同じ建物・種別・期間の記録がすでにあります。期間か建物を確認してください。"],
  [/check constraint/i, "期間の終わりが始まりより前になっています。日付を確認してください。"],
  [/invalid input syntax for type date|date\/time field value out of range/i, "日付が正しくありません。日付を入れ直してください。"],
];

/** Converts an error (or message) into Japanese text that says what to do next. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, text] of RULES) {
    if (pattern.test(message)) return text;
  }
  // Messages the app itself throws are already written for the user.
  if (/[぀-ヿ一-鿿]/.test(message)) return message;
  return `うまくいきませんでした。時間をおいて再度お試しください。（詳細: ${message}）`;
}
