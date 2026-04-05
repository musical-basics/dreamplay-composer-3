import { NextRequest, NextResponse } from 'next/server'

function parseHostFromDomain(domain: string | undefined): string | null {
    if (!domain) return null
    const normalized = domain.includes('://') ? domain : `https://${domain}`
    try {
        return new URL(normalized).hostname
    } catch {
        return null
    }
}

function inferContentType(url: URL, upstreamContentType: string | null): string {
    if (upstreamContentType && upstreamContentType !== 'application/octet-stream') {
        return upstreamContentType
    }

    const pathname = url.pathname.toLowerCase()
    if (pathname.endsWith('.wav')) return 'audio/wav'
    if (pathname.endsWith('.mp3')) return 'audio/mpeg'
    if (pathname.endsWith('.m4a')) return 'audio/mp4'
    if (pathname.endsWith('.aac')) return 'audio/aac'
    if (pathname.endsWith('.ogg')) return 'audio/ogg'
    if (pathname.endsWith('.mid') || pathname.endsWith('.midi')) return 'audio/midi'
    if (pathname.endsWith('.xml') || pathname.endsWith('.musicxml')) return 'application/xml; charset=utf-8'
    if (pathname.endsWith('.mxl')) return 'application/vnd.recordare.musicxml'
    return 'application/octet-stream'
}

export async function GET(request: NextRequest) {
    const target = request.nextUrl.searchParams.get('url')
    if (!target) {
        return NextResponse.json({ error: 'Missing url query parameter' }, { status: 400 })
    }

    let parsedUrl: URL
    try {
        parsedUrl = new URL(target)
    } catch {
        return NextResponse.json({ error: 'Invalid url query parameter' }, { status: 400 })
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return NextResponse.json({ error: 'Only http and https URLs are allowed' }, { status: 400 })
    }

    const allowedHosts = new Set<string>([request.nextUrl.hostname])
    const r2Host = parseHostFromDomain(process.env.R2_PUBLIC_DOMAIN || process.env.VITE_R2_PUBLIC_DOMAIN)
    if (r2Host) allowedHosts.add(r2Host)

    if (!allowedHosts.has(parsedUrl.hostname)) {
        return NextResponse.json({ error: `Host is not allowed: ${parsedUrl.hostname}` }, { status: 403 })
    }

    try {
        const upstreamResponse = await fetch(parsedUrl.toString(), { cache: 'no-store' })
        if (!upstreamResponse.ok) {
            return NextResponse.json(
                { error: `Upstream fetch failed: ${upstreamResponse.status} ${upstreamResponse.statusText}` },
                { status: upstreamResponse.status },
            )
        }

        const buffer = await upstreamResponse.arrayBuffer()
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': inferContentType(parsedUrl, upstreamResponse.headers.get('content-type')),
                'Content-Length': String(buffer.byteLength),
                'Accept-Ranges': 'none',
                'Cache-Control': 'no-store',
            },
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return NextResponse.json({ error: `Proxy fetch failed: ${message}` }, { status: 502 })
    }
}