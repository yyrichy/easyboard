# Collaborative Whiteboard

A real-time, "Share-to-Join" collaborative whiteboard built with **Next.js**, **Excalidraw**, and **Y.js**. Local-first with offline support, using CRDTs for conflict resolution and eventual consistency. No central authority or source of truth.

## Overview

This project is a collaborative whiteboard that allows users to:
-   **Draw** freehand sketches
-   **Add Shapes** (rectangles, ellipses, arrows, etc.)
-   **Erase** strokes (proper eraser, not white paint)
-   **Collaborate Real-time**: See other users' changes instantly
-   **Share-to-Join**: No login required. Just share the URL.
-   **Offline Support**: Continue working offline, changes sync when reconnected

## Tech Stack

-   **Frontend**: Next.js (App Router), React, Tailwind CSS
-   **Whiteboard Engine**: [Excalidraw](https://excalidraw.com/) - MIT licensed, battle-tested (used by Meta, Microsoft, etc.)
-   **Real-time Sync**: [Y.js](https://github.com/yjs/yjs) - CRDT (Conflict-free Replicated Data Type) library
-   **WebSocket Server**: Custom raw Y.js WebSocket server
-   **Offline Persistence**: [y-indexeddb](https://github.com/yjs/y-indexeddb)

## Architecture

```
┌─────────────────┐     Y.js Sync     ┌─────────────────┐
│  Client A       │◄─────────────────►│  WebSocket      │
│                 │     (Binary)      │  Server         │
└─────────────────┘                   │  (Stateless)    │
                                      └────────┬────────┘
┌─────────────────┐     Y.js Sync              │
│  Client B       │◄───────────────────────────┘
│                 │
└─────────────────┘

Each client has:
- Y.Doc → Shared CRDT document
- Y.Map → Stores Excalidraw elements by ID
- IndexedDB → Local persistence for offline
```

## How Y.js Works (The Magic)

### Shared Data Structure (`Y.Map`)
Excalidraw elements are stored in a shared `Y.Map`:
-   **Key**: Element ID (e.g., `arrow_1702...`)
-   **Value**: Excalidraw element object

### Conflict Resolution (CRDTs)
When two users edit simultaneously, Y.js ensures eventual consistency:

| Scenario | Resolution |
|----------|------------|
| User A and B move same shape | "Last Write Wins" - latest timestamp wins |
| User A goes offline, adds shapes | Shapes merge when reconnected |
| User A deletes, User B modifies | Deletion typically wins |

### Why Backend Doesn't Care About Excalidraw
The backend is **data-agnostic**. It only relays Y.js binary updates:
```
Client A → Yjs Update (binary) → Server → broadcast → Client B
```
It doesn't parse or validate the data - works with any Y.js content.

## Installation

### Prerequisites
-   Node.js (v18+)
-   npm

### Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Run Backend** (Terminal 1)
    ```bash
    cd apps/backend
    npm run dev
    ```
    *(Runs on ws://localhost:1234)*

3.  **Run Frontend** (Terminal 2)
    ```bash
    cd apps/frontend
    npm run dev
    ```
    *(Runs on http://localhost:3000)*

## Project Structure

```
.
├── apps
│   ├── backend          # Raw Y.js WebSocket Server
│   │   └── raw-server.ts
│   └── frontend         # Next.js App
│       └── components
│           └── ExcalidrawCanvas.tsx
├── package.json         # Monorepo configuration
```

## Deployment

### Backend → Railway

```bash
cd apps/backend
railway init
railway up
```

### Frontend → Vercel

1. Push to GitHub
2. Import project at [vercel.com](https://vercel.com)
3. Set root directory: `apps/frontend`
4. Add environment variable:
   ```
   NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app
   ```

### Environment Variables

| Variable | Location | Description |
|----------|----------|-------------|
| `PORT` | Backend | Railway injects automatically |
| `NEXT_PUBLIC_WS_URL` | Frontend | WebSocket URL (wss:// for production) |

## Resume Value

This project demonstrates:
- **Distributed Systems**: CRDTs, eventual consistency, conflict resolution
- **Real-time Collaboration**: WebSocket protocol, Y.js sync layer
- **Offline-First Architecture**: IndexedDB persistence, reconnection handling
- **Custom Protocol**: Raw WebSocket handling (not using a framework like Socket.io)
