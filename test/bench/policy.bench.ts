import { bench, describe } from "vitest";
import {
  normalizeRemotePosixPath,
  PolicyEngine,
  type PolicyConfig,
  type PolicyContext,
} from "../../src/policy.js";

const config: PolicyConfig = {
  mode: "enforce",
  allowRootLogin: false,
  allowRawSudo: false,
  allowDestructiveCommands: false,
  allowDestructiveFs: false,
  allowedHosts: ["prod-*", "staging-*", "build.example.com", "10.0.0.*"],
  commandAllow: [],
  commandDeny: ["shutdown", "reboot", "iptables -F"],
  pathAllowPrefixes: ["/srv/app", "/var/www", "/opt/releases"],
  pathDenyPrefixes: ["/etc/shadow", "/root", "/boot"],
  localPathAllowPrefixes: ["/home/runner/work"],
  localPathDenyPrefixes: ["/home/runner/.ssh"],
  tunnelAllowBindHosts: ["127.0.0.1", "localhost"],
  tunnelDenyBindHosts: ["0.0.0.0"],
  tunnelAllowRemoteHosts: ["db.internal", "cache.internal"],
  tunnelDenyRemoteHosts: [],
  tunnelAllowPorts: ["5432", "6379", "8000-9000"],
  tunnelDenyPorts: ["22"],
};

const engine = new PolicyEngine(config);

const contexts: PolicyContext[] = [
  { action: "ssh.open", host: "prod-web-01", username: "deploy" },
  { action: "ssh.open", host: "unknown-host", username: "deploy" },
  { action: "proc.exec", host: "staging-api", command: "systemctl status nginx" },
  { action: "proc.exec", host: "prod-web-02", command: "rm -rf /srv/app/cache" },
  { action: "proc.sudo", host: "prod-web-01", command: "apt-get update", rawSudo: true },
  { action: "fs.read", host: "prod-web-01", path: "/var/log/nginx/access.log" },
  { action: "fs.write", host: "prod-web-01", path: "/srv/app/releases/42/config.json" },
  { action: "fs.write", host: "prod-web-01", path: "/etc/shadow" },
  { action: "fs.remove", host: "prod-web-01", path: "/srv/app/../../root/.ssh", destructive: true },
  {
    action: "fs.rename",
    host: "staging-api",
    path: "/var/www/site/index.html",
    secondaryPath: "/var/www/site/index.html.bak",
  },
  { action: "transfer.local.read", path: "/home/runner/work/repo/dist/app.tar.gz" },
  {
    action: "tunnel.local",
    host: "prod-db-01",
    localBindHost: "127.0.0.1",
    localPort: 15432,
    remoteHost: "db.internal",
    remotePort: 5432,
  },
  {
    action: "tunnel.remote",
    host: "prod-db-01",
    localBindHost: "0.0.0.0",
    localPort: 2222,
    remoteHost: "cache.internal",
    remotePort: 22,
  },
];

const rawPaths = [
  "/srv/app/./releases//42/../43/config.json",
  "/var/www/site/assets/../../site/index.html",
  "//root/.ssh/authorized_keys",
  "/home/deploy/app/node_modules/.bin/../package.json",
  "/var/www/../../etc/passwd",
];

describe("PolicyEngine", () => {
  bench("evaluate mixed actions", () => {
    for (const context of contexts) {
      engine.evaluate(context);
    }
  });

  bench("normalizeRemotePosixPath", () => {
    for (const rawPath of rawPaths) {
      normalizeRemotePosixPath(rawPath);
    }
  });
});
