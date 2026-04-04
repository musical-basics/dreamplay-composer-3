'use client'

import { useEffect } from 'react'

const DEBUG_LOGS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === 'true'

export function ConsoleGate() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (DEBUG_LOGS_ENABLED) return

    // Keep warnings/errors visible in production while muting noisy debug logs.
    console.log = () => {}
    console.info = () => {}
    console.debug = () => {}
  }, [])

  return null
}

export default ConsoleGate
