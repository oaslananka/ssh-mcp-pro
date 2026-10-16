import { bench, describe } from "vitest";
import { SSHConfigParser } from "../../src/ssh-config.js";

interface ParserInternals {
  parseContent(content: string): void;
}

const hostBlock = (index: number) => `
# Host number ${index}
Host app-${index} app-${index}.example.com
  HostName 10.0.${Math.floor(index / 250)}.${index % 250}
  User deploy
  Port ${2200 + (index % 50)}
  IdentityFile ~/.ssh/id_ed25519_${index}
  ProxyJump bastion.example.com
  ServerAliveInterval 30
  StrictHostKeyChecking yes
`;

const smallConfig = Array.from({ length: 10 }, (_, index) => hostBlock(index)).join("\n");
const largeConfig = Array.from({ length: 500 }, (_, index) => hostBlock(index)).join("\n");

function parse(content: string): SSHConfigParser {
  const parser = new SSHConfigParser("/nonexistent/ssh_config");
  (parser as unknown as ParserInternals).parseContent(content);
  return parser;
}

describe("SSHConfigParser", () => {
  bench("parse 10 hosts", () => {
    parse(smallConfig);
  });

  bench("parse 500 hosts", () => {
    parse(largeConfig);
  });
});
