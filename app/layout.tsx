import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import './globals.css'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: 'DreamPlay Composer 3 — Live Audio Transcription',
  description: 'Live audio transcription and music visualization by DreamPlay.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }} afterSignOutUrl="/login">
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-black text-white`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
