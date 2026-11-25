import { readFileSync } from "node:fs";

// Resolve exact, contiguous source anchors rather than stale absolute line numbers.
// Formatting indentation and CRLF differences do not affect the selected range.
export function resolveMutationRange(file, source, anchor) {
  const needle = anchor
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim());
  if (needle.length > 20 || !needle.some(Boolean)) {
    throw new Error("Mutation anchor must be nonempty and bounded: " + file);
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const matches = [];
  for (let index = 0; index <= lines.length - needle.length; index++) {
    if (needle.every((line, offset) => lines[index + offset] === line)) {
      matches.push(index + 1);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      "Mutation anchor must match exactly one location: " +
        file +
        " (" +
        needle[0] +
        "), found " +
        matches.length,
    );
  }
  return file + ":" + matches[0] + "-" + (matches[0] + needle.length - 1);
}

function target(file, anchor) {
  return resolveMutationRange(file, readFileSync(new URL(file, import.meta.url), "utf8"), anchor);
}

const config = {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  mutate: [
    target(
      "src/auth.ts",
      [
        "if (providedToken === undefined) {",
        "return false;",
        "}",
        "",
        "return constantTimeTokenEquals(providedToken, expectedToken);",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "if (",
        "bindHost &&",
        "(this.config.tunnelDenyBindHosts ?? []).length > 0 &&",
        "matchesPolicyValue(bindHost, this.config.tunnelDenyBindHosts)",
        ") {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "if (",
        "bindHost &&",
        "(this.config.tunnelAllowBindHosts ?? []).length > 0 &&",
        "!matchesPolicyValue(bindHost, this.config.tunnelAllowBindHosts)",
        ") {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        'if (context.username === "root" && !this.config.allowRootLogin) {',
        "return denied({",
        "mode,",
        "action: context.action,",
        'reason: "Root SSH login is disabled by policy",',
        'hint: "Connect as an unprivileged user and use approved ensure tools where possible.",',
        "});",
        "}",
        "",
        "if (context.rawSudo && !this.config.allowRawSudo) {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "const safety = checkCommandSafety(context.command);",
        "if (!safety.safe && !this.config.allowDestructiveCommands) {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "if (",
        "this.localPathDenyPrefixes.some((prefix) => isPathUnder(normalizedPath, prefix, path.sep))",
        ") {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "const underAllowedPrefix = this.localPathAllowPrefixes.some((prefix) =>",
        "isPathUnder(normalizedPath, prefix, path.sep),",
        ");",
        "if (!underAllowedPrefix) {",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        'if (this.pathDenyPrefixes.some((prefix) => isPathUnder(normalizedPath, prefix, "/"))) {',
        "return denied({",
      ].join("\n"),
    ),
    target(
      "src/policy.ts",
      [
        "if (isDestructiveFs && !this.config.allowDestructiveFs) {",
        "const underAllowedPrefix = allowPrefixes.some((prefix) =>",
        'isPathUnder(normalizedPath, prefix, "/"),',
        ");",
        "if (!underAllowedPrefix) {",
      ].join("\n"),
    ),
    target(
      "src/safety.ts",
      [
        "for (const { pattern, riskLevel, warning, suggestion } of DANGEROUS_PATTERNS) {",
        "if (",
        'typeof pattern === "function" ? pattern(normalizedCommand) : pattern.test(normalizedCommand)',
        ") {",
      ].join("\n"),
    ),
    target(
      "src/config.ts",
      [
        "allowRootLogin: overrides.policy?.allowRootLogin ?? security.allowRootLogin,",
        "allowedHosts: overrides.policy?.allowedHosts ?? [...config.policy.allowedHosts],",
      ].join("\n"),
    ),
    target(
      "src/session.ts",
      [
        "if (rootDenied) {",
        "throw createPolicyError(",
        '"Root SSH login is disabled by policy",',
        '"Connect as an unprivileged user and use approved privilege escalation workflows.",',
        ");",
        "}",
      ].join("\n"),
    ),
    target(
      "src/session-connection-config.ts",
      [
        "if (params.expectedHostKeySha256) {",
        'connectConfig.hostHash = "sha256";',
        "connectConfig.hostVerifier = (hashedKey: string) =>",
        "normalizeSha256Fingerprint(hashedKey) ===",
        'normalizeSha256Fingerprint(params.expectedHostKeySha256 ?? "");',
        '} else if (hostKeyPolicy === "insecure") {',
        "connectConfig.hostVerifier = () => true;",
        '} else if (hostKeyPolicy === "accept-new") {',
        'connectConfig.hostHash = "sha256";',
        "connectConfig.hostVerifier = (hashedKey: string) =>",
        "this.verifyAcceptNewHostKey(params.host, params.port ?? 22, hashedKey);",
        "} else {",
        'connectConfig.hostHash = "sha256";',
        "connectConfig.hostVerifier = (hashedKey: string) =>",
        "this.verifyKnownHostKey(params.host, params.port ?? 22, knownHostsPath, hashedKey);",
        "}",
      ].join("\n"),
    ),
    target(
      "src/http-security.ts",
      [
        'if ((context.hostKeyPolicy ?? "strict") !== "strict") {',
        "throw new Error(",
        '"Refusing non-loopback HTTP MCP binding without strict SSH host-key verification",',
        ");",
        "}",
      ].join("\n"),
    ),
    target(
      "src/oauth.ts",
      ["if (!token) {", 'throw new Error("Missing bearer token");'].join("\n"),
    ),
    target(
      "src/oauth.ts",
      [
        "if (!protectedHeader.kid) {",
        'throw new Error("JWT kid is required");',
        "}",
        "if (!protectedHeader.alg || !algorithms.includes(protectedHeader.alg)) {",
        'throw new Error("Unsupported JWT algorithm");',
      ].join("\n"),
    ),
    target(
      "src/remote/control-plane-agent-operations.ts",
      [
        "revokeAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): RemoteAgentRecord {",
        'if (!hasCapability(principal.capabilities, "agents.admin")) {',
        'throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);',
        "}",
        'const updated = { ...agent, status: "revoked" as const, updatedAt: nowIso() };',
      ].join("\n"),
    ),
    target(
      "src/remote/control-plane-agent-operations.ts",
      [
        "const agent = this.requireAgent(principal, args);",
        "if (Object.getOwnPropertyDescriptor(agent.policy.capabilities, capability)?.value !== true) {",
      ].join("\n"),
    ),
    target(
      "src/remote/control-plane-agent-operations.ts",
      [
        "if (",
        'tool === "file_manage" &&',
        'args.operation === "copy" &&',
        '!hasCapability(principal.capabilities, "files.read")',
        ") {",
        'throw safeError("INVALID_SCOPE", "Copy requires files.read and files.write", 403);',
        "}",
      ].join("\n"),
    ),
    target(
      "src/remote/crypto.ts",
      [
        "const token = extractBearerToken(authorization);",
        "if (!token) {",
        'throw new Error("Missing bearer token");',
        "}",
        "const { payload } = await jwtVerify(token, keyPair.publicKey, {",
        "issuer: config.publicBaseUrl,",
        "audience: config.mcpResourceUrl,",
        'algorithms: ["EdDSA"],',
        'requiredClaims: ["iss", "aud", "exp", "iat", "sub", "jti"],',
      ].join("\n"),
    ),
    target(
      "src/remote/policy.ts",
      [
        "const denied = policy.denyPaths.some((rawPrefix) => {",
        "const prefix = normalizePolicyPath(rawPrefix);",
        'if (prefix === "/") {',
        'return normalized === "/";',
        "}",
        "return normalized === prefix || normalized.startsWith(`${prefix}/`);",
        "});",
        "if (denied) {",
        "return false;",
      ].join("\n"),
    ),
    target(
      "src/remote/policy.ts",
      [
        "return policy.allowPaths.some((rawPrefix) => {",
        'if (rawPrefix === "*")',
        "return path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath);",
        "const prefix = normalizePolicyPath(rawPrefix);",
        'return prefix === "/"',
        '? normalized === "/"',
        ": normalized === prefix || normalized.startsWith(`${prefix}/`);",
        "});",
      ].join("\n"),
    ),
    target(
      "src/remote/scopes.ts",
      [
        "export function parseScopes(scope: string | undefined): RemoteScope[] {",
        "if (!scope) {",
        "return [];",
        "}",
        "const requested = scope.split(/\\s+/u).filter(Boolean);",
        "return requested.filter((item): item is RemoteScope =>",
        "REMOTE_SCOPES.includes(item as RemoteScope),",
        ");",
      ].join("\n"),
    ),
    target(
      "src/remote/scopes.ts",
      ["): boolean {", "return capabilities.includes(capability);", "}"].join("\n"),
    ),
  ],
  reporters: ["clear-text", "html", "json"],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  coverageAnalysis: "perTest",
  ignoreStatic: true,
  concurrency: 2,
  timeoutMS: 60000,
  tempDirName: ".stryker-tmp",
};

export default config;
