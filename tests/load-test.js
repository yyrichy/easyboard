/**
 * Load Test for Yjs WebSocket Server
 * 
 * Tests concurrent WebSocket connections with awareness updates
 * and measures latency, delivery rate, and connection success.
 * 
 * Usage: npx tsx tests/load-test.js
 */

import WebSocket from 'ws'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import os from 'os'

// Configuration
const CONFIG = {
    SERVER_URL: 'ws://localhost:1234/load-test-room',
    NUM_CLIENTS: 50,
    MESSAGES_PER_CLIENT: 10,
    CONNECTION_STAGGER_MS: 5,
    WARMUP_MS: 100,
    SETTLE_MS: 300,
}

// Metrics storage
const metrics = {
    connectionsAttempted: 0,
    connectionsSucceeded: 0,
    connectionsFailed: 0,
    messagesSent: 0,
    messagesReceived: 0,
    messagesExpected: 0,
    latencies: [],
    startTime: 0,
    endTime: 0,
}

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const percentile = (arr, p) => {
    if (arr.length === 0) return 0
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]
}

/**
 * Represents a single test client with WebSocket, Y.Doc, and Awareness
 */
class LoadTestClient {
    constructor(id) {
        this.id = id
        this.ws = null
        this.doc = new Y.Doc()
        this.doc.clientID = 10000 + id
        this.awareness = new awarenessProtocol.Awareness(this.doc)
        this.connected = false
        this.seenMessages = new Set()
    }

    // Connect to the WebSocket server
    async connect() {
        metrics.connectionsAttempted++
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000)

            this.ws = new WebSocket(CONFIG.SERVER_URL)
            this.ws.binaryType = 'arraybuffer'

            this.ws.on('open', () => {
                clearTimeout(timeout)
                this.connected = true
                metrics.connectionsSucceeded++
                this.setupMessageHandler()
                resolve()
            })

            this.ws.on('error', (err) => {
                clearTimeout(timeout)
                metrics.connectionsFailed++
                reject(err)
            })

            this.ws.on('close', () => { this.connected = false })
        })
    }

    // Handle incoming messages and track latency
    setupMessageHandler() {
        this.ws.on('message', (data) => {
            const decoder = decoding.createDecoder(new Uint8Array(data))
            const messageType = decoding.readVarUint(decoder)

            if (messageType === 1) { // Awareness message
                const receiveTime = performance.now()
                const update = decoding.readVarUint8Array(decoder)
                awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote')
                
                // Track latency for each unique message
                this.awareness.getStates().forEach((state, clientId) => {
                    if (clientId !== this.awareness.clientID && state?.sendTime) {
                        const msgKey = `${clientId}:${state.sendTime}`
                        if (!this.seenMessages.has(msgKey)) {
                            this.seenMessages.add(msgKey)
                            const latency = receiveTime - state.sendTime
                            if (latency > 0 && latency < 10000) {
                                metrics.latencies.push(latency)
                            }
                            metrics.messagesReceived++
                        }
                    }
                })
            }
        })
    }

    // Send an awareness update with embedded timestamp
    sendAwarenessUpdate(messageNum) {
        if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return

        this.awareness.setLocalState({
            user: `User ${this.id}`,
            message: messageNum,
            sendTime: performance.now(),
        })

        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, 1)
        encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
        )
        
        this.ws.send(encoding.toUint8Array(encoder))
        metrics.messagesSent++
    }

    disconnect() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close()
        }
    }
}

/**
 * Main load test runner
 */
async function runLoadTest() {
    console.log('═'.repeat(60))
    console.log('🚀 LOAD TEST')
    console.log('═'.repeat(60))
    console.log(`Clients: ${CONFIG.NUM_CLIENTS} | Messages/client: ${CONFIG.MESSAGES_PER_CLIENT}\n`)

    metrics.startTime = performance.now()
    const clients = []

    // Phase 1: Connect all clients
    console.log('Connecting clients...')
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        const client = new LoadTestClient(i)
        clients.push(client)
        try {
            await client.connect()
        } catch (err) {
            console.error(`Client ${i} failed: ${err.message}`)
        }
        if (i < CONFIG.NUM_CLIENTS - 1) await sleep(CONFIG.CONNECTION_STAGGER_MS)
    }
    console.log(`${metrics.connectionsSucceeded}/${CONFIG.NUM_CLIENTS} connected\n`)

    // Phase 2: Warmup
    await sleep(CONFIG.WARMUP_MS)

    // Phase 3: Send messages
    console.log('Sending awareness updates...')
    metrics.messagesExpected = CONFIG.NUM_CLIENTS * CONFIG.MESSAGES_PER_CLIENT * (CONFIG.NUM_CLIENTS - 1)
    
    for (let msgNum = 0; msgNum < CONFIG.MESSAGES_PER_CLIENT; msgNum++) {
        await Promise.all(clients.map(client => 
            new Promise(resolve => {
                setTimeout(() => {
                    client.sendAwarenessUpdate(msgNum)
                    resolve()
                }, Math.random() * 10)
            })
        ))
        await sleep(30)
    }
    console.log(`${metrics.messagesSent} messages sent\n`)

    // Phase 4: Wait for propagation
    await sleep(CONFIG.SETTLE_MS)

    // Phase 5: Disconnect
    clients.forEach(client => client.disconnect())
    await sleep(300)
    metrics.endTime = performance.now()

    // Print results
    printResults()
}

function printResults() {
    const duration = ((metrics.endTime - metrics.startTime) / 1000).toFixed(2)
    const connectionRate = (metrics.connectionsSucceeded / metrics.connectionsAttempted * 100).toFixed(1)
    const deliveryRate = (metrics.messagesReceived / metrics.messagesExpected * 100).toFixed(1)
    const p50 = percentile(metrics.latencies, 50).toFixed(1)
    const p95 = percentile(metrics.latencies, 95).toFixed(1)
    const p99 = percentile(metrics.latencies, 99).toFixed(1)
    const avg = (metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length).toFixed(1)

    console.log('═'.repeat(60))
    console.log('RESULTS')
    console.log('═'.repeat(60))
    console.log(`Connections: ${metrics.connectionsSucceeded}/${metrics.connectionsAttempted} (${connectionRate}%)`)
    console.log(`Messages: ${metrics.messagesReceived.toLocaleString()}/${metrics.messagesExpected.toLocaleString()} (${deliveryRate}% delivery)`)
    console.log(`Latency: avg=${avg}ms, p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`)
    console.log(`Duration: ${duration}s`)
    console.log('═'.repeat(60))
    console.log(`\n"Load tested with ${metrics.connectionsSucceeded}+ concurrent users, p95=${p95}ms, ${deliveryRate}% delivery"\n`)

    process.exit(parseFloat(connectionRate) >= 95 && parseFloat(deliveryRate) >= 90 ? 0 : 1)
}

runLoadTest().catch(err => {
    console.error('Load test failed:', err)
    process.exit(1)
})