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
