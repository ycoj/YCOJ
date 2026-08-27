export function isDuplicateKeyError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000;
}
