const crypto = require('node:crypto');

function key() {
  const value = process.env.UNMEET_ENCRYPTION_KEY;
  if (!value) {
    if (process.env.NODE_ENV === 'production') throw new Error('UNMEET_ENCRYPTION_KEY is required in production.');
    return crypto.createHash('sha256').update('unmeet-development-only-key').digest();
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error('UNMEET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return decoded;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(value) {
  const [version, iv, tag, ciphertext] = String(value).split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

module.exports = { encrypt, decrypt };
