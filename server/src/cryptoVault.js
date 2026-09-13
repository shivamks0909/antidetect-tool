import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

// Derives a strictly 32-byte encryption key from environment secret
function getEncryptionKey() {
  const secret = process.env.PROXY_ENCRYPTION_KEY || process.env.JWT_SECRET || "opinion_insights_vault_key_2026_secure";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a credential using authenticated AES-256-GCM.
 * Stored format: enc:gcm:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 * Never stored in database plaintext.
 */
export function encryptCredential(text) {
  if (!text || typeof text !== "string") return text;
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return `enc:gcm:${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("[CryptoVault] Encryption failed:", err.message);
    throw new Error("Credential encryption failed");
  }
}

/**
 * Decrypts an authenticated AES-256-GCM credential.
 * Validates the authentication tag to ensure zero tampering.
 */
export function decryptCredential(ciphertext) {
  if (!ciphertext || typeof ciphertext !== "string") return ciphertext;
  
  // Check if GCM format
  if (ciphertext.startsWith("enc:gcm:")) {
    const parts = ciphertext.split(":");
    if (parts.length !== 5) {
      throw new Error("Invalid GCM ciphertext structure");
    }
    const iv = Buffer.from(parts[2], "hex");
    const authTag = Buffer.from(parts[3], "hex");
    const encryptedData = parts[4];

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // Legacy CBC backward-compatibility (enc:<iv>:<ciphertext>)
  if (ciphertext.startsWith("enc:")) {
    const parts = ciphertext.split(":");
    if (parts.length === 3) {
      const iv = Buffer.from(parts[1], "hex");
      const encryptedData = parts[2];
      const key = getEncryptionKey();
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    }
  }

  return ciphertext;
}

/**
 * Masks a credential for non-privileged admin presentation.
 */
export function maskCredential(str) {
  if (!str) return "";
  return "••••••••";
}
