/** Validate maintenance-tool arguments before invoking external CLIs. */
function validNamePart(part) {
  if (part.length === 0) return false;
  for (let index = 0; index < part.length; index += 1) {
    const point = part.codePointAt(index);
    const letter = point >= 97 && point <= 122;
    const digit = point >= 48 && point <= 57;
    const punctuation = point === 45 || point === 46 || point === 95 || point === 126;
    if (!letter && !digit && !(index > 0 && punctuation)) return false;
  }
  return true;
}

export function isValidPackageName(name) {
  if (typeof name !== "string" || name.length > 214) return false;
  if (name.startsWith("@")) {
    const parts = name.slice(1).split("/");
    return parts.length === 2 && parts.every(validNamePart);
  }
  return validNamePart(name);
}

/** Git revision expressions are data, never Git options. */
export function isValidCommitRange(range) {
  return (
    typeof range === "string" &&
    range.length > 0 &&
    !range.startsWith("-") &&
    /^[a-zA-Z0-9_./~^@{}:+-]+$/u.test(range)
  );
}

/** Preserve the pinned manager version prefix without scanning competing regex branches. */
export function parsePinnedPackageManager(value) {
  const text = String(value ?? "");
  const separator = text.indexOf("@");
  if (separator < 1) return undefined;
  const versionStart = separator + 1;
  let position = versionStart;
  for (let group = 0; group < 3; group++) {
    const groupStart = position;
    while (position < text.length) {
      const digit = text.codePointAt(position) ?? -1;
      if (digit < 48 || digit > 57) break;
      position++;
    }
    if (groupStart === position) return undefined;
    if (group < 2) {
      if (text[position] !== ".") return undefined;
      position++;
    }
  }
  return { name: text.slice(0, separator), version: text.slice(versionStart, position) };
}

/** Only strip a peer suffix when an opening parenthesis has content after it. */
export function stripLockPeerSuffix(version) {
  let unquoted = version.trim();
  if (unquoted.startsWith('"')) unquoted = unquoted.slice(1);
  if (unquoted.endsWith('"')) unquoted = unquoted.slice(0, -1);
  const opening = unquoted.indexOf("(");
  return opening >= 0 && opening < unquoted.length - 1 ? unquoted.slice(0, opening) : unquoted;
}

function isWhitespace(char) {
  return char !== undefined && char.trim().length === 0;
}

function skipWhitespace(value, offset) {
  while (offset < value.length && isWhitespace(value[offset])) offset++;
  return offset;
}

function licenseOperatorLength(value, offset) {
  if (value.startsWith("OR", offset)) return 2;
  if (value.startsWith("AND", offset)) return 3;
  return 0;
}

/** Split SPDX license expression operators without overlapping whitespace patterns. */
export function splitLicenseExpression(license) {
  const parts = [];
  let start = 0;
  let position = 0;
  const whitespace = isWhitespace;
  while (position < license.length) {
    if (license[position] === "/") {
      parts.push(license.slice(start, position));
      start = ++position;
      continue;
    }
    if (!whitespace(license[position])) {
      position++;
      continue;
    }
    const before = position;
    position = skipWhitespace(license, position);
    const operatorLength = licenseOperatorLength(license, position);
    if (operatorLength && whitespace(license[position + operatorLength])) {
      parts.push(license.slice(start, before));
      position += operatorLength;
      position = skipWhitespace(license, position);
      start = position;
    }
  }
  parts.push(license.slice(start));
  return parts;
}

/** Parse a single .env assignment while preserving whitespace within the value. */
export function parseEnvAssignment(rawLine) {
  let text = rawLine.trimStart();
  const isLetter = (char) => (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
  if (text.startsWith("export") && isWhitespace(text[6])) {
    const candidate = text.slice(6).trimStart();
    if (isLetter(candidate[0]) || candidate[0] === "_") text = candidate;
  }
  if (!text || (!isLetter(text[0]) && text[0] !== "_")) return undefined;
  let end = 1;
  while (end < text.length) {
    const char = text[end];
    const isDigit = char >= "0" && char <= "9";
    if (!isLetter(char) && !isDigit && char !== "_") break;
    end++;
  }
  const key = text.slice(0, end);
  const remainder = text.slice(end).trimStart();
  if (!remainder.startsWith("=")) return undefined;
  return { key, value: remainder.slice(1).trimStart() };
}

/** Keep the public endpoint restricted to /mcp with optional trailing slashes. */
export function hasMcpEndpointPath(pathname) {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end--;
  return pathname.slice(0, end) === "/mcp";
}

/** Scan Node engine version triples without restarting regex searches in long digit runs. */
export function findNodeEngineFloorVersions(range) {
  const versions = [];
  let index = 0;
  while (index < range.length) {
    let position = range[index] === "^" ? index + 1 : index;
    const start = position;
    let valid = true;
    for (let group = 0; group < 3; group++) {
      const digitStart = position;
      while (position < range.length) {
        const point = range.codePointAt(position) ?? -1;
        if (point < 48 || point > 57) break;
        position++;
      }
      if (position === digitStart) {
        valid = false;
        break;
      }
      if (group < 2) {
        if (range[position] !== ".") {
          valid = false;
          break;
        }
        position++;
      }
    }
    if (valid) versions.push(range.slice(start, position));
    index = Math.max(index + 1, position);
  }
  return versions;
}
