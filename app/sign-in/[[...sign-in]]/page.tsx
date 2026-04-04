'use client'

import { useRouter } from 'next/navigation'
import { SignIn } from '@clerk/nextjs'
import { dark } from '@clerk/themes'

export default function Page() {
    const router = useRouter()

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-black">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold text-white mb-1">DreamPlay Composer</h1>
                <p className="text-zinc-500 text-sm">Sign in to your account</p>
            </div>

            <SignIn 
                appearance={{ baseTheme: dark }}
                routing="path" 
                path="/sign-in" 
                signUpUrl="/sign-up"
                forceRedirectUrl="/studio"
            />

            <p className="mt-6 text-zinc-500 text-sm">
                Don&apos;t have an account?{' '}
                <button onClick={() => router.push('/sign-up')} className="text-purple-400 hover:text-purple-300 font-medium">
                    Sign up
                </button>
            </p>
        </div>
    )
}
