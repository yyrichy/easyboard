import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';
/**
 * ============================================================================
 * RAW YJS WEBSOCKET SERVER IMPLEMENTATION
 * ============================================================================
 *
 * High-Level Overview:
 * --------------------
 * This server implements the Yjs WebSocket protocol manually, without relying on
 * the `y-websocket` library's `setupWSConnection` helper. This gives us full
 * control over the synchronization logic, connection management, and awareness
 * (cursor) propagation.
 *
 * The architecture consists of:
 * 1. HTTP Server: Handles the initial handshake.
 * 2. WebSocket Server: Upgrades HTTP requests to WebSocket connections.
 * 3. WSSharedDoc: A class that extends Y.Doc to manage:
 *    - The shared document state (CRDT).
 *    - The set of connected clients (WebSockets).
 *    - The Awareness instance (for ephemeral state like cursors).
 *
 * Protocols Used:
 * ---------------
 * - Sync Protocol: Exchanges document updates (Step 1, Step 2, Update).
 * - Awareness Protocol: Exchanges ephemeral state (who is online, cursor positions).
 */
const port = parseInt(process.env.PORT || '1234', 10);
// 1. Create a standard Node.js HTTP server
const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('Raw Y.js WebSocket Server');
});
// 2. Create a WebSocket Server attached to the HTTP server
// `noServer: true` means we handle the upgrade manually in the `upgrade` event.
const wss = new WebSocketServer({ noServer: true });
// Message types defined by y-protocols
const messageSync = 0;
const messageAwareness = 1;
const messageStats = 10;
/**
 * WSSharedDoc
 * -----------
 * Extends Y.Doc to include connection management and awareness logic.
 * One instance of this class exists per "room" (document name).
 */
class WSSharedDoc extends Y.Doc {
    name;
    /**
     * Map of connection -> Set of controlled user IDs.
     * A single WebSocket connection might control multiple user IDs (e.g., if testing multiple tabs).
     */
    conns;
    awareness;
    constructor(name) {
        super({ gc: true }); // Enable Garbage Collection for the CRDT
        this.name = name;
        this.conns = new Map();
        // Create an Awareness instance for this document
        this.awareness = new awarenessProtocol.Awareness(this);
        this.awareness.setLocalState(null); // Server has no local state (it's just a relay)
        /**
         * Awareness Update Handler
         * ------------------------
         * When any client updates their awareness (e.g., moves cursor), this handler fires.
         * We propagate the update to all OTHER connected clients.
         */
        const awarenessChangeHandler = ({ added, updated, removed }, origin) => {
            const changedClients = added.concat(updated).concat(removed);
            const hasOrigin = this.conns.has(origin);
            console.log(`DEBUG [${this.name}]: Awareness update. Size: ${this.conns.size}. HasOrigin: ${hasOrigin}. OriginState: ${origin?.readyState}`);
            // Update the set of user IDs controlled by the origin connection
            const connControlledIds = this.conns.get(origin);
            if (connControlledIds) {
                added.forEach((clientID) => { connControlledIds.add(clientID); });
                removed.forEach((clientID) => { connControlledIds.delete(clientID); });
            }
            else {
                console.log(`DEBUG [${this.name}]: Warning - origin not found. Conns keys: ${this.conns.size}`);
            }
            // Encode the awareness update
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients));
            const buff = encoding.toUint8Array(encoder);
            // Broadcast to all clients
            let broadcastCount = 0;
            this.conns.forEach((_, c) => {
                broadcastCount++;
                send(this, c, buff);
            });
            // console.log(`DEBUG: Broadcasted to ${broadcastCount}`)
        };
        this.awareness.on('update', awarenessChangeHandler);
        /**
         * Document Update Handler
         * -----------------------
         * When the Y.Doc is updated (by any client), this handler fires.
         * We encode the update and broadcast it to all OTHER clients.
         */
        this.on('update', (update, origin, doc) => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageSync);
            syncProtocol.writeUpdate(encoder, update); // Write the actual CRDT update
            const message = encoding.toUint8Array(encoder);
            // Broadcast to all clients EXCEPT the origin (echo suppression)
            this.conns.forEach((_, c) => {
                if (origin !== c) {
                    send(this, c, message);
                }
            });
        });
    }
}
// Global map of all active documents (Rooms)
const docs = new Map();
/**
 * getYDoc
 * -------
 * Retrieves an existing WSSharedDoc or creates a new one if it doesn't exist.
 */
const getYDoc = (docname, gc = true) => {
    return map.setIfUndefined(docs, docname, () => {
        const doc = new WSSharedDoc(docname);
        doc.gc = gc;
        if (docs.size > 1000) {
            // Simple GC for docs map if it gets too large
            console.warn('Many docs created, consider implementing cleanup');
        }
        return doc;
    });
};
/**
 * send
 * ----
 * Helper to send a binary message to a WebSocket connection.
 * Handles connection state checks and errors.
 */
