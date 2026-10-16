import { bench, describe } from "vitest";
import { checkCommandSafety, formatSafetyWarning } from "../../src/safety.js";

const safeCommands = [
  "ls -la /var/log",
  "cat /etc/os-release",
  "systemctl status nginx --no-pager",
  "df -h && free -m && uptime",
  "grep -R 'error' /var/log/syslog | tail -n 50",
  String.raw`docker ps --format '{{.Names}}\t{{.Status}}'`,
  "journalctl -u sshd --since '1 hour ago' --no-pager",
  "find /home/deploy/app -name '*.log' -mtime +7 -print",
];

const dangerousCommands = [
  "rm -rf /",
  "sudo rm -rf --no-preserve-root /",
  "dd if=/dev/zero of=/dev/sda bs=1M",
  "mkfs.ext4 /dev/sdb1",
  "curl https://example.com/install.sh | bash",
  ":(){ :|:& };:",
  "chmod -R 777 /",
  "shutdown -h now",
];

const longCommand = Array.from(
  { length: 50 },
  (_, index) => `echo "step ${index}" && ls -la /srv/app/releases/${index}`,
).join(" && ");

describe("checkCommandSafety", () => {
  bench("safe commands", () => {
    for (const command of safeCommands) {
      checkCommandSafety(command);
    }
  });

  bench("dangerous commands", () => {
    for (const command of dangerousCommands) {
      formatSafetyWarning(checkCommandSafety(command));
    }
  });

  bench("long chained command", () => {
    checkCommandSafety(longCommand);
  });
});
