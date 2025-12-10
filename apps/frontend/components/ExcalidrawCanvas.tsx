'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'

interface Props {
  roomId: string
}

export default function ExcalidrawCanvas({ roomId }: Props) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null)
  const [showCopied, setShowCopied] = useState(false)
  const yDocRef = useRef<Y.Doc | null>(null)
  const yElementsRef = useRef<Y.Map<any> | null>(null)
  const isLocalChange = useRef(false)

  // Initialize Yjs - runs ONCE per room
  useEffect(() => {
    const yDoc = new Y.Doc()
    const yElements = yDoc.getMap('elements')
    yDocRef.current = yDoc
    yElementsRef.current = yElements

    // WebSocket Provider
    const provider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234',
      roomId,
      yDoc
    )

    // IndexedDB for offline - MUST store reference for cleanup
    const indexeddbProvider = new IndexeddbPersistence(roomId, yDoc)

    return () => {
      // Cleanup order matters! Destroy providers before Y.Doc
      indexeddbProvider.destroy()
      provider.destroy()
      yDoc.destroy()
      yDocRef.current = null
      yElementsRef.current = null
    }
  }, [roomId])

  // Separate effect for observing remote changes (depends on excalidrawAPI)
  useEffect(() => {
    const yElements = yElementsRef.current
    if (!yElements || !excalidrawAPI) return

    // Listen for remote changes only
    const observer = (event: Y.YMapEvent<any>, transaction: Y.Transaction) => {
      if (transaction.local) return

      const elements = Array.from(yElements.values())
      if (elements.length > 0) {
        isLocalChange.current = true
        excalidrawAPI.updateScene({ elements })
        setTimeout(() => {
          isLocalChange.current = false
        }, 100)
      }
    }

    yElements.observe(observer)

    return () => {
      yElements.unobserve(observer)
    }
  }, [excalidrawAPI])

  // Load initial data when API is ready
  useEffect(() => {
    if (!excalidrawAPI || !yElementsRef.current) return

    const yElements = yElementsRef.current
    const elements = Array.from(yElements.values())
    if (elements.length > 0) {
      isLocalChange.current = true
      excalidrawAPI.updateScene({ elements })
      setTimeout(() => {
        isLocalChange.current = false
      }, 100)
    }
  }, [excalidrawAPI])

  // Sync local changes to Yjs
  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      if (isLocalChange.current) return

      const yElements = yElementsRef.current
      const yDoc = yDocRef.current
      if (!yElements || !yDoc) return

      yDoc.transact(() => {
        const currentKeys = new Set(yElements.keys())

        elements.forEach((el) => {
          yElements.set(el.id, el)
          currentKeys.delete(el.id)
        })

        currentKeys.forEach((key) => {
          yElements.delete(key)
        })
      }, 'local')
    },
    []
  )

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Excalidraw
        excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
        onChange={handleChange}
        UIOptions={{
          // Hide hamburger menu at top-left
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: false,
            saveToActiveFile: false,
            changeViewBackgroundColor: true,
            clearCanvas: true,
            toggleTheme: true,
          },
          // Hide help button (bottom-right ?)
          tools: {
            image: false, // Disable image upload
          },
        }}
        // Hide the welcome screen on first load
        initialData={{ appState: { viewBackgroundColor: '#ffffff' } }}
      />
      
      {/* Share Panel - Prominent and integrated */}
      <div
        className="share-panel"
        style={{
          position: 'fixed',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'white',
          padding: '8px 12px',
          borderRadius: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
        }}
      >
        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#10b981',
              animation: 'pulse 2s infinite',
            }}
          />
          <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
            Live
          </span>
        </div>
        
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        
        {/* Share button */}
        <button
          onClick={copyLink}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: showCopied ? '#10b981' : '#6366f1',
            color: 'white',
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
            transition: 'all 0.2s ease',
          }}
        >
          {showCopied ? (
            <>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </>
          )}
        </button>
      </div>
    </div>
  )
}
