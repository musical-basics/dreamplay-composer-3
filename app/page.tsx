import { Homepage } from '@/components/home/Homepage'
import { fetchPublishedConfigs } from '@/app/actions/config'
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

    return <Homepage compositions={compositions} pollResults={pollResults} />
}

