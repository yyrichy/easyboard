# Distributed, Local-First Collaborative Whiteboard

A real-time, "Share-to-Join" collaborative whiteboard built with **Next.js**, **Fabric.js**, and **Y.js**. Local-first, offline support, with conflict resolution/eventual consistency via CRDTs. No central authority or source of truth.

## Overview

This project is a collaborative whiteboard that allows users to:
-   **Draw** freehand sketches.
-   **Add Shapes** (Rectangles) and **Text**.
-   **Collaborate Real-time**: See other users' cursors and changes instantly.
-   **Share-to-Join**: No login required. Just share the URL.
-   **Newspaper Theme**: A unique, high-contrast, serif-styled UI.

## Tech Stack

-   **Frontend**: Next.js (App Router), React, Tailwind CSS.
-   **Whiteboard Engine**: [Fabric.js](http://fabricjs.com/) - chosen for its flexibility and customizability compared to "boilerplate" whiteboard tools.
-   **Real-time Sync**: [Y.js](https://github.com/yjs/yjs) - A CRDT (Conflict-free Replicated Data Type) library.
-   **WebSocket Server**: [Hocuspocus](https://hocuspocus.dev/) - A scalable WebSocket backend for Y.js.
-   **Styling**: Tailwind CSS + Lucide Icons.

## How Y.js Helps (The Magic Sauce)

Y.js is the backbone of the collaboration features. Here's how it works in this project:

### 1. Shared Data Structure (`Y.Map`)
Instead of sending JSON blobs back and forth, we store the entire canvas state in a shared `Y.Map` called `'fabric-canvas'`.
-   **Key**: The Object ID (e.g., `rect-123`).
-   **Value**: The Fabric.js object representation (JSON).

### 2. Conflict Resolution (CRDTs)
When two users edit the whiteboard at the same time, Y.js ensures they end up with the **same state** without needing a central authority to "lock" the file.

*   **Scenario A: Concurrent Editing**
    *   User A moves "Rect 1" to the left.
    *   User B moves "Rect 1" to the right.
    *   **Resolution**: Y.js uses a "Last Write Wins" approach for the object properties. The update that occurred "later" (based on logical clocks) will be the final position. Everyone sees the same result.

*   **Scenario B: Offline Editing**
    *   User A goes offline and adds 5 shapes.
    *   User B stays online and deletes 2 shapes.
    *   **Resolution**: When User A reconnects, Y.js merges the changes. The 5 new shapes appear. If User A modified a shape that User B deleted, the deletion typically takes precedence (depending on the exact implementation of the map key removal).

### 3. Awareness (Cursors & Presence)
Y.js has a feature called `Awareness` which is perfect for ephemeral data that doesn't need to be stored forever.
-   **Cursors**: We broadcast mouse coordinates (x, y) via Awareness.
-   **Usernames**: When you set your name, it's broadcast via Awareness.
-   **Resolution**: If two users have the same name, it doesn't matter. Awareness just shows "who is online right now".

## Installation

### Prerequisites
-   Node.js (v18+)
-   npm

### Setup

1.  **Install Dependencies** (Root)
    ```bash
    npm install
    ```

2.  **Run Separately (Recommended)**
    Open two terminals:

    **Terminal 1: Backend**
    ```bash
    cd apps/backend
    npm run dev
    ```
    *(Runs on ws://localhost:1234)*

    **Terminal 2: Frontend**
    ```bash
    cd apps/frontend
    npm run dev
    ```
    *(Runs on http://localhost:3000)*

    > **Note**: You can still run both at once with `npm run dev --workspaces` in the root if you prefer.

## Project Structure

```
.
├── apps
│   ├── backend     # Hocuspocus WebSocket Server
│   └── frontend    # Next.js App (Fabric.js Canvas)
├── package.json    # Monorepo configuration      
```

## Design Decisions

-   **Fabric.js over Tldraw**: We switched from Tldraw to Fabric.js to have complete control over the visual style (the "Newspaper" look) and to avoid the generic whiteboard feel.
-   **Custom Sync Engine**: Since Fabric.js doesn't have a built-in Y.js binding, we built a custom hook that listens to Fabric events (`object:modified`) and updates the Y.js map, and vice-versa.

## Deployment

### Backend → Railway (Free Tier)

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Deploy:
   ```bash
   cd apps/backend
   railway init
   railway up
   ```
4. Copy the deployed URL (e.g., `wss://your-app.railway.app`)

### Frontend → Vercel (Free Tier)

1. Push your repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import project
3. Set root directory to `apps/frontend`
4. Add environment variable:
   ```
   NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app
   ```
5. Deploy!

### Environment Variables

| Variable | Location | Description |
|----------|----------|-------------|
| `PORT` | Backend | Railway injects this automatically |
| `NEXT_PUBLIC_WS_URL` | Frontend | WebSocket server URL (wss:// for production) |

