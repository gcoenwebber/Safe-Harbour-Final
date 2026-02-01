import crypto from 'crypto';

// Skip32 is a CommonJS module that exports { Skip32: class }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Skip32 } = require('skip32');

// 10-byte key for Skip32 (must be exactly 10 bytes)
// This should ideally come from environment variables for production
const SKIP32_KEY = Buffer.from(process.env.BLIND_INDEX_SECRET?.slice(0, 20) || '01234567890123456789', 'hex');

/**
 * Converts a sequential database integer ID into a non-enumerable 10-digit UIN.
 * Uses Skip32 block cipher to create a reversible but non-sequential mapping.
 * 
 * @param sequentialId - The sequential database ID (must be a 32-bit integer)
 * @returns A 10-digit UIN string
 */
export function generateUIN(sequentialId: number): string {
    if (sequentialId < 0 || sequentialId > 0xFFFFFFFF) {
        throw new Error('Sequential ID must be a 32-bit unsigned integer');
    }

    // Create Skip32 cipher instance
    const cipher = new Skip32(SKIP32_KEY);

    // Encrypt the sequential ID to get a scrambled 32-bit integer
    const encrypted = cipher.encrypt(sequentialId);

    // Convert to 10-digit string (pad with leading zeros if needed)
    // Max 32-bit value is 4294967295 (10 digits), so this always fits
    const uin = encrypted.toString().padStart(10, '0');

    return uin;
}

/**
 * Decodes a UIN back to the original sequential ID.
 * Useful for debugging or internal operations.
 * 
 * @param uin - The 10-digit UIN string
 * @returns The original sequential database ID
 */
export function decodeUIN(uin: string): number {
    if (!/^\d{10}$/.test(uin)) {
        throw new Error('UIN must be exactly 10 digits');
    }

    const cipher = new Skip32(SKIP32_KEY);
    const encrypted = parseInt(uin, 10);
    const decrypted = cipher.decrypt(encrypted);

    return decrypted;
}

/**
 * Creates a blind index hash of an email address using HMAC-SHA256.
 * This allows lookups without storing the actual email in the database.
 * 
 * @param email - The user's email address
 * @returns A hex-encoded hash of the email
 */
export function hashEmail(email: string): string {
    const secret = process.env.BLIND_INDEX_SECRET;

    if (!secret) {
        throw new Error('BLIND_INDEX_SECRET environment variable is not set');
    }

    // Normalize email to lowercase before hashing
    const normalizedEmail = email.toLowerCase().trim();

    // Create HMAC-SHA256 hash
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(normalizedEmail);

    return hmac.digest('hex');
}

/**
 * Validates that an email has the correct format.
 * 
 * @param email - The email to validate
 * @returns True if email is valid
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
