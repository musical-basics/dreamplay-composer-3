import { notFound } from 'next/navigation'
import { ViewerPage } from '@/components/viewer/ViewerPage'
import { fetchConfigById } from '@/app/actions/config'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const config = await fetchConfigById(id)

    if (!config) {
        return { title: 'Not Found — DreamPlay Composer' }
    }

    return {
        title: `${config.title || 'Untitled'} — DreamPlay Composer`,
        description: `Watch "${config.title || 'Untitled'}" come alive with DreamPlay Composer's auto-mapping visualizer.`,
    }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const config = await fetchConfigById(id)

    if (!config) {
        notFound()
    }

    return <ViewerPage config={config} />
}
