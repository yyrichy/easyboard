'use client'

import dynamic from 'next/dynamic'

const FabricCanvas = dynamic(() => import('./FabricCanvas'), {
  ssr: false,
  loading: () => <div className="w-full h-screen flex items-center justify-center">Loading Whiteboard...</div>
})

export default function Editor({ roomId }: { roomId: string }) {
  return <FabricCanvas roomId={roomId} />
}
