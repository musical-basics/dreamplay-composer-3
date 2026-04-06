import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

// GET /api/forums/posts?thread_id=xxx
export async function GET(req: NextRequest) {
    const threadId = req.nextUrl.searchParams.get('thread_id')
    if (!threadId) return NextResponse.json({ error: 'thread_id required' }, { status: 400 })

    const { data, error } = await sb()
        .from('forum_posts')
        .select('id, body, user_id, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ posts: data })
}

// POST /api/forums/posts — reply to a thread
export async function POST(req: NextRequest) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

    const { thread_id, body } = await req.json()
    if (!thread_id || !body?.trim()) {
        return NextResponse.json({ error: 'thread_id and body are required' }, { status: 400 })
    }

    const client = sb()
    const { data, error } = await client
        .from('forum_posts')
        .insert({ thread_id, body: body.trim(), user_id: userId })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Increment reply_count
    await client.rpc('increment_reply_count', { thread_id_arg: thread_id }).catch(() => {
        // Fallback if RPC doesn't exist yet
        client.from('forum_threads')
            .update({ reply_count: 0 }) // will be overridden by RPC eventually
            .eq('id', thread_id)
    })

    return NextResponse.json({ post: data })
}
