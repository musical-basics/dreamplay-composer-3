'use client';

import { useEffect } from 'react';

export function DevToolsBlocker() {
  useEffect(() => {
    // Block right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    // Block DevTools keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        return false;
      }

      // Ctrl+Shift+I / Cmd+Shift+I (DevTools)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return false;
      }

      // Ctrl+Shift+C / Cmd+Shift+C (Inspect element)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        return false;
      }

      // Ctrl+Shift+J / Cmd+Shift+J (Console)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        return false;
      }

      // Ctrl+Shift+K / Cmd+Shift+K (Sources)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        return false;
      }
    };

    // Detect if DevTools is open by checking window height/width
    const detectDevTools = () => {
      const threshold = 160;
      if (
        window.outerHeight - window.innerHeight > threshold ||
        window.outerWidth - window.innerWidth > threshold
      ) {
        // DevTools likely open, warn user
        console.warn(
          'DevTools access is restricted. This application protects proprietary algorithms.'
        );
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, false);
    document.addEventListener('keydown', handleKeyDown, false);

    // Check for DevTools every 500ms
    const interval = setInterval(detectDevTools, 500);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, false);
      document.removeEventListener('keydown', handleKeyDown, false);
      clearInterval(interval);
    };
  }, []);

  return null;
}
