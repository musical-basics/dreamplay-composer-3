/**
 * Debug logger — only outputs to console when ?admin=true is in the URL.
 * Server-side code (workers, API routes) always logs.
 */
const isServer = typeof window === 'undefined'

function isAdminMode(): boolean {
    if (isServer) return true
    try {
        return new URLSearchParams(window.location.search).get('admin') === 'true'
    } catch {
        return false
    }
}

export const debug = {
    log: (...args: unknown[]) => {
        if (isAdminMode()) console.log(...args)
    },
    warn: (...args: unknown[]) => {
        if (isAdminMode()) console.warn(...args)
    },
    error: (...args: unknown[]) => {
        // Errors always log
        console.error(...args)
    },
}
