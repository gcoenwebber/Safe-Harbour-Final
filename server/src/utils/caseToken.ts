import crypto from 'crypto';

/**
 * Generates a random 16-digit case token formatted as XXXX-XXXX-XXXX-XXXX
 * Uses cryptographically secure random bytes
 */
export function generateCaseToken(): string {
    // Generate 8 random bytes (64 bits of entropy)
    const randomBytes = crypto.randomBytes(8);

    // Convert to a numeric string and pad to ensure 16 digits
    const numericValue = BigInt('0x' + randomBytes.toString('hex')).toString().padStart(16, '0').slice(0, 16);

    // Format as XXXX-XXXX-XXXX-XXXX
    return `${numericValue.slice(0, 4)}-${numericValue.slice(4, 8)}-${numericValue.slice(8, 12)}-${numericValue.slice(12, 16)}`;
}

/**
 * Validates the format of a case token
 * @param token - The token to validate
 * @returns True if the token matches XXXX-XXXX-XXXX-XXXX format
 */
export function isValidCaseToken(token: string): boolean {
    return /^\d{4}-\d{4}-\d{4}-\d{4}$/.test(token);
}
