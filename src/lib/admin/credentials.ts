import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import { atomicWrite, ensureDir } from "./atomic";

const CREDS_PATH = path.join(ADMIN_ROOTS.secure, "passkey-credentials.json");

export interface StoredCredential {
  /** Base64url-encoded credential ID (the WebAuthn `id`). */
  id: string;
  /** Base64url-encoded public key in COSE format. */
  publicKey: string;
  /** WebAuthn signature counter — must monotonically increase per
   *  WebAuthn level 2; we update on each successful login. A non-
   *  monotonic counter is a possible cloned-authenticator signal and
   *  rejected. */
  counter: number;
  /** Optional list of transports advertised at registration —
   *  webauthn-server uses these to optimize the authentication ceremony
   *  hint to the browser. */
  transports?: string[];
  /** Human nickname for the device, e.g. "MacBook Pro TouchID". */
  label: string;
  registeredAt: string;
  lastUsedAt?: string;
}

interface CredentialFile {
  version: 1;
  credentials: StoredCredential[];
}

async function readFile(): Promise<CredentialFile> {
  try {
    const text = await fs.readFile(CREDS_PATH, "utf8");
    const parsed = JSON.parse(text) as CredentialFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.credentials)) {
      throw new Error("invalid credential file shape");
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, credentials: [] };
    }
    throw err;
  }
}

async function writeFile(data: CredentialFile): Promise<void> {
  await ensureDir(path.dirname(CREDS_PATH));
  await atomicWrite(CREDS_PATH, JSON.stringify(data, null, 2) + "\n");
  // 0600 — only the runtime user can read. Belt-and-braces against a
  // misconfigured deploy serving the secure dir somehow.
  await fs.chmod(CREDS_PATH, 0o600);
}

export async function listCredentials(): Promise<StoredCredential[]> {
  const file = await readFile();
  return file.credentials;
}

/** True when no credentials have been registered yet. Used to gate
 *  /admin/setup — once a passkey exists, registration is locked
 *  behind authentication so a stranger can't add a second key. */
export async function hasAnyCredential(): Promise<boolean> {
  const creds = await listCredentials();
  return creds.length > 0;
}

export async function findCredentialById(
  id: string,
): Promise<StoredCredential | undefined> {
  const creds = await listCredentials();
  return creds.find((c) => c.id === id);
}

export async function addCredential(cred: StoredCredential): Promise<void> {
  const file = await readFile();
  if (file.credentials.some((c) => c.id === cred.id)) {
    throw new Error("Credential already registered");
  }
  if (file.credentials.some((c) => c.label === cred.label)) {
    throw new Error("Label already in use — pick a different one");
  }
  file.credentials.push(cred);
  await writeFile(file);
}

export async function updateCredentialUsage(
  id: string,
  newCounter: number,
): Promise<void> {
  const file = await readFile();
  const cred = file.credentials.find((c) => c.id === id);
  if (!cred) return;
  cred.counter = newCounter;
  cred.lastUsedAt = new Date().toISOString();
  await writeFile(file);
}

export async function removeCredential(id: string): Promise<void> {
  const file = await readFile();
  file.credentials = file.credentials.filter((c) => c.id !== id);
  await writeFile(file);
}