const send = (doc, conn, m) => {
    if (conn.readyState !== WebSocket.OPEN) {
        closeConn(doc, conn);
        return; // Don't try to send on non-open connections
    }
    try {
        conn.send(m, (err) => { if (err != null)
            closeConn(doc, conn); });
    }
    catch (e) {
        closeConn(doc, conn);
    }
};
/**
 * closeConn
 * ---------
 * Cleans up a closed connection:
 * 1. Removes it from the doc's connection map.
 * 2. Removes associated awareness states (so cursors disappear).
 * 3. Destroys the doc if no clients are left (optional, but good for memory).
 */
const closeConn = (doc, conn) => {
    if (doc.conns.has(conn)) {
        const controlledIds = doc.conns.get(conn);
        doc.conns.delete(conn);
        console.log(`DEBUG [${doc.name}]: Closed connection. Remaining: ${doc.conns.size}`);
        // Remove awareness states for this user
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds || []), null);
        // If room is empty, destroy it to free memory
        if (doc.conns.size === 0) {
            doc.destroy();
            docs.delete(doc.name);
        }
    }
    conn.close();
};
/**
 * setupConnection
 * ---------------
 * The main logic for handling a new WebSocket connection.
 * 1. Gets/Creates the WSSharedDoc.
 * 2. Registers message handlers.
 * 3. Initiates the Sync Protocol (Step 1).
 */
const setupConnection = (ws, req, docName = 'lobby', gc = true) => {
    ws.binaryType = 'arraybuffer'; // Yjs works with binary data
    const doc = getYDoc(docName, gc);
    doc.conns.set(ws, new Set());
    console.log(`DEBUG [${docName}]: New connection. Total: ${doc.conns.size}`);
    // Handle incoming messages from the client
    ws.on('message', (message) => {
        try {
            // console.log(`DEBUG [${docName}]: Msg raw type: ${message.constructor.name}, Length: ${message.byteLength || message.length}`)
            const encoder = encoding.createEncoder();
            const decoder = decoding.createDecoder(new Uint8Array(message));
            const messageType = decoding.readVarUint(decoder);
            // console.log(`DEBUG [${docName}]: Decoded MsgType: ${messageType}`)
            switch (messageType) {
                case messageSync:
                    // Debug log (sample)
                    // if (Math.random() < 0.01) console.log('DEBUG: Received Sync step')
                    // Handle Sync Protocol (Step 1, Step 2, Update)
                    encoding.writeVarUint(encoder, messageSync);
                    syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
                    // If the sync protocol generated a response (e.g., Step 2), send it back
                    if (encoding.length(encoder) > 1) {
                        send(doc, ws, encoding.toUint8Array(encoder));
                    }
                    break;
                case messageAwareness:
                    // Handle Awareness Protocol (Cursor updates, etc.)
                    console.log(`DEBUG [${docName}]: Processing Awareness Msg. Payload len: ${message.byteLength || message.length}`);
                    // Read the awareness update payload
                    const awarenessUpdate = decoding.readVarUint8Array(decoder);
                    // Apply it to the server's awareness instance
                    awarenessProtocol.applyAwarenessUpdate(doc.awareness, awarenessUpdate, ws);
                    // Explicitly broadcast to OTHER clients (the event handler may be deferred)
                    const awarenessEncoder = encoding.createEncoder();
                    encoding.writeVarUint(awarenessEncoder, messageAwareness);
                    encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
                    const awarenessMsg = encoding.toUint8Array(awarenessEncoder);
                    console.log(`DEBUG [${docName}]: Broadcasting awareness to ${doc.conns.size} clients`);
                    doc.conns.forEach((_, c) => {
                        if (c !== ws) { // Don't echo back to sender
                            send(doc, c, awarenessMsg);
                        }
                    });
                    break;
                case messageStats:
                    // Debug Stats: Send active connection count back to client
                    const sEncoder = encoding.createEncoder();
                    encoding.writeVarUint(sEncoder, messageStats);
                    encoding.writeVarUint(sEncoder, doc.conns.size);
                    send(doc, ws, encoding.toUint8Array(sEncoder));
                    break;
            }
        }
        catch (err) {
            console.error(err);
            // doc.emit('error', [err]) // Y.Doc doesn't have an error event
        }
    });
    // Handle connection close
    ws.on('close', () => {
        closeConn(doc, ws);
    });
    // --- INITIAL SYNC HANDSHAKE ---
    {
        // 1. Send Sync Step 1: "Here is my state vector"
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeSyncStep1(encoder, doc);
        send(doc, ws, encoding.toUint8Array(encoder));
        // 2. Send current Awareness State: "Here are all online users"
        const awarenessStates = doc.awareness.getStates();
        if (awarenessStates.size > 0) {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())));
            send(doc, ws, encoding.toUint8Array(encoder));
        }
    }
};
// 3. Handle the HTTP Upgrade (The "Handshake")
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
// 4. Handle WebSocket Connections
wss.on('connection', (ws, req) => {
    const docName = req.url?.slice(1) || 'lobby';
    console.log(`Client connected to room: ${docName}`);
    setupConnection(ws, req, docName);
});
// Start listening
server.listen(port, () => {
    console.log(`Raw Server running on port ${port}`);
});
