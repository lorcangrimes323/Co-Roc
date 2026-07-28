import { clearSessionCookie, cookieValue, createAccountSession, deleteAccountSession, getAccountUserFromCookieHeader, hashPassword, SESSION_COOKIE, sessionCookie, sha256, verifyPassword } from "../../account-auth";
import { ensureAccountSchema, getAccountEnvironment } from "../../../db/account-store";

type StoredAccount = { id: string; email: string; display_name: string; password_hash: string; password_salt: string };
type AttemptRow = { attempts: number; window_started_at: string; locked_until: string | null };

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function attemptKey(request: Request, email: string) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  return sha256(`${email.toLowerCase()}|${address.trim()}`);
}

async function checkRateLimit(request: Request, email: string) {
  const { DB } = getAccountEnvironment();
  const key = await attemptKey(request, email);
  const row = await DB.prepare(`SELECT attempts, window_started_at, locked_until FROM auth_attempts WHERE key = ?`).bind(key).first<AttemptRow>();
  const now = Date.now();
  if (row?.locked_until && new Date(row.locked_until).getTime() > now) return { allowed: false, key };
  if (row && now - new Date(row.window_started_at).getTime() > 15 * 60_000) {
    await DB.prepare(`DELETE FROM auth_attempts WHERE key = ?`).bind(key).run();
  }
  return { allowed: true, key };
}

async function recordFailure(key: string) {
  const { DB } = getAccountEnvironment();
  const existing = await DB.prepare(`SELECT attempts FROM auth_attempts WHERE key = ?`).bind(key).first<{ attempts: number }>();
  const attempts = (existing?.attempts ?? 0) + 1;
  const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  await DB.prepare(`INSERT INTO auth_attempts (key, attempts, window_started_at, locked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until`)
    .bind(key, attempts, new Date().toISOString(), lockedUntil).run();
}

export async function GET(request: Request) {
  const user = await getAccountUserFromCookieHeader(request.headers.get("cookie"));
  return Response.json({ authenticated: Boolean(user), user });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  await ensureAccountSchema();
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "A valid request is required." }, { status: 400 }); }
  const action = clean(body.action, 20);
  const email = clean(body.email, 180).toLowerCase();
  const password = String(body.password ?? "");
  if (!validEmail(email) || password.length < 10 || password.length > 200) {
    return Response.json({ error: "Use a valid email and a password of at least 10 characters." }, { status: 400 });
  }

  const rate = await checkRateLimit(request, email);
  if (!rate.allowed) return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  const { DB } = getAccountEnvironment();

  if (action === "signup") {
    const displayName = clean(body.displayName, 100);
    if (displayName.length < 2) return Response.json({ error: "Enter your name." }, { status: 400 });
    const exists = await DB.prepare(`SELECT id FROM accounts WHERE lower(email) = lower(?)`).bind(email).first<{ id: string }>();
    if (exists) return Response.json({ error: "An account already exists for this email. Sign in instead." }, { status: 409 });
    const accountId = crypto.randomUUID();
    const passwordRecord = await hashPassword(password);
    await DB.prepare(`INSERT INTO accounts (id, email, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)`)
      .bind(accountId, email, displayName, passwordRecord.hash, passwordRecord.salt).run();
    const token = await createAccountSession(accountId);
    return Response.json({ user: { id: accountId, email, displayName } }, { status: 201, headers: { "set-cookie": sessionCookie(token, request.url) } });
  }

  if (action === "signin") {
    const account = await DB.prepare(`SELECT id, email, display_name, password_hash, password_salt FROM accounts WHERE lower(email) = lower(?) LIMIT 1`)
      .bind(email).first<StoredAccount>();
    if (!account || !await verifyPassword(password, account.password_salt, account.password_hash)) {
      await recordFailure(rate.key);
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await DB.prepare(`DELETE FROM auth_attempts WHERE key = ?`).bind(rate.key).run();
    await DB.prepare(`DELETE FROM account_sessions WHERE account_id = ? AND expires_at <= CURRENT_TIMESTAMP`).bind(account.id).run();
    const token = await createAccountSession(account.id);
    return Response.json({ user: { id: account.id, email: account.email, displayName: account.display_name } }, { headers: { "set-cookie": sessionCookie(token, request.url) } });
  }

  return Response.json({ error: "Unsupported account action." }, { status: 400 });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  await deleteAccountSession(token);
  return Response.json({ signedOut: true }, { headers: { "set-cookie": clearSessionCookie(request.url) } });
}
