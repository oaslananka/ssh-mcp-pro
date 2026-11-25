import type { DatabaseSync } from "node:sqlite";
import { REVIEWER_DEMO_USER_ID, type GitHubUser, type GoogleUser } from "./types.js";
import { rowString, optionalRowString } from "./store-row-values.js";

export class RemoteAccountStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Read-only, bounded usage aggregates for explicitly configured service owners. */
  getServiceUsage(): {
    registeredUsers: number;
    registeredAgents: number;
    totalActions: number;
    actionsLast7Days: number;
    actionsLast30Days: number;
    completedActions: number;
    failedActions: number;
    accounts: Array<{
      provider: string;
      label: string;
      agents: number;
      actions: number;
      lastActionAt: string | null;
    }>;
  } {
    const count = (sql: string): number => Number((this.db.prepare(sql).get() as { n: number }).n);
    const accounts = this.db
      .prepare(
        `SELECT u.provider,
              CASE WHEN u.provider = 'github' THEN u.github_login
                   ELSE COALESCE(u.email, 'Google account') END AS label,
              (SELECT COUNT(*) FROM agents a WHERE a.user_id = u.id) AS agents,
              (SELECT COUNT(*) FROM actions ac WHERE ac.user_id = u.id) AS actions,
              (SELECT MAX(ac.issued_at) FROM actions ac WHERE ac.user_id = u.id) AS lastActionAt
       FROM users u
       WHERE u.provider <> 'demo'
       ORDER BY u.created_at DESC LIMIT 100`,
      )
      .all() as Array<{
      provider: string;
      label: string;
      agents: number;
      actions: number;
      lastActionAt: string | null;
    }>;
    return {
      registeredUsers: count("SELECT COUNT(*) AS n FROM users WHERE provider <> 'demo'"),
      registeredAgents: count("SELECT COUNT(*) AS n FROM agents"),
      totalActions: count("SELECT COUNT(*) AS n FROM actions"),
      actionsLast7Days: count(
        "SELECT COUNT(*) AS n FROM actions WHERE issued_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')",
      ),
      actionsLast30Days: count(
        "SELECT COUNT(*) AS n FROM actions WHERE issued_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
      ),
      completedActions: count("SELECT COUNT(*) AS n FROM actions WHERE status = 'completed'"),
      failedActions: count(
        "SELECT COUNT(*) AS n FROM actions WHERE status IN ('error', 'timeout')",
      ),
      accounts,
    };
  }

  /** Bounded, per-user usage summary for dashboard usage reporting. */
  getUserUsage(userId: string): {
    callsThisMonth: number;
    limit: number;
    dailyAverage: number;
    daysElapsed: number;
    daysRemaining: number;
    percentUsed: number;
    resetDate: string;
    callsOverTime: Array<{ month: string; count: number }>;
  } {
    const now = new Date();
    const monthNames = [
      "Oca",
      "Şub",
      "Mar",
      "Nis",
      "May",
      "Haz",
      "Tem",
      "Ağu",
      "Eyl",
      "Eki",
      "Kas",
      "Ara",
    ];
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysRemaining = Math.max(
      0,
      Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const daysElapsed = Math.max(1, now.getUTCDate());

    const monthRow = this.db
      .prepare("SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND issued_at >= ?")
      .get(userId, startOfMonth) as { n: number } | undefined;
    const callsThisMonth = Number(monthRow?.n ?? 0);
    const limit = 10_000;
    const dailyAverage = Math.round(callsThisMonth / daysElapsed);
    const percentUsed = Math.min(100, Math.round((callsThisMonth / limit) * 100));
    const resetDate = `1 ${monthNames[nextMonth.getUTCMonth()] ?? "Gelecek Ay"}`;

    const callsOverTime: Array<{ month: string; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const mDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const mStart = mDate.toISOString();
      const mEnd = new Date(
        Date.UTC(mDate.getUTCFullYear(), mDate.getUTCMonth() + 1, 1),
      ).toISOString();
      const countRow = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND issued_at >= ? AND issued_at < ?",
        )
        .get(userId, mStart, mEnd) as { n: number } | undefined;
      const count = Number(countRow?.n ?? 0);
      callsOverTime.push({
        month: monthNames[mDate.getUTCMonth()] ?? "",
        count,
      });
    }

    return {
      callsThisMonth,
      limit,
      dailyAverage,
      daysElapsed,
      daysRemaining,
      percentUsed,
      resetDate,
      callsOverTime,
    };
  }

  createDashboardSession(
    tokenHash: string,
    userId: string,
    expiresAt: string,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO dashboard_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(tokenHash, userId, expiresAt, createdAt);
  }

  getDashboardSession(tokenHash: string, now: string): { userId: string } | undefined {
    const row = this.db
      .prepare("SELECT user_id FROM dashboard_sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, now) as Record<string, unknown> | undefined;
    return row ? { userId: rowString(row, "user_id") } : undefined;
  }

  deleteDashboardSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM dashboard_sessions WHERE token_hash = ?").run(tokenHash);
  }

  upsertUser(user: GitHubUser & { internalId: string; now: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, github_id, github_login, display_name, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'github', ?, ?)
         ON CONFLICT(id) DO UPDATE SET github_id = excluded.github_id, github_login = excluded.github_login, display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .run(user.internalId, user.id, user.login, user.login, user.now, user.now);
  }

  upsertReviewerUser(now: string): void {
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, provider, created_at, updated_at)
         VALUES (?, 'OpenAI Reviewer (Sample Tenant)', 'demo', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(REVIEWER_DEMO_USER_ID, now, now);
    if (this.getUserById(REVIEWER_DEMO_USER_ID)?.provider !== "demo") {
      throw new Error("Reserved reviewer identity is already owned by another provider");
    }
  }

  upsertGoogleUser(user: GoogleUser & { internalId: string; now: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, google_id, email, display_name, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'google', ?, ?)
         ON CONFLICT(id) DO UPDATE SET google_id = excluded.google_id, email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .run(user.internalId, user.id, user.email, user.name, user.now, user.now);
  }

  getUserByGitHubId(githubId: string):
    | {
        id: string;
        githubId: string;
        githubLogin: string;
        email?: string | undefined;
        displayName?: string | undefined;
      }
    | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE github_id = ?").get(githubId) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      githubId: rowString(row, "github_id"),
      githubLogin: rowString(row, "github_login"),
      email: optionalRowString(row, "email"),
      displayName: optionalRowString(row, "display_name") ?? rowString(row, "github_login"),
    };
  }

  getUserByGoogleId(
    googleId: string,
  ): { id: string; googleId: string; email?: string | undefined; displayName: string } | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      googleId: rowString(row, "google_id"),
      email: optionalRowString(row, "email"),
      displayName: rowString(row, "display_name"),
    };
  }

  getUserById(id: string):
    | {
        id: string;
        githubId?: string | undefined;
        githubLogin?: string | undefined;
        googleId?: string | undefined;
        email?: string | undefined;
        displayName: string;
        provider: "github" | "google" | "demo";
      }
    | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    const provider = optionalRowString(row, "provider");
    return {
      id: rowString(row, "id"),
      githubId: optionalRowString(row, "github_id"),
      githubLogin: optionalRowString(row, "github_login"),
      googleId: optionalRowString(row, "google_id"),
      email: optionalRowString(row, "email"),
      displayName:
        optionalRowString(row, "display_name") ??
        optionalRowString(row, "github_login") ??
        optionalRowString(row, "email") ??
        "User",
      provider: provider === "google" || provider === "demo" ? provider : "github",
    };
  }
}
