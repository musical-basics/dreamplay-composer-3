import { notFound } from 'next/navigation'
import { CreatorProfilePage } from '@/components/profile/CreatorProfilePage'
import { getCreatorProfileAction } from '@/app/actions/profile'

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params
    const data = await getCreatorProfileAction(username)

    if (!data) {
        return { title: 'Creator Not Found — DreamPlay Composer' }
    }

    return {
        title: `${data.displayName} — DreamPlay Composer`,
        description: data.profile?.bio
            ? `${data.profile.bio} · ${data.compositions.length} published composition${data.compositions.length !== 1 ? 's' : ''} on DreamPlay Composer.`
            : `View ${data.displayName}'s compositions on DreamPlay Composer.`,
    }
}

export default async function CreatorPage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params
    const data = await getCreatorProfileAction(username)

    if (!data || !data.profile) {
        notFound()
    }

    return (
        <CreatorProfilePage
            profile={data.profile}
            displayName={data.displayName}
            compositions={data.compositions}
        />
    )
}
