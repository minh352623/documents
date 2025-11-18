---
sidebar_position: 6
title: WebRTC and RAFT Consensus-Algorithm
description: WebRTC and RAFT Consensus-Algorithm
---

# P2P WebRTC + RAFT — Tài liệu Kỹ thuật (Tiếng Việt)

## Mục lục
1. Kiến trúc tổng quan
2. Triển khai WebRTC
3. Thuật toán RAFT
4. Tích hợp WebRTC + RAFT
5. Luồng dữ liệu chính
6. API tham chiếu
7. Cấu hình
8. Khắc phục sự cố
9. Thực hành tốt
10. Nhân bản log & phục hồi dữ liệu
11. Nâng cấp tương lai
12. Giấy phép & ghi công

---

## 1. Kiến trúc tổng quan
```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Peer A    │◄───────►│   Peer B    │◄───────►│   Peer C    │
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

## 2. Triển khai WebRTC

### 2.1 Tổng quan
WebRTC cho phép kết nối P2P để truyền audio/video/data giữa trình duyệt sau bước signaling ban đầu.

### 2.2 Thành phần
- WebRTCManager (`src/utils/webrtc.ts`): Quản lý vòng đời kết nối peer, signaling Centrifugo, media streams, và data channel.

### 2.3 Luồng kết nối
```
1. Tạo/Join room
2. Kết nối Centrifugo
3. Subscribe vào channel của room
4. Announce presence
5. Nhận danh sách peers/peer mới
6. Với mỗi peer: tạo RTCPeerConnection, tạo offer (nếu initiator), trao đổi SDP, trao đổi ICE
7. Kết nối P2P sẵn sàng ✓
```

### 2.4 Signaling Messages
Chỉ phục vụ SDP/ICE và hiện diện peer (RAFT không đi qua signaling):
```typescript
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'peer-joined' | 'peer-list';
  from: string;
  to?: string;
  data?: any;
  peers?: string[];
}
```

### 2.5 Media Streams
- Local/Remote streams; bật/tắt video/audio theo nhu cầu.
```typescript
await webrtcManager.enableVideo(true);
await webrtcManager.enableVideo(false);
```

### 2.6 Data Channels
- Legacy text message: `{ type: 'message', content }`
- File transfer: `{ type: 'file-meta', ... }` + ArrayBuffer
- RAFT messages: `{ type: 'raft', message }`
- Client → Leader chat: `{ type: 'client-message', message }`

### 2.7 Truyền RAFT qua data channel
```typescript
// src/utils/webrtc.ts
sendRaftMessage(peerId: string, message: RaftMessage) {
  const peer = this.peers.get(peerId);
  if (peer?.dataChannel?.readyState === 'open') {
    peer.dataChannel.send(JSON.stringify({ type: 'raft', message }));
  }
}
```

---

## 3. Thuật toán RAFT

### 3.1 Trạng thái node
```
Follower → Candidate → Leader
```
- Follower: chờ AppendEntries; hết timeout thì thành Candidate.
- Candidate: tăng `term`, tự bỏ phiếu, gửi `vote-request`; nhận đa số thì thành Leader.
- Leader: gửi AppendEntries (rỗng hoặc kèm entries) định kỳ; đảm bảo chỉ 1 leader/term.

### 3.2 RaftManager (`src/utils/raft.ts`)
Thuộc tính chính (rút gọn): `nodeId`, `state`, `currentTerm`, `votedFor`, `leaderId`, `peers`, cùng các hằng thời gian.

### 3.3 Kiểu message
```typescript
interface RaftMessage {
  type: 'heartbeat' | 'vote-request' | 'vote-response' | 'append-entries';
  term: number;
  from: string;
  to?: string;
  candidateId?: string;
  voteGranted?: boolean;
  leaderId?: string;
}
```

### 3.4 Bầu cử và đa số
```typescript
const majorityNeeded = Math.floor((peers.size + 1) / 2) + 1;
```
Ví dụ: 1 node → 1; 2 nodes → 2; 3 nodes → 2; 5 nodes → 3.

### 3.5 Heartbeat (AppendEntries rỗng)
- Leader gửi AppendEntries rỗng (kèm `leaderCommit`) theo `HEARTBEAT_INTERVAL`.
- Follower reset election timeout khi nhận gói hợp lệ; nếu không, sẽ mở bầu cử mới.

---

## 4. Tích hợp WebRTC + RAFT

### 4.1 Tầng vận chuyển
RAFT chạy trên data channel WebRTC; chỉ thêm peer RAFT sau khi channel mở.

### 4.2 Khả năng chịu lỗi
Leader rời đi → followers ngừng nhận AppendEntries → hết timeout → bầu leader mới → hệ thống tiếp tục.

---

## 5. Luồng dữ liệu chính

### 5.1 Tham gia phòng (Join)
- Signaling (SDP/ICE) qua Centrifugo để thiết lập WebRTC.
- Chỉ thêm peer vào RAFT sau khi data channel mở (giảm split-brain):
  - WebRTC `ondatachannel.open` → thêm peer vào RAFT.

Flow:
```
┌──────────────────────────────────────────────┐
│ 1. Join room + subscribe channel             │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. Exchange offer/answer + ICE               │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Data channel opened                       │
│    - raft.addPeer(peerId)                    │
│    - Peer vào trạng thái Follower            │
└──────────────────────────────────────────────┘
```
Tham chiếu: `src/utils/webrtc.ts:403-405`, `src/pages/Index.tsx:120-127`.

### 5.2 Bầu cử Leader (tóm tắt)
- Follower → Candidate khi timeout election.
- Gửi vote-request; nhận đa số → trở thành Leader.
- Nếu nhận AppendEntries hợp lệ từ leader khác (term ≥ current) → hạ xuống Follower.
Tham chiếu: `src/utils/raft.ts:252-268`, `src/utils/raft.ts:235-250`, `src/utils/raft.ts:405-410`.

### 5.3 Gửi tin nhắn (Leader)
```
┌──────────────────────────────────────────────┐
│ 1. User (leader) tạo message                 │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. Leader appendEntry(message)               │
│    - Log[n] = message                        │
│    - syncLogs() → AppendEntries tới followers│
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Followers append + append-response success│
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Leader commit khi đủ đa số                │
│    - updateCommitIndex()                     │
│    - applyCommittedEntries()                 │
│    - syncLogs() propagate leaderCommit       │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 5. Followers apply commit                    │
│    - UI setOnLogEntry → hiển thị tin nhắn    │
└──────────────────────────────────────────────┘
```
Tham chiếu: `src/utils/raft.ts:346-366`, `src/utils/raft.ts:368-393`, `src/utils/raft.ts:463-470`, `src/utils/raft.ts:477-494`, `src/pages/Index.tsx:130-151`.

### 5.4 Gửi tin nhắn (Follower)
```
┌──────────────────────────────────────────────┐
│ 1. User (follower) tạo message               │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. Gửi client-message tới leader             │
│    dataChannel.send({type:'client-message'}) │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. Leader nhận client-message                │
│    - appendEntry(message)                    │
│    - Theo flow của Leader ở trên             │
└──────────────────────────────────────────────┘
```
Tham chiếu: `src/utils/webrtc.ts:471-481`, `src/pages/Index.tsx:103-113`, `src/pages/Index.tsx:240-286`.

### 5.5 Đồng bộ khi peer mới vào
- Leader đẩy log ngay khi thấy peer mới (sau data channel open).
- Heartbeat là AppendEntries rỗng, mang `leaderCommit` giúp followers apply commit.
Tham chiếu: `src/utils/raft.ts:83-89`, `src/utils/raft.ts:297-303`.

### 5.6 Flush 20 messages (leader-only)
- Khi số message ≥ 20, leader gọi API với 20 message đầu, rồi append entry xoá.
```
┌──────────────────────────────────────────────┐
│ 1. messages.length >= 20 (leader)            │
│    - flushIfNeeded(messages)                 │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 2. POST 20 message đầu tới API               │
│    - VITE_FLUSH_ENDPOINT                     │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 3. appendEntry({action:'delete-messages',ids})│
│    - replicate + commit                      │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────┐
│ 4. Tất cả peers filter xoá theo ids          │
└──────────────────────────────────────────────┘
```
Tham chiếu: `src/pages/Index.tsx:43-64`, `src/pages/Index.tsx:130-151`.

---

## 6. API tham chiếu

### 6.1 WebRTCManager
```typescript
new WebRTCManager(localId: string)
connectToCentrifugo(url: string, roomId: string, token?: string): Promise<void>
disconnect(): void
removePeer(peerId: string): void
enableVideo(enable: boolean): Promise<void>
sendMessage(peerId: string, message: string): void
broadcastMessage(message: string): void
sendFile(peerId: string, file: File): Promise<void>
sendRaftMessage(peerId: string, message: RaftMessage): void
setOnMessage(cb)
setOnFile(cb)
setOnPeerConnected(cb)
setOnPeerDisconnected(cb)
setOnStream(cb)
setOnRaftMessage(cb)
```

### 6.2 RaftManager
```typescript
new RaftManager(nodeId: string)
addPeer(peerId: string): void
removePeer(peerId: string): void
handleMessage(message: RaftMessage): void
getState(): NodeState
getLeaderId(): string | null
isLeader(): boolean
setOnSendMessage(cb): void
setOnStateChange(cb): void
cleanup(): void
```

---

## 7. Cấu hình
```
ELECTION_TIMEOUT_MIN = 1000ms
ELECTION_TIMEOUT_MAX = 30000ms
HEARTBEAT_INTERVAL   = 500ms
```
Tham chiếu: `src/utils/raft.ts:57-59`.

---

## 8. Khắc phục sự cố
- Candidate không được vote: kiểm tra kết nối WebRTC/data channel.
- Nhiều leader: chỉ thêm RAFT peer sau data channel open; step-down khi nhận AppendEntries hợp lệ từ leader khác.
- Bầu cử liên tục: kiểm tra latency và thông số thời gian; tăng election timeout hoặc giảm heartbeat interval.
- Không nhận file: xem buffer data channel; cân nhắc chia nhỏ dữ liệu.

---

## 9. Thực hành tốt
- Dọn dẹp khi unmount: đóng WebRTC và RAFT timers.
- Chỉ leader thực hiện hành động điều phối.
- Lắng nghe và xử lý chuyển trạng thái để cập nhật UI.

---

## 10. Nhân bản log & phục hồi dữ liệu

### 10.1 Cấu trúc entry
```typescript
interface LogEntry {
  term: number;
  index: number;
  data: any;
  timestamp: number;
}
```

### 10.2 Cách hoạt động
1. Leader `appendEntry(data)` → tạo entry và replicate
2. Follower kiểm tra `prevLogIndex/prevLogTerm`, append và phản hồi
3. Leader commit khi đủ đa số → cập nhật `commitIndex` → thông báo followers
4. Khi thay đổi leader: leader mới đồng bộ followers; entries xung đột được ghi đè theo leader

### 10.3 Ví dụ sử dụng
```typescript
raftManager.setOnLogEntry((entry) => {
  // apply vào state ứng dụng
});

if (raftManager.isLeader()) {
  raftManager.appendEntry({ type: 'message', content: 'Hello World', sender: peerId });
}

const log = raftManager.getLog();
const commitIndex = raftManager.getCommitIndex();
```

### 10.4 Cam kết phục hồi
- Bền vững: entry đã commit tồn tại qua thay đổi leader
- Nhất quán: tất cả nodes cuối cùng có cùng log theo cùng thứ tự
- Tự động đồng bộ: leader mới chủ động đồng bộ lại followers

---

## 11. Nâng cấp tương lai
- Lưu trữ bền vững (IndexedDB/localStorage), snapshot/compaction
- Bảo mật: mã hoá message data channel, xác thực RAFT
- Truyền file tối ưu: chunking, tiến trình, resume
- Theo dõi hiệu năng: tần suất bầu cử, latency heartbeat, log state transitions

---

## 12. Giấy phép & ghi công
Dựa trên RAFT (Diego Ongaro, John Ousterhout). WebRTC theo chuẩn API của trình duyệt.
- [Raft — Trang chủ](https://raft.github.io/)
- [WebRTC — Samples](https://webrtc.github.io/samples/)