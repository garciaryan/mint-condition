import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { LoginPassword } from "./auth.ts";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    if (![n, r, p].every((x) => /^\d{1,8}$/.test(x))) return false;
    if (!B64.test(saltB64) || !B64.test(hashB64)) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const sha256 = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

/** Checks a login attempt against APP_PASSWORD (equal-length digests, so timing says nothing about the guess) or
 * APP_PASSWORD_HASH (scrypt). */
export function checkPassword(input: string, password: LoginPassword): boolean {
  return password.kind === "plain" ? timingSafeEqual(sha256(input), sha256(password.value)) : verifyPassword(input, password.value);
}
