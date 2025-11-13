---
sidebar_position: 6
title: WebRTC and RAFT Consensus-Algorithm
description: WebRTC and RAFT Consensus-Algorithm
---
# P2P WebRTC with RAFT Consensus - Technical Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [WebRTC Implementation](#webrtc-implementation)
3. [RAFT Consensus Algorithm](#raft-consensus-algorithm)
4. [Integration](#integration)
5. [Key Flows](#key-flows)
6. [API Reference](#api-reference)

---

## Architecture Overview

This application implements a **peer-to-peer (P2P) communication system** using WebRTC with **RAFT consensus** for distributed leader election. The system enables:

- Real-time video/audio streaming between peers
- Text messaging via data channels
- File transfer capabilities
- Automatic leader election among connected peers
- Fault-tolerant distributed coordination

### High-Level Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Peer A    │◄───────►│   Peer B    │◄───────►│   Peer C    │
│             │         │             │         │             │
│ WebRTC Mgr  │         │ WebRTC Mgr  │         │ WebRTC Mgr  │
│ RAFT Mgr    │         │ RAFT Mgr    │         │ RAFT Mgr    │
│ (Follower)  │         │ (Leader)    │         │ (Follower)  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
                        ┌──────▼──────┐
                        │ Centrifugo  │
                        │  Signaling  │
                        │   Server    │
                        └─────────────┘
```

---

## WebRTC Implementation

### Overview

**WebRTC (Web Real-Time Communication)** enables peer-to-peer connections for audio, video, and data transfer directly between browsers without a central server (after initial signaling).

### Components

#### 1. **WebRTCManager** (`src/utils/webrtc.ts`)

Main class managing all WebRTC peer connections.

**Key Responsibilities:**
- Managing peer connections lifecycle
- Handling signaling via Centrifugo
- Managing media streams (video/audio)
- Data channel communication (messages, files, RAFT messages)

#### 2. **Connection Flow**

```
1. User creates/joins room
   ↓
2. Connect to Centrifugo signaling server
   ↓
3. Subscribe to room channel
   ↓
4. Announce presence to room
   ↓
5. Receive peer list / new peer notifications
   ↓
6. For each peer:
   - Create RTCPeerConnection
   - Create offer (if initiator)
   - Exchange SDP via signaling
   - Exchange ICE candidates
   - Establish P2P connection
   ↓
7. Connection established ✓
```

#### 3. **Signaling Messages**

Messages exchanged via Centrifugo for WebRTC setup:

```typescript
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'raft-message';
  from: string;           // Sender's peer ID
  to?: string;            // Target peer ID (optional)
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  raftMessage?: RaftMessage;  // RAFT consensus messages
}
```

#### 4. **Media Streams**

- **Local Stream**: Captured from user's camera/microphone
- **Remote Streams**: Received from connected peers
- **Controls**: Enable/disable video and audio independently

```typescript
// Enable video with audio
await webrtcManager.enableVideo(true);

// Disable video
await webrtcManager.enableVideo(false);
```

#### 5. **Data Channels**

Each peer connection includes a data channel for:
- **Text messages**: JSON-encoded messages
- **File transfers**: Binary data chunks
- **RAFT messages**: Consensus protocol communication

**Message Format:**
```typescript
// Text message
{
  type: 'message',
  message: 'Hello!'
}

// File metadata
{
  type: 'file-metadata',
  fileName: 'image.png',
  fileSize: 12345,
  fileType: 'image/png'
}

// File data (binary)
ArrayBuffer

// RAFT message
{
  type: 'raft-message',
  raftMessage: { ... }
}
```

#### 6. **File Transfer**

Files are sent in a two-step process:

```
1. Send file metadata (name, size, type)
   ↓
2. Send file data as ArrayBuffer
   ↓
3. Receiver reconstructs file from metadata + data
```

---

## RAFT Consensus Algorithm

### Overview

**RAFT** is a consensus algorithm designed to manage a replicated log across distributed systems. In this application, we use RAFT for **leader election** to ensure only one peer acts as the coordinator.

### Node States

```
┌───────────┐
│ Follower  │ ◄─── Initial state
└─────┬─────┘
      │ Election timeout
      ▼
┌───────────┐
│ Candidate │ ◄─── Requests votes
└─────┬─────┘
      │ Receives majority votes
      ▼
┌───────────┐
│  Leader   │ ◄─── Sends heartbeats
└───────────┘
```

#### 1. **Follower**
- Default state for all nodes
- Listens for heartbeats from leader
- If no heartbeat received → becomes Candidate

#### 2. **Candidate**
- Increments term number
- Votes for itself
- Requests votes from all peers
- If receives majority → becomes Leader
- If receives heartbeat from valid leader → becomes Follower

#### 3. **Leader**
- Sends periodic heartbeats to all followers
- Maintains authority over the cluster
- Only one leader exists per term

### RaftManager (`src/utils/raft.ts`)

#### Key Properties

```typescript
class RaftManager {
  private nodeId: string;              // Unique node identifier
  private state: NodeState;            // 'follower' | 'candidate' | 'leader'
  private currentTerm: number;         // Current election term
  private votedFor: string | null;     // Voted candidate in current term
  private leaderId: string | null;     // Current leader's ID
  private peers: Set<string>;          // Connected peer IDs
  
  // Timing constants
  private ELECTION_TIMEOUT_MIN = 3000;   // 3 seconds
  private ELECTION_TIMEOUT_MAX = 5000;   // 5 seconds
  private HEARTBEAT_INTERVAL = 1500;     // 1.5 seconds
}
```

#### Message Types

```typescript
interface RaftMessage {
  type: 'heartbeat' | 'vote-request' | 'vote-response' | 'append-entries';
  term: number;           // Current term number
  from: string;           // Sender's node ID
  to?: string;            // Target node ID
  candidateId?: string;   // Candidate requesting vote
  voteGranted?: boolean;  // Vote response
  leaderId?: string;      // Current leader ID
}
```

### Leader Election Process

#### Step-by-Step Flow

```
1. Node starts as Follower
   ↓
2. Election timeout expires (3-5s random)
   ↓
3. Become Candidate:
   - Increment term
   - Vote for self
   - Send vote-request to all peers
   ↓
4. Peers respond with vote-response:
   - Grant vote if haven't voted in this term
   - Deny vote if already voted or higher term
   ↓
5. If majority votes received:
   → Become Leader
   → Start sending heartbeats
   ↓
6. If heartbeat received from valid leader:
   → Become Follower
   ↓
7. If election timeout expires again:
   → Start new election (goto step 3)
```

#### Majority Calculation

```typescript
// For N peers + 1 (self)
const majorityNeeded = Math.floor((peers.size + 1) / 2) + 1;

// Examples:
// 1 node (no peers):  majority = 1  (self vote enough)
// 2 nodes:            majority = 2  (need both)
// 3 nodes:            majority = 2  (need 2 out of 3)
// 5 nodes:            majority = 3  (need 3 out of 5)
```

### Heartbeat Mechanism

**Leader sends heartbeats every 1.5 seconds:**

```typescript
heartbeat: {
  type: 'heartbeat',
  term: currentTerm,
  from: leaderId,
  leaderId: leaderId
}
```

**Followers reset election timeout on heartbeat receipt:**
- Ensures leader authority is maintained
- Prevents unnecessary elections
- If no heartbeat → triggers new election

---

## Integration

### How WebRTC and RAFT Work Together

#### 1. **Transport Layer**

RAFT messages are transmitted over WebRTC data channels:

```typescript
// In WebRTCManager
sendRaftMessage(peerId: string, message: RaftMessage) {
  const peer = this.peers.get(peerId);
  if (peer?.dataChannel?.readyState === 'open') {
    peer.dataChannel.send(JSON.stringify({
      type: 'raft-message',
      raftMessage: message
    }));
  }
}
```

#### 2. **Peer Discovery**

When WebRTC connects/disconnects peers, RAFT is notified:

```typescript
// On peer connected
raftManager.addPeer(peerId);

// On peer disconnected
raftManager.removePeer(peerId);
```

#### 3. **Leader-Driven Actions**

Only the leader can perform certain privileged operations:

```typescript
if (raftManager.isLeader()) {
  // Perform leader-only actions
  // e.g., coordinate file transfers, manage state, etc.
}
```

#### 4. **Fault Tolerance**

If the leader disconnects:
```
1. Followers detect missing heartbeats
   ↓
2. Election timeout expires
   ↓
3. New election begins
   ↓
4. New leader elected
   ↓
5. System continues operating
```

---

## Key Flows

### Flow 1: Initial Room Creation (Single Peer)

```
┌──────────────────────────────────────────────┐
│ 1. User creates room                         │
│    - Generate unique room ID                 │
│    - Connect to Centrifugo signaling server  │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. RaftManager initialized                   │
│    - State: Follower                         │
│    - Peers: 0                                │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Election timeout expires                  │
│    - No peers present                        │
│    - Become Candidate                        │
│    - Vote for self                           │
│    - Check majority: 1/1 ✓                   │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Become Leader                             │
│    - State: Leader                           │
│    - Start heartbeat timer                   │
│    - Ready for new peers                     │
└──────────────────────────────────────────────┘
```

### Flow 2: Peer Joining Room

```
┌──────────────────────────────────────────────┐
│ 1. New peer joins room                       │
│    - Connect to Centrifugo                   │
│    - Send 'join' message to room             │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. Existing peers receive 'join'             │
│    - Create RTCPeerConnection                │
│    - Create offer                            │
│    - Send offer via signaling                │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. New peer receives offer                   │
│    - Create RTCPeerConnection                │
│    - Set remote description                  │
│    - Create answer                           │
│    - Send answer via signaling               │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Exchange ICE candidates                   │
│    - Both peers send candidates              │
│    - P2P connection established              │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 5. Data channel opened                       │
│    - RaftManager.addPeer(peerId)             │
│    - New peer state: Follower                │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 6. Leader sends heartbeat                    │
│    - New peer receives heartbeat             │
│    - Acknowledges leader                     │
│    - Resets election timeout                 │
└──────────────────────────────────────────────┘
```

### Flow 3: Leader Failure & Re-election

```
┌──────────────────────────────────────────────┐
│ 1. Leader disconnects/fails                  │
│    - WebRTC connection closed                │
│    - Followers stop receiving heartbeats     │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. RaftManager.removePeer(leaderId)          │
│    - Detect leader is disconnected           │
│    - Immediately trigger election            │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. First peer's election timeout expires     │
│    - Become Candidate                        │
│    - Increment term                          │
│    - Request votes from all peers            │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Other peers receive vote-request          │
│    - Grant vote (haven't voted this term)    │
│    - Send vote-response back                 │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 5. Candidate receives majority votes         │
│    - Become new Leader                       │
│    - Start sending heartbeats                │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 6. Other peers receive heartbeat             │
│    - Recognize new leader                    │
│    - Become/remain Followers                 │
│    - System stabilized ✓                     │
└──────────────────────────────────────────────┘
```

### Flow 4: Sending a Message

```
┌──────────────────────────────────────────────┐
│ 1. User sends message                        │
│    - Input text in chat                      │
│    - Click send                              │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. WebRTCManager.broadcastMessage()          │
│    - Iterate all connected peers             │
│    - For each peer with open data channel    │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Send via data channel                     │
│    dataChannel.send(JSON.stringify({         │
│      type: 'message',                        │
│      message: 'Hello!'                       │
│    }))                                       │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Remote peer receives message              │
│    - Parse JSON                              │
│    - Trigger onMessageCallback               │
│    - Display in chat UI                      │
└──────────────────────────────────────────────┘
```

### Flow 5: File Transfer

```
┌──────────────────────────────────────────────┐
│ 1. User selects file to send                 │
│    - Choose file via file input              │
│    - Select target peer                      │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. Send file metadata                        │
│    dataChannel.send(JSON.stringify({         │
│      type: 'file-metadata',                  │
│      fileName: 'photo.jpg',                  │
│      fileSize: 524288,                       │
│      fileType: 'image/jpeg'                  │
│    }))                                       │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Receiver stores metadata                  │
│    - Create pendingFileData entry            │
│    - Wait for binary data                    │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Send file data                            │
│    file.arrayBuffer().then(buffer => {       │
│      dataChannel.send(buffer);               │
│    })                                        │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 5. Receiver reconstructs file                │
│    - Receive ArrayBuffer                     │
│    - Create Blob from buffer + metadata      │
│    - Trigger onFileCallback                  │
│    - Display file/download link in UI        │
└──────────────────────────────────────────────┘
```

---

## API Reference

### WebRTCManager

#### Constructor
```typescript
new WebRTCManager(localId: string)
```

#### Methods

**Connection Management:**
```typescript
// Connect to signaling server and join room
connectToCentrifugo(url: string, roomId: string, token?: string): Promise<void>

// Disconnect from all peers and signaling
disconnect(): void

// Remove specific peer connection
removePeer(peerId: string): void
```

**Media Management:**
```typescript
// Enable/disable video and audio
enableVideo(enable: boolean): Promise<void>
```

**Messaging:**
```typescript
// Send text message to specific peer
sendMessage(peerId: string, message: string): void

// Send message to all connected peers
broadcastMessage(message: string): void

// Send file to specific peer
sendFile(peerId: string, file: File): Promise<void>

// Send RAFT message to specific peer
sendRaftMessage(peerId: string, message: RaftMessage): void
```

**Event Callbacks:**
```typescript
setOnMessage(callback: (peerId: string, message: string) => void): void
setOnFile(callback: (peerId: string, file: Blob, fileName: string, fileType: string) => void): void
setOnPeerConnected(callback: (peerId: string) => void): void
setOnPeerDisconnected(callback: (peerId: string) => void): void
setOnStream(callback: (peerId: string, stream: MediaStream) => void): void
setOnRaftMessage(callback: (peerId: string, message: RaftMessage) => void): void
```

---

### RaftManager

#### Constructor
```typescript
new RaftManager(nodeId: string)
```

#### Methods

**Peer Management:**
```typescript
// Add new peer to cluster
addPeer(peerId: string): void

// Remove peer from cluster
removePeer(peerId: string): void
```

**Message Handling:**
```typescript
// Process incoming RAFT message
handleMessage(message: RaftMessage): void
```

**State Queries:**
```typescript
// Get current node state
getState(): NodeState  // 'follower' | 'candidate' | 'leader'

// Get current leader ID
getLeaderId(): string | null

// Check if this node is the leader
isLeader(): boolean
```

**Event Callbacks:**
```typescript
// Callback when RAFT message needs to be sent
setOnSendMessage(callback: (peerId: string, message: RaftMessage) => void): void

// Callback when state changes
setOnStateChange(callback: (state: NodeState, leaderId: string | null) => void): void
```

**Cleanup:**
```typescript
// Stop all timers and cleanup
cleanup(): void
```

---

## Configuration

### Timing Parameters

You can adjust these constants in `src/utils/raft.ts`:

```typescript
// Election timeout range (randomized to prevent split votes)
private readonly ELECTION_TIMEOUT_MIN = 3000;  // 3 seconds
private readonly ELECTION_TIMEOUT_MAX = 5000;  // 5 seconds

// Heartbeat interval (must be < election timeout min)
private readonly HEARTBEAT_INTERVAL = 1500;    // 1.5 seconds
```

**Guidelines:**
- `HEARTBEAT_INTERVAL` should be significantly less than `ELECTION_TIMEOUT_MIN`
- Longer timeouts = more stable but slower failover
- Shorter timeouts = faster failover but more elections
- Random range prevents simultaneous elections

### WebRTC Configuration

ICE servers are configured in `src/utils/webrtc.ts`:

```typescript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
```

For production, consider adding TURN servers for NAT traversal.

---

## Troubleshooting

### Common Issues

#### 1. **Peer stays in Candidate state**
- **Cause**: Not receiving votes from majority
- **Check**: Are peers actually connected via WebRTC?
- **Check**: Are data channels open?
- **Fix**: Ensure `addPeer()` is called after data channel opens

#### 2. **Multiple leaders elected**
- **Cause**: Network partition or term mismatch
- **Check**: Are heartbeats being sent/received?
- **Fix**: Ensure term numbers are synchronized

#### 3. **Files not receiving**
- **Cause**: Data channel buffer overflow or metadata mismatch
- **Check**: File size and data channel buffer
- **Fix**: Implement chunking for large files

#### 4. **Frequent elections**
- **Cause**: Heartbeats not reaching followers
- **Check**: Network latency and heartbeat interval
- **Fix**: Increase election timeout or decrease heartbeat interval

---

## Best Practices

1. **Always cleanup on unmount**
   ```typescript
   useEffect(() => {
     return () => {
       webrtcManager.disconnect();
       raftManager.cleanup();
     };
   }, []);
   ```

2. **Check leader before coordinated actions**
   ```typescript
   if (raftManager.isLeader()) {
     // Only leader performs this action
   }
   ```

3. **Handle state transitions**
   ```typescript
   raftManager.setOnStateChange((state, leaderId) => {
     console.log(`State changed to ${state}, leader: ${leaderId}`);
     // Update UI or trigger actions based on new state
   });
   ```

4. **Graceful degradation**
   - System should work with 1 peer (auto-leader)
   - Handle network disconnections gracefully
   - Retry mechanisms for failed connections

---

## Future Enhancements

Potential improvements to consider:

1. **RAFT Log Replication**
   - Implement append-entries for state machine replication
   - Ensure all peers maintain consistent state

2. **Persistent State**
   - Store term and voted-for in localStorage
   - Survive page refreshes

3. **Optimistic File Transfer**
   - Chunk large files
   - Progress callbacks
   - Resumable transfers

4. **Enhanced Security**
   - Encrypt data channel messages
   - Authenticate RAFT messages
   - Verify peer identities

5. **Performance Monitoring**
   - Track election frequency
   - Monitor heartbeat latency
   - Log state transitions

---

## License & Credits

This implementation is based on the RAFT consensus algorithm as described in the paper:
"In Search of an Understandable Consensus Algorithm" by Diego Ongaro and John Ousterhout.

WebRTC implementation follows standard WebRTC API specifications.
