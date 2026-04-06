import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { EditProfilePage } from '@/components/profile/EditProfilePage'

export const metadata = {
    title: 'My Profile — DreamPlay Composer',
    description: 'Edit your creator profile, username, bio, and social links.',
}

export default async function ProfilePage() {
    const { userId } = await auth()
    if (!userId) redirect('/login')

    return <EditProfilePage />
}
