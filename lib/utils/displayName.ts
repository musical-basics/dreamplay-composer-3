/**
 * Deterministic display name generator.
 *
 * Given any user_id string, always produces the same fun readable name
 * like "happy-otter-214" without needing a database lookup.
 * Used as the fallback when a user has not set a custom username.
 */

const ADJECTIVES = [
    'happy', 'gentle', 'bright', 'clever', 'swift', 'calm', 'bold', 'warm',
    'quiet', 'vivid', 'sonic', 'lyric', 'mellow', 'noble', 'azure', 'golden',
    'silver', 'velvet', 'cosmic', 'lunar', 'stellar', 'misty', 'serene', 'wild',
    'crisp', 'dewy', 'frosty', 'sunny', 'breezy', 'stormy', 'radiant', 'nimble',
]

const ANIMALS = [
    'otter', 'fox', 'bear', 'wolf', 'deer', 'hawk', 'owl', 'lynx',
    'robin', 'finch', 'crane', 'heron', 'raven', 'swan', 'lark', 'wren',
    'panda', 'koala', 'lemur', 'bison', 'moose', 'mink', 'vole', 'ibis',
    'gecko', 'newt', 'dove', 'kite', 'swift', 'plover', 'bunting', 'warbler',
]

/**
 * Simple deterministic hash — same string always → same number.
 */
function hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i) | 0
    }
    return Math.abs(hash)
}

/**
 * Returns a fun display name for a given userId.
 * Always the same for the same userId. Never exposes the raw ID.
 * Example: "happy-otter-214"
 */
export function generateDisplayName(userId: string): string {
    const hash = hashString(userId)
    const adj = ADJECTIVES[hash % ADJECTIVES.length]
    const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]
    const num = (hash % 900) + 100 // 100–999
    return `${adj}-${animal}-${num}`
}

/**
 * Format a username for display with @ prefix.
 * Uses custom username if provided, otherwise generates one.
 */
export function formatDisplayName(userId: string, customUsername?: string | null): string {
    return customUsername || generateDisplayName(userId)
}
