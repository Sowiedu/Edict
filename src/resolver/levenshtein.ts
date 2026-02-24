// =============================================================================
// Levenshtein Distance — "Did you mean?" suggestions
// =============================================================================

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses the classic dynamic-programming O(m*n) algorithm.
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Optimisations for trivial cases
    if (m === 0) return n;
    if (n === 0) return m;
    if (a === b) return 0;

    // Use two rows instead of full matrix to save memory
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j]! + 1,       // deletion
                curr[j - 1]! + 1,   // insertion
                prev[j - 1]! + cost, // substitution
            );
        }
        [prev, curr] = [curr, prev];
    }

    return prev[n]!;
}

/**
 * Find candidate names that are close to the given name.
 * Returns names within maxDistance (default 2), sorted ascending by distance.
 * At most 5 results.
 */
export function findCandidates(
    name: string,
    known: string[],
    maxDistance = 2,
): string[] {
    const scored: Array<{ name: string; dist: number }> = [];

    for (const k of known) {
        // Quick length-based pre-filter: if length difference > maxDistance, skip
        if (Math.abs(k.length - name.length) > maxDistance) continue;

        const dist = levenshteinDistance(name, k);
        if (dist <= maxDistance && dist > 0) {
            scored.push({ name: k, dist });
        }
    }

    scored.sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name));
    return scored.slice(0, 5).map((s) => s.name);
}
