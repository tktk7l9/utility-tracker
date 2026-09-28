// User-facing error text (SHIG 55: constructive errors / 11: the user's language).
// Maps common Supabase and network messages to what to do next.

const RULES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "メールアドレスかパスワードが違います。"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "通信できませんでした。電波を確認して再度お試しください。"],
  [/email not confirmed/i, "メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください。"],
  [/jwt expired|invalid jwt|refresh token/i, "ログインの有効期限が切れました。ログインし直してください。"],
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
