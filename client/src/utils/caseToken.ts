/**
 * Generates a random 16-digit case token formatted as XXXX-XXXX-XXXX-XXXX
 * Client-side version for display purposes
 */
export function generateCaseToken(): string {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);

    const numericValue = Array.from(array)
        .map(b => b.toString().padStart(3, '0'))
        .join('')
        .slice(0, 16);

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

/**
 * Formats a case token input (adds dashes as user types)
 */
export function formatCaseTokenInput(value: string): string {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '').slice(0, 16);

    // Add dashes at appropriate positions
    const parts: string[] = [];
    for (let i = 0; i < digits.length; i += 4) {
        parts.push(digits.slice(i, i + 4));
    }

    return parts.join('-');
}
