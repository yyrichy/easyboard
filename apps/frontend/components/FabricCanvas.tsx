'use client'

import { useEffect, useRef, useState } from 'react'
import { fabric } from 'fabric'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MousePointer2, Pencil, Square, Trash2, Type } from 'lucide-react'

// Extend fabric.Object to include 'id'
interface FabricObject extends fabric.Object {
  id?: string
}

export default function FabricCanvas({ roomId }: { roomId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const isRemoteUpdate = useRef(false)
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [activeTool, setActiveTool] = useState<'select' | 'draw'>('draw')

  const [cursors, setCursors] = useState<{ [key: number]: { x: number, y: number, color: string, name: string } }>({})

  const [username, setUsername] = useState(`User ${Math.floor(Math.random() * 100)}`)

  useEffect(() => {
    if (!canvasRef.current) return

    // Initialize Fabric Canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      isDrawingMode: true,
      backgroundColor: '#f3f4f6', // Light gray background
    })
    fabricRef.current = canvas

    // Customize selection style
    fabric.Object.prototype.set({
        transparentCorners: false,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#ea580c', // Orange 600
        borderColor: '#ea580c', // Orange 600
        cornerSize: 10,
        padding: 5,
        cornerStyle: 'circle',
        borderDashArray: [4, 4],
    })

    // Initialize Yjs
    const yDoc = new Y.Doc()
    const yMap = yDoc.getMap('fabric-canvas')
    
    // 1. WebSocket Provider (Real-time)
    const newProvider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234',
      roomId,
      yDoc
    )
    setProvider(newProvider as any)

    // 2. IndexedDB Provider (Offline Persistence)
    const indexeddbProvider = new IndexeddbPersistence(roomId, yDoc)
    
    indexeddbProvider.on('synced', () => {
        console.log('Content loaded from database')
    })

    // --- Awareness (Cursors) ---
    const awareness = newProvider.awareness
    if (!awareness) return

    const myColor = '#' + Math.floor(Math.random()*16777215).toString(16)
    
    // Initial state
    awareness.setLocalStateField('user', {
        name: username,
        color: myColor,
    })

    const handleAwarenessUpdate = () => {
        const states = awareness.getStates()
        const newCursors: any = {}
        
        states.forEach((state: any, clientId: number) => {
            if (clientId !== awareness.clientID && state.cursor && state.user) {
                newCursors[clientId] = {
                    x: state.cursor.x,
                    y: state.cursor.y,
                    color: state.user.color,
                    name: state.user.name,
                }
            }
        })
        setCursors(newCursors)
    }

    awareness.on('change', handleAwarenessUpdate)

    // Helper: Throttle function to limit network updates
    const throttle = (func: Function, limit: number) => {
      let inThrottle: boolean
      return function(this: any, ...args: any[]) {
        if (!inThrottle) {
          func.apply(this, args)
          inThrottle = true
          setTimeout(() => inThrottle = false, limit)
        }
      }
    }

    // Awareness: Broadcast cursor position
    const handleMouseMove = throttle((e: any) => {
        if (!newProvider || !newProvider.awareness) return
        const p = e.pointer
        newProvider.awareness.setLocalStateField('cursor', {
            x: p.x,
            y: p.y
        })
    }, 50)
    canvas.on('mouse:move', handleMouseMove)

    // Z-Index: Bring to front on selection
    const handleSelection = (e: any) => {
        if (e.target) {
            e.target.bringToFront()
        }
    }
    canvas.on('selection:created', handleSelection)
    canvas.on('selection:updated', handleSelection)


    // --- Sync Logic ---

    // 1. Local -> Remote
    const handlePathCreated = (e: any) => {
      if (isRemoteUpdate.current) return
      const path = e.path as FabricObject
      if (!path) return
      
      if (!path.id) {
          path.set('id', Math.random().toString(36).substr(2, 9))
      }

      const json = path.toObject(['id'])
      yMap.set(path.id!, json)
    }

    const handleObjectModified = (e: any) => {
      if (isRemoteUpdate.current) return
      const obj = e.target as FabricObject
      if (!obj || !obj.id) return
      
      const json = obj.toObject(['id'])
      yMap.set(obj.id, json)
    }

    canvas.on('path:created', handlePathCreated)
    canvas.on('object:modified', handleObjectModified)
    // Handle scaling for text to avoid stretching
    canvas.on('object:scaling', (e: any) => {
        const obj = e.target
        if (obj instanceof fabric.IText) {
            // Reset scale and update fontSize instead
            // This is a common pattern to prevent font stretching
            // However, for simple sync, it's easier to just let it scale but lock uni-scaling
            // or we can just let it be for now but enable lockUniScaling on creation.
        }
    })

    // 2. Remote -> Local
    const handleYMapUpdate = (event: Y.YMapEvent<any>) => {
      isRemoteUpdate.current = true
      
      event.changes.keys.forEach((change, key) => {
          if (change.action === 'add' || change.action === 'update') {
            const objData = yMap.get(key) as any // Cast to any or specific type
            
            const existing = canvas.getObjects().find((o: any) => o.id === key) as FabricObject | undefined
            
            if (existing) {
                existing.set(objData)
                existing.setCoords()
                canvas.requestRenderAll()
            } else {
                fabric.util.enlivenObjects([objData], (enlivened: any[]) => {
                    enlivened.forEach((obj) => {
                        // Ensure strokeUniform is set on remote objects too
                        obj.set('strokeUniform', true)
                        canvas.add(obj)
                    })
                }, 'fabric')
            }
          } else if (change.action === 'delete') {
             const existing = canvas.getObjects().find((o: any) => o.id === key)
             if (existing) {
                 canvas.remove(existing)
             }
          }
        })

      isRemoteUpdate.current = false
    }

    yMap.observe(handleYMapUpdate)
    
    // Initial Load
    const initialData = Array.from(yMap.values())
    if (initialData.length > 0) {
        isRemoteUpdate.current = true
        fabric.util.enlivenObjects(initialData, (objs: any[]) => {
            objs.forEach((obj) => {
                obj.set('strokeUniform', true)
                canvas.add(obj)
            })
            isRemoteUpdate.current = false
        }, 'fabric')
    }

    // Resize handler
    const handleResize = () => {
        canvas.setWidth(window.innerWidth)
        canvas.setHeight(window.innerHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      newProvider.destroy()
      yDoc.destroy()
      canvas.dispose()
      window.removeEventListener('resize', handleResize)
    }
  }, [roomId])

  // Update username in awareness when it changes
  useEffect(() => {
      if (!provider || !provider.awareness) return
      const awareness = provider.awareness
      const currentState = awareness.getLocalState()
      if (currentState && currentState.user) {
          awareness.setLocalStateField('user', {
              ...currentState.user,
              name: username,
          })
      }
  }, [username, provider])

  // Tools
  const toggleDraw = () => {
      if (!fabricRef.current) return
      const isDrawing = !fabricRef.current.isDrawingMode
      fabricRef.current.isDrawingMode = isDrawing
      setActiveTool(isDrawing ? 'draw' : 'select')
  }

  const addRect = () => {
      if (!fabricRef.current) return
      const rect = new fabric.Rect({
          left: 100, top: 100, 
          fill: '#ffedd5', // Orange 100
          stroke: '#ea580c', // Orange 600
          strokeWidth: 2, 
          width: 100, height: 100,
          rx: 10, ry: 10, // Rounded corners
          id: Math.random().toString(36).substr(2, 9),
          strokeUniform: true, // Prevent border scaling
      } as any)
      fabricRef.current.add(rect)
      fabricRef.current.setActiveObject(rect)
      
      // Sync
      const yMap = provider?.doc.getMap('fabric-canvas')
      if(yMap) yMap.set((rect as unknown as FabricObject).id!, rect.toObject(['id']))
      
      // Switch to select mode
      fabricRef.current.isDrawingMode = false
      setActiveTool('select')
  }

  const addText = () => {
      if (!fabricRef.current) return
      const text = new fabric.Textbox('Type here...', {
          left: 100, top: 100, 
          fontSize: 24,
          fontFamily: 'Inter, sans-serif',
          fill: '#1f2937',
          width: 200, // Set initial width for wrapping
          splitByGrapheme: true,
          id: Math.random().toString(36).substr(2, 9),
          lockScalingY: true, // Lock vertical scaling (auto-height)
      } as any)
      
      // Custom control to allow width resizing without scaling
      text.setControlsVisibility({
          mt: false, 
          mb: false, 
          ml: true, 
          mr: true, 
          bl: true,
          br: true,
          tl: true,
          tr: true,
          mtr: true
      })

      fabricRef.current.add(text)
      fabricRef.current.setActiveObject(text)
      text.enterEditing()
      text.selectAll()

      // Sync
      const yMap = provider?.doc.getMap('fabric-canvas')
      if(yMap) yMap.set((text as unknown as FabricObject).id!, text.toObject(['id']))

      // Switch to select mode
      fabricRef.current.isDrawingMode = false
      setActiveTool('select')
  }

  const clearCanvas = () => {
      if (!fabricRef.current) return
      fabricRef.current.clear()
      fabricRef.current.setBackgroundColor('#f3f4f6', () => fabricRef.current?.renderAll())
      
      // Clear Yjs
      const yMap = provider?.doc.getMap('fabric-canvas')
      if (yMap) yMap.clear()
  }

  const copyLink = () => {
      const url = window.location.href
      navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
  }

  return (
    <div className="w-full h-screen relative overflow-hidden bg-[#f0f0f0]">
      <canvas ref={canvasRef} />
      
      {/* Header - User Settings & Share */}
      <div className="absolute top-4 right-4 flex gap-3 z-50 font-serif">
          <div className="bg-[#fdfbf7] p-2 rounded border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2">
              <div className="w-6 h-6 bg-black text-white flex items-center justify-center font-bold text-xs rounded-sm">
                  {username.charAt(0).toUpperCase()}
              </div>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-transparent border-b border-black/20 focus:border-black outline-none text-base text-black w-32 focus:ring-0 placeholder:text-gray-400"
                placeholder="Your Name"
              />
              <Pencil size={12} className="text-gray-400" />
          </div>
          
          <button 
            onClick={copyLink}
            className="bg-black text-white px-4 py-2 border-2 border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] transition-all font-bold text-sm uppercase tracking-wider flex items-center gap-2"
          >
              Share
          </button>
      </div>

      {/* Cursors Overlay */}
      {Object.entries(cursors).map(([clientId, cursor]) => (
          <div 
            key={clientId}
            className="absolute pointer-events-none transition-all duration-100 ease-linear z-50"
            style={{ 
                left: cursor.x, 
                top: cursor.y,
            }}
          >
              <MousePointer2 
                size={20} 
                fill={cursor.color} 
                color={cursor.color} 
                className="transform -translate-x-1 -translate-y-1"
              />
              <div 
                className="absolute left-4 top-4 px-2 py-1 bg-black text-white text-xs font-serif border border-white shadow-sm whitespace-nowrap"
              >
                  {cursor.name}
              </div>
          </div>
      ))}
      
      {/* Floating Toolbar - Newspaper Style */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-[#fdfbf7] p-2 rounded-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex items-center gap-4 border-2 border-black z-50 font-serif">
         <div className="flex gap-2">
             <button 
                onClick={() => {
                    if (!fabricRef.current) return
                    fabricRef.current.isDrawingMode = false
                    setActiveTool('select')
                }} 
                className={`p-3 border-2 transition-all duration-200 ${activeTool === 'select' ? 'bg-black text-white border-black' : 'bg-transparent text-black border-transparent hover:bg-black/5'}`}
                title="Select"
             >
                 <MousePointer2 size={20} />
             </button>
             <button 
                onClick={toggleDraw} 
                className={`p-3 border-2 transition-all duration-200 ${activeTool === 'draw' ? 'bg-black text-white border-black' : 'bg-transparent text-black border-transparent hover:bg-black/5'}`}
                title="Draw"
             >
                 <Pencil size={20} />
             </button>
         </div>

         <div className="w-0.5 h-8 bg-black"></div>

         <div className="flex gap-2">
             <button 
                onClick={addRect} 
                className="p-3 border-2 border-transparent hover:border-black hover:bg-black/5 text-black transition-all"
                title="Rectangle"
             >
                 <Square size={20} />
             </button>
             <button 
                onClick={addText} 
                className="p-3 border-2 border-transparent hover:border-black hover:bg-black/5 text-black transition-all"
                title="Text"
             >
                 <Type size={20} />
             </button>
         </div>

         <div className="w-0.5 h-8 bg-black"></div>

         <button 
            onClick={clearCanvas} 
            className="p-3 border-2 border-transparent hover:border-red-600 hover:bg-red-50 text-red-600 transition-all"
            title="Clear Canvas"
         >
             <Trash2 size={20} />
         </button>
      </div>
    </div>
  )
}
