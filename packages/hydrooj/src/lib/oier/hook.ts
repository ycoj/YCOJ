import type { CcfHookTier } from './types';

export function ccfHookTier(level: number): CcfHookTier | null {
    if (!Number.isFinite(level) || level < 3) return null;
    if (level >= 9) return 'gold';
    if (level >= 6) return 'blue';
    return 'green';
}

export function ccfHookSrc(tier: CcfHookTier): string {
    switch (tier) {
        case 'green': return 'img/ccf-hook-green.png';
        case 'blue': return 'img/ccf-hook-blue.png';
        case 'gold': return 'img/ccf-hook-gold.png';
        default: {
            const exhaustive: never = tier;
            return exhaustive;
        }
    }
}
