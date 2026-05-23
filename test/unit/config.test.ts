import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { ConfigManager } from "../../src/config.js";

describe("ConfigManager", () => {
  afterEach(() => {
    delete process.env.SSH_MCP_MAX_SESSIONS;
    delete process.env.SSH_MCP_SESSION_TTL;
    delete process.env.SSH_MCP_COMMAND_TIMEOUT;
    delete process.env.SSH_MCP_MAX_COMMAND_OUTPUT_BYTES;
    delete process.env.SSH_MCP_MAX_STREAM_CHUNKS;
    delete process.env.SSH_MCP_DEBUG;
    delete process.env.SSH_MCP_RATE_LIMIT;
    delete process.env.SSH_MCP_RATE_LIMIT_MAX;
    delete process.env.SSH_MCP_RATE_LIMIT_WINDOW_MS;
    delete process.env.SSH_MCP_STRICT_HOST_KEY;
    delete process.env.STRICT_HOST_KEY_CHECKING;
    delete process.env.SSH_MCP_HOST_KEY_POLICY;
    delete process.env.KNOWN_HOSTS_PATH;
    delete process.env.SSH_MCP_KNOWN_HOSTS_PATH;
    delete process.env.SSH_MCP_ALLOWED_CIPHERS;
    delete process.env.SSH_MCP_MAX_FILE_SIZE;
    delete process.env.SSH_MCP_MAX_FILE_WRITE_BYTES;
    delete process.env.SSH_MCP_MAX_TRANSFER_BYTES;
    delete process.env.SSH_MCP_POLICY_FILE;
    delete process.env.SSH_MCP_POLICY_MODE;
    delete process.env.SSH_MCP_ALLOW_ROOT_LOGIN;
    delete process.env.SSH_MCP_ALLOW_RAW_SUDO;
    delete process.env.SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS;
    delete process.env.SSH_MCP_ALLOW_DESTRUCTIVE_FS;
    delete process.env.SSH_MCP_ALLOWED_HOSTS;
    delete process.env.SSH_MCP_COMMAND_ALLOW;
    delete process.env.SSH_MCP_COMMAND_DENY;
    delete process.env.SSH_MCP_PATH_ALLOW_PREFIXES;
    delete process.env.SSH_MCP_PATH_DENY_PREFIXES;
    delete process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES;
    delete process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES;
    delete process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS;
    delete process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS;
    delete process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS;
    delete process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS;
    delete process.env.SSH_MCP_TUNNEL_ALLOW_PORTS;
    delete process.env.SSH_MCP_TUNNEL_DENY_PORTS;
    delete process.env.SSH_MCP_HTTP_HOST;
    delete process.env.PORT;
    delete process.env.SSH_MCP_HTTP_PORT;
    delete process.env.SSH_MCP_HTTP_ALLOWED_ORIGINS;
    delete process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE;
    delete process.env.SSH_MCP_ENABLE_LEGACY_SSE;
    delete process.env.SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES;
    delete process.env.SSH_MCP_TOOL_PROFILE;
    delete process.env.SSH_MCP_CONNECTOR_PROFILE;
    delete process.env.SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER;
    delete process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND;
    delete process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS;
    delete process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_TIMEOUT_MS;
    delete process.env.SSH_MCP_CONNECTOR_DEFAULT_USERNAME;
    delete process.env.SSH_MCP_HTTP_AUTH_MODE;
    delete process.env.SSH_MCP_HTTP_PUBLIC_URL;
    delete process.env.SSH_MCP_HTTP_TRUST_PROXY;
    delete process.env.SSH_MCP_HTTP_MAX_SESSIONS;
    delete process.env.SSH_MCP_HTTP_SESSION_IDLE_TTL_MS;
    delete process.env.SSH_MCP_OAUTH_ISSUER;
    delete process.env.SSH_MCP_OAUTH_AUDIENCE;
    delete process.env.SSH_MCP_OAUTH_JWKS_URL;
    delete process.env.SSH_MCP_OAUTH_RESOURCE;
    delete process.env.SSH_MCP_OAUTH_REQUIRED_SCOPES;
  });

  test("uses default values", () => {
    const config = new ConfigManager();

    expect(config.get("maxSessions")).toBe(20);
    expect(config.get("debug")).toBe(false);
    expect(config.get("rateLimit").enabled).toBe(true);
    expect(config.get("security").hostKeyPolicy).toBe("strict");
    expect(config.get("security").allowRootLogin).toBe(false);
    expect(config.get("policy").allowRawSudo).toBe(false);
    expect(config.get("policy").localPathAllowPrefixes?.length).toBeGreaterThan(0);
    expect(config.get("policy").tunnelAllowBindHosts).toEqual(["127.0.0.1", "localhost", "::1"]);
    expect(config.get("policy").tunnelDenyBindHosts).toEqual(["0.0.0.0", "::"]);
    expect(config.get("http").host).toBe("127.0.0.1");
    expect(config.get("http").trustProxy).toBe(false);
    expect(config.get("http").maxSessions).toBe(20);
    expect(config.get("http").sessionIdleTtlMs).toBe(900000);
    expect(config.get("connector").toolProfile).toBe("full");
    expect(config.get("connector").credentialProvider).toBe("none");
    expect(config.get("auth").mode).toBe("bearer");
    expect(config.get("auth").oauthRequiredScopes).toEqual(["ssh-mcp-pro.read"]);
  });

  test("reads environment overrides", () => {
    process.env.SSH_MCP_MAX_SESSIONS = "42";
    process.env.SSH_MCP_SESSION_TTL = "5000";
    process.env.SSH_MCP_COMMAND_TIMEOUT = "7000";
    process.env.SSH_MCP_MAX_COMMAND_OUTPUT_BYTES = "2048";
    process.env.SSH_MCP_MAX_STREAM_CHUNKS = "12";
    process.env.SSH_MCP_DEBUG = "true";
    process.env.SSH_MCP_RATE_LIMIT = "false";
    process.env.SSH_MCP_STRICT_HOST_KEY = "true";
    process.env.SSH_MCP_MAX_FILE_SIZE = "1024";
    process.env.SSH_MCP_MAX_FILE_WRITE_BYTES = "2048";
    process.env.SSH_MCP_MAX_TRANSFER_BYTES = "4096";
    process.env.SSH_MCP_ALLOW_RAW_SUDO = "true";
    process.env.SSH_MCP_COMMAND_DENY = "rm -rf,shutdown";
    process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES = "/tmp/local,/var/tmp/local";
    process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES = "/tmp/local/secret";
    process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS = "127.0.0.1,localhost";
    process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS = "0.0.0.0";
    process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS = "db.internal,^cache-[0-9]+\\.internal$";
    process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS = "metadata.internal";
    process.env.SSH_MCP_TUNNEL_ALLOW_PORTS = "1024-65535";
    process.env.SSH_MCP_TUNNEL_DENY_PORTS = "2375,2376";
    process.env.SSH_MCP_HTTP_HOST = "localhost";
    process.env.SSH_MCP_HTTP_PORT = "4444";
    process.env.SSH_MCP_TOOL_PROFILE = "remote-readonly";
    process.env.SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER = "agent";
    process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS = "resolver.mjs,--json";
    process.env.SSH_MCP_CONNECTOR_DEFAULT_USERNAME = "deploy";
    process.env.SSH_MCP_HTTP_AUTH_MODE = "oauth";
    process.env.SSH_MCP_HTTP_PUBLIC_URL = "https://mcp.example/mcp";
    process.env.SSH_MCP_HTTP_TRUST_PROXY = "true";
    process.env.SSH_MCP_HTTP_MAX_SESSIONS = "13";
    process.env.SSH_MCP_HTTP_SESSION_IDLE_TTL_MS = "60000";
    process.env.SSH_MCP_OAUTH_ISSUER = "https://auth.example";
    process.env.SSH_MCP_OAUTH_AUDIENCE = "https://mcp.example/mcp";
    process.env.SSH_MCP_OAUTH_JWKS_URL = "https://auth.example/.well-known/jwks.json";
    process.env.SSH_MCP_OAUTH_REQUIRED_SCOPES = "ssh-mcp-pro.read,ssh-mcp-pro.plan";

    const config = new ConfigManager();

    expect(config.get("maxSessions")).toBe(42);
    expect(config.get("sessionTtlMs")).toBe(5000);
    expect(config.get("commandTimeoutMs")).toBe(7000);
    expect(config.get("maxCommandOutputBytes")).toBe(2048);
    expect(config.get("maxStreamChunks")).toBe(12);
    expect(config.get("maxFileSize")).toBe(1024);
    expect(config.get("maxFileWriteBytes")).toBe(2048);
    expect(config.get("maxTransferBytes")).toBe(4096);
    expect(config.get("debug")).toBe(true);
    expect(config.get("rateLimit").enabled).toBe(false);
    expect(config.get("security").hostKeyPolicy).toBe("strict");
    expect(config.get("policy").allowRawSudo).toBe(true);
    expect(config.get("policy").commandDeny).toEqual(["rm -rf", "shutdown"]);
    expect(config.get("policy").localPathAllowPrefixes).toEqual(["/tmp/local", "/var/tmp/local"]);
    expect(config.get("policy").localPathDenyPrefixes).toEqual(["/tmp/local/secret"]);
    expect(config.get("policy").tunnelAllowBindHosts).toEqual(["127.0.0.1", "localhost"]);
    expect(config.get("policy").tunnelDenyBindHosts).toEqual(["0.0.0.0"]);
    expect(config.get("policy").tunnelAllowRemoteHosts).toEqual([
      "db.internal",
      "^cache-[0-9]+\\.internal$",
    ]);
    expect(config.get("policy").tunnelDenyRemoteHosts).toEqual(["metadata.internal"]);
    expect(config.get("policy").tunnelAllowPorts).toEqual(["1024-65535"]);
    expect(config.get("policy").tunnelDenyPorts).toEqual(["2375", "2376"]);
    expect(config.get("http").host).toBe("localhost");
    expect(config.get("http").port).toBe(4444);
    expect(config.get("http").publicUrl).toBe("https://mcp.example/mcp");
    expect(config.get("http").trustProxy).toBe(true);
    expect(config.get("http").maxSessions).toBe(13);
    expect(config.get("http").sessionIdleTtlMs).toBe(60000);
    expect(config.get("connector").toolProfile).toBe("remote-readonly");
    expect(config.get("connector").credentialProvider).toBe("agent");
    expect(config.get("connector").credentialCommandArgs).toEqual(["resolver.mjs", "--json"]);
    expect(config.get("connector").defaultUsername).toBe("deploy");
    expect(config.get("auth")).toEqual(
      expect.objectContaining({
        mode: "oauth",
        oauthIssuer: "https://auth.example",
        oauthAudience: "https://mcp.example/mcp",
        oauthJwksUrl: "https://auth.example/.well-known/jwks.json",
        oauthRequiredScopes: ["ssh-mcp-pro.read", "ssh-mcp-pro.plan"],
      }),
    );
  });

  test("reads full production env surface and policy file overrides", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-config-"));
    const knownHosts = path.join(tempDir, "known_hosts");
    const tokenFile = path.join(tempDir, "bearer.token");
    const policyFile = path.join(tempDir, "policy.json");
    fs.writeFileSync(
      policyFile,
      JSON.stringify({
        mode: "explain",
        allowedHosts: ["from-file.example"],
        commandAllow: ["^systemctl status"],
        pathAllowPrefixes: ["/srv"],
        pathDenyPrefixes: ["/srv/private"],
        tunnelAllowPorts: ["8443"],
      }),
      "utf8",
    );

    process.env.SSH_MCP_RATE_LIMIT_MAX = "250";
    process.env.SSH_MCP_RATE_LIMIT_WINDOW_MS = "30000";
    process.env.KNOWN_HOSTS_PATH = knownHosts;
    process.env.SSH_MCP_ALLOWED_CIPHERS = "aes256-gcm@openssh.com\nchacha20-poly1305@openssh.com";
    process.env.SSH_MCP_POLICY_FILE = policyFile;
    process.env.SSH_MCP_POLICY_MODE = "explain";
    process.env.SSH_MCP_ALLOW_ROOT_LOGIN = "yes";
    process.env.SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS = "on";
    process.env.SSH_MCP_ALLOW_DESTRUCTIVE_FS = "1";
    process.env.SSH_MCP_ALLOWED_HOSTS = "env.example,prod.example";
    process.env.SSH_MCP_COMMAND_ALLOW = "uptime,whoami";
    process.env.SSH_MCP_PATH_ALLOW_PREFIXES = "/data,/srv/app";
    process.env.SSH_MCP_PATH_DENY_PREFIXES = "/data/secret";
    process.env.PORT = "8080";
    process.env.SSH_MCP_HTTP_ALLOWED_ORIGINS = "https://chatgpt.com,https://sshautomator.example";
    process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE = tokenFile;
    process.env.SSH_MCP_ENABLE_LEGACY_SSE = "true";
    process.env.SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES = "65536";
    process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND = "resolve-ssh-credential";
    process.env.SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_TIMEOUT_MS = "9000";
    process.env.SSH_MCP_OAUTH_RESOURCE = "https://sshautomator.example/mcp";

    try {
      const config = new ConfigManager();

      expect(config.get("rateLimit")).toEqual({
        enabled: true,
        maxRequests: 250,
        windowMs: 30000,
      });
      expect(config.get("security")).toEqual(
        expect.objectContaining({
          allowRootLogin: true,
          knownHostsPath: knownHosts,
          allowedCiphers: ["aes256-gcm@openssh.com", "chacha20-poly1305@openssh.com"],
        }),
      );
      expect(config.get("policy")).toEqual(
        expect.objectContaining({
          mode: "explain",
          allowRootLogin: true,
          allowDestructiveCommands: true,
          allowDestructiveFs: true,
          allowedHosts: ["env.example", "prod.example"],
          commandAllow: ["uptime", "whoami"],
          pathAllowPrefixes: ["/data", "/srv/app"],
          pathDenyPrefixes: ["/data/secret"],
          tunnelAllowPorts: ["8443"],
        }),
      );
      expect(config.get("http")).toEqual(
        expect.objectContaining({
          port: 8080,
          allowedOrigins: ["https://chatgpt.com", "https://sshautomator.example"],
          bearerTokenFile: tokenFile,
          enableLegacySse: true,
          maxRequestBodyBytes: 65536,
        }),
      );
      expect(config.get("connector")).toEqual(
        expect.objectContaining({
          credentialCommand: "resolve-ssh-credential",
          credentialCommandTimeoutMs: 9000,
        }),
      );
      expect(config.get("auth").oauthResource).toBe("https://sshautomator.example/mcp");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back safely for invalid scalar env values", () => {
    process.env.SSH_MCP_MAX_SESSIONS = "not-a-number";
    process.env.SSH_MCP_HOST_KEY_POLICY = "loose";
    process.env.SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER = "vault";
    process.env.SSH_MCP_HTTP_AUTH_MODE = "none";
    process.env.SSH_MCP_HTTP_PORT = "NaN";

    const config = new ConfigManager();

    expect(config.get("maxSessions")).toBe(20);
    expect(config.get("security").hostKeyPolicy).toBe("strict");
    expect(config.get("connector").credentialProvider).toBe("none");
    expect(config.get("auth").mode).toBe("bearer");
    expect(config.get("http").port).toBe(3000);
  });

  test("reads STRICT_HOST_KEY_CHECKING as the preferred host verification flag", () => {
    process.env.STRICT_HOST_KEY_CHECKING = "false";

    const config = new ConfigManager();

    expect(config.get("security").hostKeyPolicy).toBe("insecure");
  });

  test("hostKeyPolicy overrides deprecated strict host key aliases", () => {
    process.env.STRICT_HOST_KEY_CHECKING = "false";
    process.env.SSH_MCP_HOST_KEY_POLICY = "accept-new";

    const config = new ConfigManager();

    expect(config.get("security").hostKeyPolicy).toBe("accept-new");
  });

  test("programmatic overrides take precedence and merge nested values", () => {
    process.env.SSH_MCP_MAX_SESSIONS = "5";

    const config = new ConfigManager({
      maxSessions: 99,
      rateLimit: { enabled: true, maxRequests: 5, windowMs: 1000 },
      security: {
        allowedCiphers: ["aes256-gcm"],
        allowRootLogin: false,
        hostKeyPolicy: "strict",
        knownHostsPath: "/tmp/known_hosts",
      },
    });

    expect(config.get("maxSessions")).toBe(99);
    expect(config.get("rateLimit")).toEqual({
      enabled: true,
      maxRequests: 5,
      windowMs: 1000,
    });
    expect(config.get("security")).toEqual({
      allowRootLogin: false,
      hostKeyPolicy: "strict",
      knownHostsPath: "/tmp/known_hosts",
      allowedCiphers: ["aes256-gcm"],
    });
  });

  test("programmatic root-login security setting propagates to policy by default", () => {
    const config = new ConfigManager({
      security: {
        allowedCiphers: [],
        allowRootLogin: true,
        hostKeyPolicy: "strict",
        knownHostsPath: "/tmp/known_hosts",
      },
    });

    expect(config.get("security").allowRootLogin).toBe(true);
    expect(config.get("policy").allowRootLogin).toBe(true);
  });

  test("fails closed when an explicitly configured policy file is invalid", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
    const policyFile = path.join(tempDir, "policy.json");
    fs.writeFileSync(policyFile, "{", "utf8");
    process.env.SSH_MCP_POLICY_FILE = policyFile;

    try {
      expect(() => new ConfigManager()).toThrow("Invalid SSH_MCP_POLICY_FILE");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("getAll returns frozen copies", () => {
    const config = new ConfigManager();
    const all = config.getAll();

    expect(Object.isFrozen(all)).toBe(true);
    expect(Object.isFrozen(all.rateLimit)).toBe(true);
    expect(Object.isFrozen(all.security)).toBe(true);
    expect(all).not.toBe(config.getAll());
  });

  test("update changes runtime values", () => {
    const config = new ConfigManager();
    config.update({
      debug: true,
      rateLimit: { enabled: false, maxRequests: 25, windowMs: 5000 },
    });

    expect(config.get("debug")).toBe(true);
    expect(config.get("rateLimit")).toEqual({
      enabled: false,
      maxRequests: 25,
      windowMs: 5000,
    });
  });
});
