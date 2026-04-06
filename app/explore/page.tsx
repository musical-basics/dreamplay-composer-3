import { HomeHeader } from '@/components/home/HomeHeader'
import { ExplorePageClient } from '@/components/explore/ExplorePageClient'
import { fetchPublishedConfigs } from '@/app/actions/config'
import { getAuthorInfoForGalleryAction } from '@/app/actions/profile'

export const metadata = {
    title: 'Explore — DreamPlay Composer',
    description: 'Discover sheet music visualizations from the DreamPlay community — piano, violin, and more.',
}

export const dynamic = 'force-dynamic'

export default async function ExplorePage() {
    const compositions = await fetchPublishedConfigs()
    const userIds = compositions.map((c) => c.user_id).filter(Boolean) as string[]
    const authorInfo = await getAuthorInfoForGalleryAction(userIds)

    return (
        <>
            <HomeHeader />
            <ExplorePageClient compositions={compositions} authorInfo={authorInfo} />
        </>
    )
}
