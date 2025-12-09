'use client'

import dynamic from 'next/dynamic'

const ExcalidrawCanvas = dynamic(() => import('./ExcalidrawCanvas'), {
  ssr: false,
  loading: () => (
    <div style={{ 
      width: '100%', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: '#f8f9fa',
    }}>
      Loading...
    </div>
  )
})

export default function Editor({ roomId }: { roomId: string }) {
  return <ExcalidrawCanvas roomId={roomId} />
}
