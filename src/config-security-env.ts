import type { ServerConfig } from "./config.js";
import { loadPolicyFile, parseBoolean, parseHostKeyPolicy, parseList } from "./config-parsers.js";

/** Apply security and policy environment values before programmatic overrides. */
export function applySecurityPolicyEnvironment(config: ServerConfig): void {
  const strictHostKeyChecking =
    process.env.STRICT_HOST_KEY_CHECKING ?? process.env.SSH_MCP_STRICT_HOST_KEY;
  if (strictHostKeyChecking !== undefined) {
    config.security.hostKeyPolicy = parseBoolean(strictHostKeyChecking, true)
      ? "strict"
      : "insecure";
  }
  config.security.hostKeyPolicy = parseHostKeyPolicy(
    process.env.SSH_MCP_HOST_KEY_POLICY,
    config.security.hostKeyPolicy,
  );
  config.security.knownHostsPath =
    process.env.KNOWN_HOSTS_PATH ??
    process.env.SSH_MCP_KNOWN_HOSTS_PATH ??
    config.security.knownHostsPath;
  config.security.allowRootLogin = parseBoolean(
    process.env.SSH_MCP_ALLOW_ROOT_LOGIN,
    config.security.allowRootLogin,
  );
  config.security.allowedCiphers = parseList(process.env.SSH_MCP_ALLOWED_CIPHERS);

  const filePolicy = loadPolicyFile(process.env.SSH_MCP_POLICY_FILE);
  config.policy = {
    ...config.policy,
    ...filePolicy,
    mode:
      process.env.SSH_MCP_POLICY_MODE === "explain"
        ? "explain"
        : (filePolicy.mode ?? config.policy.mode),
    allowRootLogin: config.security.allowRootLogin,
    allowRawSudo: parseBoolean(
      process.env.SSH_MCP_ALLOW_RAW_SUDO,
      filePolicy.allowRawSudo ?? config.policy.allowRawSudo,
    ),
    allowDestructiveCommands: parseBoolean(
      process.env.SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS,
      filePolicy.allowDestructiveCommands ?? config.policy.allowDestructiveCommands,
    ),
    allowDestructiveFs: parseBoolean(
      process.env.SSH_MCP_ALLOW_DESTRUCTIVE_FS,
      filePolicy.allowDestructiveFs ?? config.policy.allowDestructiveFs,
    ),
    allowedHosts: parseList(process.env.SSH_MCP_ALLOWED_HOSTS).length
      ? parseList(process.env.SSH_MCP_ALLOWED_HOSTS)
      : (filePolicy.allowedHosts ?? config.policy.allowedHosts),
    commandAllow: parseList(process.env.SSH_MCP_COMMAND_ALLOW).length
      ? parseList(process.env.SSH_MCP_COMMAND_ALLOW)
      : (filePolicy.commandAllow ?? config.policy.commandAllow),
    commandDeny: parseList(process.env.SSH_MCP_COMMAND_DENY).length
      ? parseList(process.env.SSH_MCP_COMMAND_DENY)
      : (filePolicy.commandDeny ?? config.policy.commandDeny),
    pathAllowPrefixes: parseList(process.env.SSH_MCP_PATH_ALLOW_PREFIXES).length
      ? parseList(process.env.SSH_MCP_PATH_ALLOW_PREFIXES)
      : (filePolicy.pathAllowPrefixes ?? config.policy.pathAllowPrefixes),
    pathDenyPrefixes: parseList(process.env.SSH_MCP_PATH_DENY_PREFIXES).length
      ? parseList(process.env.SSH_MCP_PATH_DENY_PREFIXES)
      : (filePolicy.pathDenyPrefixes ?? config.policy.pathDenyPrefixes),
    localPathAllowPrefixes: parseList(process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES).length
      ? parseList(process.env.SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES)
      : (filePolicy.localPathAllowPrefixes ?? config.policy.localPathAllowPrefixes),
    localPathDenyPrefixes: parseList(process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES).length
      ? parseList(process.env.SSH_MCP_LOCAL_PATH_DENY_PREFIXES)
      : (filePolicy.localPathDenyPrefixes ?? config.policy.localPathDenyPrefixes),
    tunnelAllowBindHosts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS)
      : (filePolicy.tunnelAllowBindHosts ?? config.policy.tunnelAllowBindHosts),
    tunnelDenyBindHosts: parseList(process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_DENY_BIND_HOSTS)
      : (filePolicy.tunnelDenyBindHosts ?? config.policy.tunnelDenyBindHosts),
    tunnelAllowRemoteHosts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS)
      : (filePolicy.tunnelAllowRemoteHosts ?? config.policy.tunnelAllowRemoteHosts),
    tunnelDenyRemoteHosts: parseList(process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS)
      : (filePolicy.tunnelDenyRemoteHosts ?? config.policy.tunnelDenyRemoteHosts),
    tunnelAllowPorts: parseList(process.env.SSH_MCP_TUNNEL_ALLOW_PORTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_ALLOW_PORTS)
      : (filePolicy.tunnelAllowPorts ?? config.policy.tunnelAllowPorts),
    tunnelDenyPorts: parseList(process.env.SSH_MCP_TUNNEL_DENY_PORTS).length
      ? parseList(process.env.SSH_MCP_TUNNEL_DENY_PORTS)
      : (filePolicy.tunnelDenyPorts ?? config.policy.tunnelDenyPorts),
  };
  config.policy.allowRootLogin = config.security.allowRootLogin;
}
