'use client'

import Link from 'next/link'
import { Music } from 'lucide-react'
import { useUser, UserButton } from '@clerk/nextjs'
import { dark } from '@clerk/themes'

export const HomeHeader: React.FC = () => {
    const { isSignedIn } = useUser()

    return (
        <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                {/* Logo + Brand */}
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-shadow duration-300">
                        <Music className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-base font-bold text-white tracking-tight leading-none">
                            DreamPlay Composer
                        </span>
                        <span className="text-[10px] text-zinc-500 tracking-widest uppercase leading-none mt-0.5">
                            Auto-Mapping Visualizer
                        </span>
                    </div>
                </Link>

                {/* Nav Links */}
                <nav className="flex items-center gap-2">
                    <Link
                        href="/"
                        className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors duration-200 rounded-lg hover:bg-zinc-800/50"
                    >
                        Explore
                    </Link>

                    {isSignedIn ? (
                        <>
                            <Link
                                href="/studio"
                                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors duration-200 rounded-lg hover:bg-zinc-800/50"
                            >
                                Studio
                            </Link>
                            <Link
                                href="/studio2/profile"
                                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors duration-200 rounded-lg hover:bg-zinc-800/50"
                            >
                                Profile
                            </Link>
                            <div className="ml-2">
                                <UserButton appearance={{ baseTheme: dark }} />
                            </div>
                        </>
                    ) : (
                        <Link
                            href="/login"
                            className="ml-2 px-4 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors duration-200 shadow-lg shadow-purple-500/20"
                        >
                            Sign In
                        </Link>
                    )}
                </nav>
            </div>
        </header>
    )
}
