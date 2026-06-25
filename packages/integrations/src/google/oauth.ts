import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Auth } from "googleapis";
import { google } from "googleapis";

import { credentialsPath } from "../paths";

/** 読み取り専用スコープ（書き込みなし） */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

const REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

/** 認可URLを組み立てる（純粋関数・テスト対象） */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri ?? REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function oauthClient(): Auth.OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です");
  }
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

interface StoredCredentials {
  google?: { refresh_token: string; obtained_at: number };
}

function readStored(): StoredCredentials {
  if (!existsSync(credentialsPath)) return {};
  return JSON.parse(readFileSync(credentialsPath, "utf8")) as StoredCredentials;
}

/** Web ルートから呼ぶ: 認可URLを返す */
export function getAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID が未設定です");
  return buildAuthUrl({ clientId });
}

/** Web ルートから呼ぶ: code を token に交換し refresh token を保存 */
export async function exchangeCodeAndSave(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("refresh_token を取得できませんでした（再認可が必要）");
  }
  mkdirSync(dirname(credentialsPath), { recursive: true });
  const next: StoredCredentials = {
    ...readStored(),
    google: { refresh_token: tokens.refresh_token, obtained_at: Date.now() },
  };
  writeFileSync(credentialsPath, JSON.stringify(next, null, 2), "utf8");
  chmodSync(credentialsPath, 0o600);
}

/** 接続済みか（refresh token を保持しているか） */
export function isConnected(): boolean {
  return Boolean(readStored().google?.refresh_token);
}

/** 同期処理用の認可済みクライアントを返す。未接続なら null。 */
export function loadGoogleAuth(): Auth.OAuth2Client | null {
  const refreshToken = readStored().google?.refresh_token;
  if (!refreshToken) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
