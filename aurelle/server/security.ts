import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
function key() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('A strong SESSION_SECRET is required for encrypted workforce factors.');
  return createHash('sha256').update(process.env.SESSION_SECRET).digest();
}
export function encryptFactor(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}
export function decryptFactor(value: string) {
  const [version, iv, tag, data] = value.split(':');
  if (version !== 'v1') throw new Error('Invalid encrypted MFA factor.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
