'use server'

import { auth } from '@clerk/nextjs/server'
import { getExportsForUser } from '@/lib/services/exportService'
import type { VideoExportListRow } from '@/lib/types/renderJob'

export async function fetchMyExports(): Promise<VideoExportListRow[]> {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return getExportsForUser(userId)
}
