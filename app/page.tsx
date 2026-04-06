import { Homepage } from '@/components/home/Homepage'
import { fetchPublishedConfigs } from '@/app/actions/config'

export const metadata = {
    title: 'DreamPlay Composer — See Music Come Alive',
    description:
        'The world\'s first auto-mapping visualizer for live performances. Watch notes light up, fall, and dance in real time.',
}

export default async function Page() {
    const compositions = await fetchPublishedConfigs()

    return <Homepage compositions={compositions} />
}
