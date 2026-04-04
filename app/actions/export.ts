'use server'

import { getExportsForUser } from '@/lib/services/exportService'
import type { VideoExportListRow } from '@/lib/types/renderJob'

const TEST_USER_ID = 'test-user-composer-3'

export async function fetchMyExports(): Promise<VideoExportListRow[]> {
  return getExportsForUser(TEST_USER_ID)
}
