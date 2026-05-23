export function parsePnpmPackOutput(output) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed.slice(index));
      const pack = Array.isArray(parsed) ? parsed[0] : parsed;
      if (pack && typeof pack === "object" && Array.isArray(pack.files)) {
        return pack;
      }
    } catch {
      // Lifecycle logs can contain arbitrary text before the JSON payload.
    }
  }

  throw new Error("pnpm pack output did not contain a JSON package payload.");
}
