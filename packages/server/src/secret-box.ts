import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const keyLength = 32;
const ivLength = 12;
const tagLength = 16;
const version = 'v1';

// The STOCKUP_ENCRYPTION_KEY format: 32 random bytes in standard base64, as `openssl rand -base64 32` prints them.
export function parseEncryptionKey(value: string): Buffer | undefined {
  const key = Buffer.from(value, 'base64');
  return key.length === keyLength && key.toString('base64') === value ? key : undefined;
}

// Seals secrets with AES-256-GCM. `context` names what the secret belongs to and is authenticated with it, so a
// sealed value copied onto another row fails to open rather than opening there.
export function secretBox(key: Uint8Array) {
  return {
    seal(plaintext: string, context: string) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: tagLength });
      cipher.setAAD(Buffer.from(context));
      const sealed = Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return `${version}.${sealed.toString('base64')}`;
    },

    // Null when the value was sealed with another key or for another context, or has been tampered with.
    open(sealed: string, context: string): string | null {
      const [prefix, body] = sealed.split('.');
      if (prefix !== version || !body) return null;
      const bytes = Buffer.from(body, 'base64');
      if (bytes.length < ivLength + tagLength) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, ivLength), {
          authTagLength: tagLength,
        });
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(bytes.subarray(bytes.length - tagLength));
        return Buffer.concat([
          decipher.update(bytes.subarray(ivLength, bytes.length - tagLength)),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

export type SecretBox = ReturnType<typeof secretBox>;
