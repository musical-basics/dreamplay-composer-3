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

// GET /api/forums/threads — list threads
export async function GET(req: NextRequest) {
    const category = req.nextUrl.searchParams.get('category') || null
    let query = sb()
        .from('forum_threads')
        .select('id, title, body, user_id, category, pinned, reply_count, created_at')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)

    if (category) query = query.eq('category', category)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ threads: data })
}

// POST /api/forums/threads — create a new thread
export async function POST(req: NextRequest) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

    const { title, body, category } = await req.json()
    if (!title?.trim() || !body?.trim()) {
        return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
    }

    const { data, error } = await sb()
        .from('forum_threads')
        .insert({ title: title.trim(), body: body.trim(), user_id: userId, category: category || 'general' })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ thread: data })
}
