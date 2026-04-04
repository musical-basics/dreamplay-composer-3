import { createClient } from '@supabase/supabase-js'
import type { VideoExportListRow, VideoExportRow } from '@/lib/types/renderJob'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY || ''
  return createClient(url, key, { db: { schema: 'composer' } })
}

type ConfigTitleRow = {
  id: string
  title: string
}

export async function getExportsForUser(userId: string): Promise<VideoExportListRow[]> {
  const sb = getSupabase()

  const { data: rows, error } = await sb
    .from('video_exports')
    .select('id, config_id, user_id, status, progress, mp4_url, error_message, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error
  const exportsRows = (rows || []) as VideoExportRow[]
  const configIds = Array.from(new Set(exportsRows.map((row) => row.config_id).filter(Boolean)))

  let titleMap = new Map<string, string>()
  if (configIds.length > 0) {
    const { data: configs, error: configError } = await sb
      .from('configurations')
      .select('id, title')
      .in('id', configIds)

    if (configError) throw configError
    titleMap = new Map((configs || []).map((cfg: ConfigTitleRow) => [cfg.id, cfg.title]))
  }

  return exportsRows.map((row) => ({
    ...row,
    config_title: titleMap.get(row.config_id) || null,
  }))
}
