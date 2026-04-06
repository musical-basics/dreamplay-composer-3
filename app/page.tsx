import { Homepage } from '@/components/home/Homepage'
import { fetchPublishedConfigs } from '@/app/actions/config'
import { getAuthorInfoForGalleryAction } from '@/app/actions/profile'
import { fetchPollResults } from '@/app/actions/poll'

export const metadata = {
    title: 'DreamPlay Composer — See Music Come Alive',
    description:
        'The world\'s first auto-mapping visualizer for live performances. Watch notes light up, fall, and dance in real time.',
}

// Always server-render so newly published compositions appear immediately
export const dynamic = 'force-dynamic'

export default async function Page() {
    const [compositions, pollResults] = await Promise.all([
        fetchPublishedConfigs(),
        fetchPollResults(),
    ])

    // Batch-fetch author profiles for all compositions in one query
    const userIds = compositions.map((c) => c.user_id).filter(Boolean) as string[]
    const authorInfo = await getAuthorInfoForGalleryAction(userIds)

    return <Homepage compositions={compositions} pollResults={pollResults} authorInfo={authorInfo} />
}
