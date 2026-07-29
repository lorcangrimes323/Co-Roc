import { clearSessionCookie, cookieValue, createAccountSession, deleteAccountSession, getAccountUserFromCookieHeader, hashPassword, PASSWORD_ITERATIONS, SESSION_COOKIE, sessionCookie, sha256, verifyPassword } from "../../account-auth";
import { ensureAccountSchema, getAccountEnvironment } from "../../../db/account-store";
import { ensureAccessSchema } from "../../../db/access-store";
import { hasTrustedRequestOrigin } from "../../request-origin";

type StoredAccount = { id: string; email: string; display_name: string; password_hash: string; password_salt: string; password_iterations: number };
type AttemptRow = { attempts: number; window_started_at: string; locked_until: string | null };
type InviteRow = { id: string; team_id: string; team_name: string; role: "engineer" | "viewer"; max_uses: number; use_count: number; expires_at: string; active: number };

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizedTeamCode(value: unknown) {
  return clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
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
  if (!hasTrustedRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
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
    const teamCode = normalizedTeamCode(body.teamCode);
    if (displayName.length < 2) return Response.json({ error: "Enter your name." }, { status: 400 });
    const exists = await DB.prepare(`SELECT id FROM accounts WHERE lower(email) = lower(?)`).bind(email).first<{ id: string }>();
    if (exists) return Response.json({ error: "An account already exists for this email. Sign in instead." }, { status: 409 });
    let invite: InviteRow | null = null;
    let projectIds: string[] = [];
    if (teamCode) {
      await ensureAccessSchema();
      invite = await DB.prepare(`SELECT c.id, c.team_id, t.name AS team_name, c.role, c.max_uses, c.use_count, c.expires_at, c.active
        FROM team_invite_codes c JOIN teams t ON t.id = c.team_id
        WHERE c.code_hash = ? LIMIT 1`).bind(await sha256(teamCode)).first<InviteRow>();
      if (!invite || !invite.active || invite.use_count >= invite.max_uses || new Date(invite.expires_at).getTime() <= Date.now()) {
        return Response.json({ error: "That team code is invalid, expired or has reached its member limit." }, { status: 400 });
      }
      const rows = await DB.prepare(`SELECT project_id FROM invite_code_projects WHERE invite_code_id = ?`).bind(invite.id).all<{ project_id: string }>();
      projectIds = rows.results.map((row) => row.project_id);
      if (!projectIds.length) return Response.json({ error: "That team code has no rocket access assigned. Ask your team lead to replace it." }, { status: 409 });
      const claimed = await DB.prepare(`UPDATE team_invite_codes SET use_count = use_count + 1
        WHERE id = ? AND active = 1 AND use_count < max_uses AND expires_at > CURRENT_TIMESTAMP`).bind(invite.id).run();
      if ((claimed.meta.changes ?? 0) !== 1) return Response.json({ error: "That team code was just used up. Ask your team lead for another." }, { status: 409 });
    }
    const accountId = crypto.randomUUID();
    const passwordRecord = await hashPassword(password);
    try {
      const statements = [
        DB.prepare(`INSERT INTO accounts (id, email, display_name, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(accountId, email, displayName, passwordRecord.hash, passwordRecord.salt, PASSWORD_ITERATIONS),
      ];
      if (invite) {
        statements.push(
          DB.prepare(`INSERT INTO team_members (team_id, email, display_name, role, status, project_scope, invited_by_email)
            VALUES (?, ?, ?, ?, 'active', 'selected', ?)
            ON CONFLICT(team_id, email) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, status = 'active', project_scope = 'selected', updated_at = CURRENT_TIMESTAMP`)
            .bind(invite.team_id, email, displayName, invite.role, "team-code"),
          DB.prepare(`DELETE FROM member_project_access WHERE team_id = ? AND lower(member_email) = lower(?)`).bind(invite.team_id, email),
          ...projectIds.map((projectId) => DB.prepare(`INSERT INTO member_project_access (team_id, member_email, project_id, granted_by_email) VALUES (?, ?, ?, ?)`)
            .bind(invite!.team_id, email, projectId, "team-code")),
          DB.prepare(`INSERT INTO team_events (team_id, action, target_type, target_id, summary, actor_name, actor_email)
            VALUES (?, 'code.joined', 'member', ?, ?, ?, ?)`)
            .bind(invite.team_id, email, `${displayName} joined with a team code as ${invite.role}`, displayName, email),
        );
      }
      await DB.batch(statements);
    } catch (error) {
      if (invite) await DB.prepare(`UPDATE team_invite_codes SET use_count = max(0, use_count - 1) WHERE id = ?`).bind(invite.id).run();
      throw error;
    }
    const token = await createAccountSession(accountId);
    return Response.json({ user: { id: accountId, email, displayName }, joinedTeam: invite ? { id: invite.team_id, name: invite.team_name, role: invite.role, projectCount: projectIds.length } : null }, { status: 201, headers: { "set-cookie": sessionCookie(token, request.url) } });
  }

  if (action === "signin") {
    const account = await DB.prepare(`SELECT id, email, display_name, password_hash, password_salt, password_iterations FROM accounts WHERE lower(email) = lower(?) LIMIT 1`)
      .bind(email).first<StoredAccount>();
    if (!account || !await verifyPassword(password, account.password_salt, account.password_hash, account.password_iterations)) {
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
  if (!hasTrustedRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  await deleteAccountSession(token);
  return Response.json({ signedOut: true }, { headers: { "set-cookie": clearSessionCookie(request.url) } });
}
