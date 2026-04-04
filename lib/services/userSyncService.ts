import { createClient } from '@supabase/supabase-js'

type SyncedUser = {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  username: string | null
  imageUrl: string | null
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY || ''
  return createClient(url, key, { db: { schema: 'composer' } })
}

export async function upsertComposerUser(user: SyncedUser) {
  const sb = getSupabase()
  const { error } = await sb
    .from('users')
    .upsert(
      {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        username: user.username,
        image_url: user.imageUrl,
      },
      { onConflict: 'id' }
    )

  if (error) throw error
}

export async function deleteComposerUser(userId: string) {
  const sb = getSupabase()
  const { error } = await sb.from('users').delete().eq('id', userId)
  if (error) throw error
}
