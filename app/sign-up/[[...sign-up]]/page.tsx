'use client'

import { useRouter } from 'next/navigation'
import { SignUp } from '@clerk/nextjs'
import { dark } from '@clerk/themes'

export default function Page() {
    const router = useRouter()

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-black">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold text-white mb-1">DreamPlay Composer</h1>
                <p className="text-zinc-500 text-sm">Create your account</p>
            </div>

            <SignUp 
                appearance={{ baseTheme: dark }}
                routing="path" 
                path="/sign-up" 
                signInUrl="/login"
                forceRedirectUrl="/studio"
            />

            <p className="mt-6 text-zinc-500 text-sm">
                Already have an account?{' '}
                <button onClick={() => router.push('/login')} className="text-purple-400 hover:text-purple-300 font-medium">
                    Sign in
                </button>
            </p>
        </div>
    )
}
