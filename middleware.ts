import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Routes that are always accessible without authentication
const isPublicRoute = createRouteMatcher([
    '/',                    // homepage (community creations)
    '/view/(.*)',           // public viewer pages
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/login(.*)',
    '/api/view(.*)',        // view count API
    '/api/xml(.*)',         // XML proxy (needed by viewer)
    '/api/asset(.*)',       // asset proxy (needed by viewer)
])

export default clerkMiddleware(async (auth, request) => {
    // If not a public route, require authentication
    if (!isPublicRoute(request)) {
        await auth.protect()
    }
})

export const config = {
    matcher: [
        // Skip Next.js internals and static files
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
}
