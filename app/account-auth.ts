import { headers } from "next/headers";
import { ensureAccountSchema, getAccountEnvironment } from "../db/account-store";

export const SESSION_COOKIE = "rocket_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 210_000;

export type AccountUser = { id: string; email: string; displayName: string };

type AccountRow = { id: string; email: string; display_name: string };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomSalt(bytes = 18) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt = randomSalt()) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return { salt, hash: bytesToBase64(new Uint8Array(bits)) };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = await hashPassword(password, salt);
  if (actual.hash.length !== expectedHash.length) return false;
  let different = 0;
  for (let index = 0; index < actual.hash.length; index += 1) different |= actual.hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return different === 0;
}

export function cookieValue(cookieHeader: string | null, name: string) {
  for (const item of (cookieHeader ?? "").split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function sessionCookie(token: string, requestUrl: string) {
  const secure = !["localhost", "127.0.0.1"].includes(new URL(requestUrl).hostname);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(requestUrl: string) {
  const secure = !["localhost", "127.0.0.1"].includes(new URL(requestUrl).hostname);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function createAccountSession(accountId: string) {
  await ensureAccountSchema();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await getAccountEnvironment().DB.prepare(`INSERT INTO account_sessions (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), accountId, tokenHash, expiresAt).run();
  return token;
}

export async function deleteAccountSession(token: string | null) {
  if (!token) return;
  await ensureAccountSchema();
  await getAccountEnvironment().DB.prepare(`DELETE FROM account_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

export async function getAccountUserFromCookieHeader(cookieHeader: string | null): Promise<AccountUser | null> {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  await ensureAccountSchema();
  const { DB } = getAccountEnvironment();
  const row = await DB.prepare(`SELECT a.id, a.email, a.display_name FROM account_sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP LIMIT 1`)
    .bind(await sha256(token)).first<AccountRow>();
  if (!row) return null;
  void DB.prepare(`UPDATE account_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?`).bind(await sha256(token)).run();
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function getAccountUser() {
  return getAccountUserFromCookieHeader((await headers()).get("cookie"));
}
