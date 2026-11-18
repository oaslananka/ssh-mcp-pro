import { scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;
const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_HASH_LENGTH = 512;

interface ParsedPasswordHash {
  salt: Buffer;
  derivedKey: Buffer;
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

function parseReviewerPasswordHash(
  encodedHash: string | undefined,
): ParsedPasswordHash | undefined {
  if (!encodedHash || encodedHash.length > MAX_HASH_LENGTH) return undefined;
  const [algorithm, n, r, p, saltValue, keyValue, ...extra] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    !saltValue ||
    !keyValue ||
    extra.length > 0
  ) {
    return undefined;
  }
  const salt = decodeBase64Url(saltValue);
  const derivedKey = decodeBase64Url(keyValue);
  if (
    !salt ||
    salt.length < MIN_SALT_BYTES ||
    salt.length > MAX_SALT_BYTES ||
    derivedKey?.length !== SCRYPT_KEY_BYTES
  ) {
    return undefined;
  }
  return { salt, derivedKey };
}

export function isValidReviewerPasswordHash(encodedHash: string | undefined): boolean {
  return parseReviewerPasswordHash(encodedHash) !== undefined;
}

export async function verifyReviewerPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsed = parseReviewerPasswordHash(encodedHash);
  if (!parsed?.salt || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;
  try {
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        parsed.salt,
        SCRYPT_KEY_BYTES,
        { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
    return timingSafeEqual(derivedKey, parsed.derivedKey);
  } catch {
    return false;
  }
}
