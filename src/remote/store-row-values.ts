export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

// SQLite returns own data properties, not inherited values or accessors.
function ownColumnValue(row: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

export function rowString(row: Record<string, unknown>, key: string): string {
  const value = ownColumnValue(row, key);
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  throw new TypeError("Unexpected database column type");
}

export function optionalRowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = ownColumnValue(row, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function tokenUseConflict(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code: "INVALID_TOKEN", status: 400 });
}
