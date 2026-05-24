import { describe, expect, test } from "vitest";
import {
  corsHeaders,
  isLoopbackHost,
  isOriginAllowed,
  oauthProtectedResourceMetadataUrl,
  oauthWwwAuthenticateHeader,
  validateHttpStartupConfig,
} from "../../src/http-security.js";

describe("HTTP transport security guards", () => {
  test("accepts loopback startup without bearer token", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "127.0.0.1",
          allowedOrigins: ["http://127.0.0.1", "http://localhost"],
        },
        undefined,
      ),
    ).not.toThrow();
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("api.localhost")).toBe(true);
    expect(isLoopbackHost("127.12.0.9")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0:0:0:0:0:0:0:1")).toBe(true);
  });

  test("rejects non-loopback startup without bearer token and origins", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: [],
        },
        undefined,
      ),
    ).toThrow("Refusing non-loopback HTTP MCP binding");
  });

  test("rejects empty bearer token files", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://mcp.example/mcp",
        },
        "",
      ),
    ).toThrow("empty bearer token file");
  });

  test("rejects non-loopback startup without a configured public URL", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
        },
        "secret",
        {
          toolProfile: "remote-readonly",
          allowedHosts: ["prod"],
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).toThrow("SSH_MCP_HTTP_PUBLIC_URL");
  });

  test("allows non-loopback startup only with bearer token, origins, and public URL", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://mcp.example/mcp",
        },
        "secret",
        {
          toolProfile: "remote-readonly",
          allowedHosts: ["prod"],
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).not.toThrow();
  });

  test("rejects loopback public URLs for non-loopback startup", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://localhost/mcp",
        },
        "secret",
        {
          toolProfile: "remote-readonly",
          allowedHosts: ["prod"],
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).toThrow("loopback host");
  });

  test("rejects non-loopback startup with full tool profile", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://mcp.example/mcp",
        },
        "secret",
        {
          toolProfile: "full",
          allowedHosts: ["prod"],
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).toThrow("full tool profile");
  });

  test("rejects non-loopback startup without host allowlist", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://mcp.example/mcp",
        },
        "secret",
        {
          toolProfile: "remote-readonly",
          allowedHosts: [],
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).toThrow("SSH_MCP_ALLOWED_HOSTS");
  });

  test("allows non-loopback startup with OAuth config and safe profile", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          publicUrl: "https://mcp.example/mcp",
        },
        undefined,
        {
          toolProfile: "remote-broker",
          allowedHosts: ["prod"],
          authMode: "oauth",
          oauthConfigured: true,
        },
      ),
    ).not.toThrow();
  });

  test("rejects non-loopback startup without strict host-key verification", () => {
    expect(() =>
      validateHttpStartupConfig(
        {
          host: "0.0.0.0",
          allowedOrigins: ["https://chatgpt.com"],
          bearerTokenFile: "/tmp/token",
          publicUrl: "https://mcp.example/mcp",
        },
        "secret",
        {
          toolProfile: "chatgpt",
          allowedHosts: ["prod"],
          hostKeyPolicy: "accept-new",
          authMode: "bearer",
          oauthConfigured: false,
        },
      ),
    ).toThrow("strict SSH host-key");
  });

  test("applies origin allowlist and CORS headers", () => {
    const origins = ["https://chatgpt.com"];

    expect(isOriginAllowed("https://chatgpt.com", origins)).toBe(true);
    expect(isOriginAllowed("https://evil.example", origins)).toBe(false);
    expect(corsHeaders("https://chatgpt.com", origins)).toEqual(
      expect.objectContaining({
        "Access-Control-Allow-Origin": "https://chatgpt.com",
        "Access-Control-Expose-Headers": "mcp-session-id, WWW-Authenticate",
        Vary: "Origin",
      }),
    );
    expect(corsHeaders("https://evil.example", origins)).toEqual({});
  });

  test("builds OAuth discovery challenge headers for ChatGPT clients", () => {
    const metadataUrl = oauthProtectedResourceMetadataUrl(
      "https://sshautomator.oaslananka.dev/mcp",
    );
    expect(metadataUrl).toBe(
      "https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource",
    );

    expect(oauthWwwAuthenticateHeader(metadataUrl, ["ssh-mcp-pro.read"])).toBe(
      'Bearer resource_metadata="https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource", scope="ssh-mcp-pro.read"',
    );

    expect(oauthWwwAuthenticateHeader(metadataUrl, ["ssh-mcp-pro.read"], true)).toBe(
      'Bearer resource_metadata="https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource", scope="ssh-mcp-pro.read", error="invalid_token", error_description="A valid OAuth access token is required"',
    );

    expect(
      oauthProtectedResourceMetadataUrl(
        "https://user:pass@sshautomator.oaslananka.dev/mcp?debug=true#token",
      ),
    ).toBe("https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource");

    expect(oauthWwwAuthenticateHeader(metadataUrl, [])).toBe(
      'Bearer resource_metadata="https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource"',
    );

    expect(oauthWwwAuthenticateHeader(metadataUrl, [], true)).toBe(
      'Bearer resource_metadata="https://sshautomator.oaslananka.dev/.well-known/oauth-protected-resource", error="invalid_token", error_description="A valid OAuth access token is required"',
    );
  });
});
