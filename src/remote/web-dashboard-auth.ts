import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { hashSecret, id, randomToken } from "./crypto.js";
import { capabilitiesFromScopes } from "./scopes.js";
import { addNoStore, redirect, safeError } from "./http-util.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { RemoteStore } from "./store.js";
import type { RemoteConfig, RemotePrincipal } from "./types.js";
import { PUBLIC_REMOTE_SCOPES } from "./types.js";
import { jsonResponse } from "./util.js";
import { fetchGitHubUserDirect, fetchGoogleUserDirect } from "./web-dashboard-oauth-users.js";

export class DashboardAuthHandler {
  private readonly webAuthTransactions = new Map<
    string,
    { state: string; provider: "github" | "google"; expiresAt: number; nonce?: string }
  >();

  constructor(
    private readonly deps: { config: RemoteConfig; store: RemoteStore; oauth: OAuthHandler },
  ) {}

  /** Service-wide metrics are opt-in; an ordinary tenant must never see others' accounts. */
  isUsageOwner(principal: RemotePrincipal): boolean {
    const githubLogins = new Set(
      (process.env.SSH_MCP_DASHBOARD_OWNER_GITHUB_LOGINS ?? "")
        .split(",")
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean),
    );
    const googleEmails = new Set(
      (process.env.SSH_MCP_DASHBOARD_OWNER_GOOGLE_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
    return (
      (principal.provider === "github" && githubLogins.has(principal.githubLogin.toLowerCase())) ||
      (principal.provider === "google" &&
        !!principal.email &&
        googleEmails.has(principal.email.toLowerCase()))
    );
  }

  private readonly sessionCookieName = "ssh_mcp_web_session";

  private sessionCookie(value: string, maxAge = 86_400): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${this.sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private authTransactionCookie(
    state: string,
    maxAge = 600,
    path: "/auth" | "/oauth" = "/auth",
  ): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `ssh_mcp_web_tx=${state}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private extractSessionToken(req: IncomingMessage): string | undefined {
    const cookies = (req.headers.cookie ?? "").split(";").map((part) => part.trim());
    const entry = cookies.find((part) => part.startsWith(`${this.sessionCookieName}=`));
    const token = entry?.slice(this.sessionCookieName.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : undefined;
  }

  private matchingAuthTransaction(req: IncomingMessage, state: string): boolean {
    return (req.headers.cookie ?? "")
      .split(";")
      .some((part) => part.trim() === `ssh_mcp_web_tx=${state}`);
  }

  private createWebSession(userId: string): string {
    const token = randomToken(32);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    this.deps.store.createDashboardSession(hashSecret(token), userId, expiresAt, createdAt);
    return this.sessionCookie(token);
  }

  assertBrowserMutation(req: IncomingMessage): void {
    const expectedOrigin = new URL(this.deps.config.publicBaseUrl).origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (
      req.headers.origin !== expectedOrigin ||
      req.headers["x-ssh-mcp-dashboard"] !== "1" ||
      (fetchSite !== undefined && fetchSite !== "same-origin")
    ) {
      throw safeError("FORBIDDEN", "Cross-site dashboard mutation is not allowed", 403);
    }
  }

  getPrincipalFromSession(req: IncomingMessage): RemotePrincipal | undefined {
    const token = this.extractSessionToken(req);
    if (!token) return undefined;
    const tokenHash = hashSecret(token);
    const session = this.deps.store.getDashboardSession(tokenHash, new Date().toISOString());
    if (!session) return undefined;
    const user = this.deps.store.getUserById(session.userId);
    if (!user || user.provider === "demo") return undefined;
    const scopes = [...PUBLIC_REMOTE_SCOPES];
    return {
      userId: user.id,
      githubId: user.githubId ?? user.googleId ?? user.id,
      githubLogin: user.githubLogin ?? user.displayName,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      scopes,
      capabilities: capabilitiesFromScopes(scopes),
      tokenId: `web_${tokenHash.slice(0, 24)}`,
    };
  }

  async handleAuthRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // 2. Web direct auth endpoints
    if (pathname === "/auth/login/github" && req.method === "GET") {
      this.handleDirectLoginGitHub(req, res);
      return true;
    }
    if (pathname === "/auth/login/google" && req.method === "GET") {
      this.handleDirectLoginGoogle(req, res);
      return true;
    }
    if (pathname === "/auth/callback/github" && req.method === "GET") {
      await this.handleDirectCallbackGitHub(req, res);
      return true;
    }
    if (pathname === "/auth/callback/google" && req.method === "GET") {
      await this.handleDirectCallbackGoogle(req, res);
      return true;
    }
    if (pathname === "/auth/logout" && req.method === "GET") {
      const session = this.extractSessionToken(req);
      if (session) this.deps.store.deleteDashboardSession(hashSecret(session));
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": this.sessionCookie("", 0),
        "Cache-Control": "no-store",
      });
      res.end();
      return true;
    }

    return false;
  }

  private handleDirectLoginGitHub(_req: IncomingMessage, res: ServerResponse): void {
    const testUser = this.deps.oauth.testGitHubUser();
    if (testUser) {
      const user = this.deps.oauth.upsertGitHubUser(testUser);
      const webSessionCookie = this.createWebSession(user.id);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": webSessionCookie,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (!this.deps.config.githubClientId || !this.deps.config.githubClientSecret) {
      throw safeError("FORBIDDEN", "GitHub OAuth is not configured", 503);
    }

    const state = id("webauth");
    this.webAuthTransactions.set(state, {
      state,
      provider: "github",
      expiresAt: Date.now() + 600_000,
    });

    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/github`;
    const githubUrl = new URL("https://github.com/login/oauth/authorize");
    githubUrl.searchParams.set("client_id", this.deps.config.githubClientId);
    githubUrl.searchParams.set("redirect_uri", callbackUrl);
    githubUrl.searchParams.set("scope", "read:user");
    githubUrl.searchParams.set("state", state);

    res.setHeader("Set-Cookie", this.authTransactionCookie(state));
    redirect(res, githubUrl.toString());
  }

  private handleDirectLoginGoogle(_req: IncomingMessage, res: ServerResponse): void {
    const testGoogle = this.deps.oauth.testGoogleUser();
    if (testGoogle) {
      const user = this.deps.oauth.upsertGoogleUser(testGoogle);
      const webSessionCookie = this.createWebSession(user.id);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": webSessionCookie,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (!this.deps.config.googleClientId || !this.deps.config.googleClientSecret) {
      throw safeError("FORBIDDEN", "Google OAuth is not configured", 503);
    }

    const state = id("webauth");
    const nonce = randomToken(24);
    this.webAuthTransactions.set(state, {
      state,
      provider: "google",
      expiresAt: Date.now() + 600_000,
      nonce,
    });

    const callbackUrl = this.deps.config.googleCallbackUrl;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", this.deps.config.googleClientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);
    googleUrl.searchParams.set("nonce", nonce);

    res.setHeader("Set-Cookie", this.authTransactionCookie(state, 600, "/oauth"));
    redirect(res, googleUrl.toString());
  }

  /** Authorization state is one-use even after a rejected callback. */
  private consumeWebAuthTransaction(
    req: IncomingMessage,
    provider: "github" | "google",
  ): { code: string; nonce: string | undefined } {
    const url = new URL(req.url ?? `/auth/callback/${provider}`, this.deps.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const transaction = this.webAuthTransactions.get(state);
    this.webAuthTransactions.delete(state);
    if (
      !code ||
      !transaction ||
      transaction.expiresAt < Date.now() ||
      transaction.provider !== provider ||
      (provider === "google" && !transaction.nonce) ||
      !this.matchingAuthTransaction(req, state)
    ) {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }
    return { code, nonce: transaction.nonce };
  }

  private completeWebAuth(
    res: ServerResponse,
    userId: string,
    transactionPath: "/auth" | "/oauth" = "/auth",
  ): void {
    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": [
        this.createWebSession(userId),
        this.authTransactionCookie("", 0, transactionPath),
      ],
      "Cache-Control": "no-store",
    });
    res.end();
  }

  private async handleDirectCallbackGitHub(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { code } = this.consumeWebAuthTransaction(req, "github");
    const githubUser = await fetchGitHubUserDirect(this.deps.config, code);
    const user = this.deps.oauth.upsertGitHubUser(githubUser);
    this.completeWebAuth(res, user.id);
  }

  /** A dashboard Google login shares the registered MCP Google callback URL. */
  async handleSharedGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const state = new URL(req.url ?? "", this.deps.config.publicBaseUrl).searchParams.get("state");
    // The other flow issues code_<uuid> transactions; never consume those here.
    if (!state || !/^webauth_[0-9a-f]{32}$/u.test(state)) return false;
    await this.handleDirectCallbackGoogle(req, res);
    return true;
  }

  private async handleDirectCallbackGoogle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { code, nonce } = this.consumeWebAuthTransaction(req, "google");
    // Keep the provider-specific nonce requirement explicit at the exchange boundary.
    if (!nonce) {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }
    const googleUser = await fetchGoogleUserDirect(this.deps.config, code, nonce);
    const user = this.deps.oauth.upsertGoogleUser(googleUser);
    this.completeWebAuth(res, user.id, "/oauth");
  }

  handleApiMe(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 200, { authenticated: false }, addNoStore());
      return;
    }
    const user = this.deps.store.getUserById(principal.userId);
    const userUsage = this.deps.store.getUserUsage(principal.userId);
    jsonResponse(
      res,
      200,
      {
        authenticated: true,
        user: {
          id: principal.userId,
          displayName: user?.displayName ?? principal.displayName ?? principal.githubLogin,
          email: user?.email ?? principal.email,
          provider: user?.provider ?? principal.provider ?? "github",
          scopes: principal.scopes,
          serviceOwner: this.isUsageOwner(principal),
          userUsage,
        },
      },
      addNoStore(),
    );
  }
}
