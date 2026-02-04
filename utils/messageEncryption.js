const crypto = require('crypto');

function decryptMessageContent(cipherText, encryption, base64Key) {
  if (!cipherText || !encryption?.iv || !base64Key) {
    return null;
  }

  try {
    const key = Buffer.from(base64Key, 'base64');
    const iv = Buffer.from(encryption.iv, 'base64');
    if (key.length !== 32 || iv.length !== 16) {
      return null;
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(cipherText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted || null;
  } catch (error) {
    console.warn('Failed to decrypt message content');
    return null;
  }
}

module.exports = {
  decryptMessageContent,
};
