---
sidebar_position: 6
title: WebRTC and RAFT Consensus-Algorithm
description: WebRTC and RAFT Consensus-Algorithm
---

# Triển khai WebRTC

## Tổng quan
WebRTC cho phép kết nối P2P để truyền audio/video/data giữa trình duyệt sau bước signaling ban đầu.

## Thành phần
- WebRTCManager (`src/utils/webrtc.ts`): Quản lý vòng đời kết nối peer, signaling Centrifugo, media streams, và data channel.

## Luồng kết nối
```
1. Tạo/Join room
2. Kết nối Centrifugo
3. Subscribe vào channel của room
4. Announce presence
5. Nhận danh sách peers/peer mới
6. Với mỗi peer: tạo RTCPeerConnection, tạo offer (nếu initiator), trao đổi SDP, trao đổi ICE
7. Kết nối P2P sẵn sàng ✓
```

## Signaling Messages
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

## Media Streams
- Local/Remote streams; bật/tắt video/audio theo nhu cầu.
```typescript
await webrtcManager.enableVideo(true);
await webrtcManager.enableVideo(false);
```

## Data Channels
- Legacy text message: `{ type: 'message', content }`
- File transfer: `{ type: 'file-meta', ... }` + ArrayBuffer
- RAFT messages: `{ type: 'raft', message }`
- Client → Leader chat: `{ type: 'client-message', message }`

## Truyền RAFT qua data channel
```typescript
// src/utils/webrtc.ts
sendRaftMessage(peerId: string, message: RaftMessage) {
  const peer = this.peers.get(peerId);
  if (peer?.dataChannel?.readyState === 'open') {
    peer.dataChannel.send(JSON.stringify({ type: 'raft', message }));
  }
}
```

## Thuật toán RAFT

### Trạng thái node
```
Follower → Candidate → Leader
```
- Follower: chờ AppendEntries/heartbeat; hết timeout thì thành Candidate.
- Candidate: tăng `term`, tự bỏ phiếu, gửi `vote-request`; nhận đa số thì thành Leader.
- Leader: gửi AppendEntries (rỗng hoặc kèm entries) định kỳ; đảm bảo chỉ 1 leader/term.

### RaftManager (`src/utils/raft.ts`)
Thuộc tính chính (rút gọn): `nodeId`, `state`, `currentTerm`, `votedFor`, `leaderId`, `peers`, cùng các hằng thời gian.

### Kiểu message
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

### Bầu cử và đa số
```typescript
const majorityNeeded = Math.floor((peers.size + 1) / 2) + 1;
```
Ví dụ: 1 node → 1; 2 nodes → 2; 3 nodes → 2; 5 nodes → 3.

### Heartbeat (AppendEntries rỗng)
- Leader gửi AppendEntries rỗng (kèm `leaderCommit`) theo `HEARTBEAT_INTERVAL`.
- Follower reset election timeout khi nhận gói hợp lệ; nếu không, sẽ mở bầu cử mới.

## Tích hợp WebRTC + RAFT

### Tầng vận chuyển
RAFT chạy trên data channel WebRTC; chỉ thêm peer RAFT sau khi channel mở.

### Khả năng chịu lỗi
Leader rời đi → followers ngừng nhận AppendEntries → hết timeout → bầu leader mới → hệ thống tiếp tục.

## API Tham chiếu

### WebRTCManager
```typescript
new WebRTCManager(localId: string)
// Kết nối signaling và join room
connectToCentrifugo(url: string, roomId: string, token?: string): Promise<void>
// Ngắt kết nối
disconnect(): void
// Xoá peer
removePeer(peerId: string): void
// Bật/tắt media
enableVideo(enable: boolean): Promise<void>
// Gửi message/raft/file
sendMessage(peerId: string, message: string): void
broadcastMessage(message: string): void
sendFile(peerId: string, file: File): Promise<void>
sendRaftMessage(peerId: string, message: RaftMessage): void
// Đăng ký callback
setOnMessage(cb)
setOnFile(cb)
setOnPeerConnected(cb)
setOnPeerDisconnected(cb)
setOnStream(cb)
setOnRaftMessage(cb)
```

### RaftManager
```typescript
new RaftManager(nodeId: string)
// Quản lý peer
addPeer(peerId: string): void
removePeer(peerId: string): void
// Xử lý message RAFT
handleMessage(message: RaftMessage): void
// Truy vấn trạng thái
getState(): NodeState
getLeaderId(): string | null
isLeader(): boolean
// Callback
setOnSendMessage(cb): void
setOnStateChange(cb): void
// Dọn dẹp
cleanup(): void
```

## Thực hành tốt
- Dọn dẹp khi unmount: đóng WebRTC và RAFT timers.
- Chỉ leader thực hiện hành động điều phối.
- Lắng nghe và xử lý chuyển trạng thái để cập nhật UI.

## Khắc phục sự cố
- Candidate không được vote: kiểm tra kết nối WebRTC/data channel.
- Nhiều leader: chỉ thêm RAFT peer sau data channel open; step-down khi nhận AppendEntries hợp lệ từ leader khác.
- Bầu cử liên tục: kiểm tra latency và thông số thời gian; tăng election timeout hoặc giảm heartbeat interval.
- Không nhận file: xem buffer data channel; cân nhắc chia nhỏ dữ liệu.

## Nhân bản log và phục hồi dữ liệu

### Cấu trúc entry
```typescript
interface LogEntry {
  term: number;
  index: number;
  data: any;
  timestamp: number;
}
```

### Cách hoạt động
1. Leader `appendEntry(data)` → tạo entry và replicate
2. Follower kiểm tra `prevLogIndex/prevLogTerm`, append và phản hồi
3. Leader commit khi đủ đa số → cập nhật `commitIndex` → thông báo followers
4. Khi thay đổi leader: leader mới đồng bộ followers; entries xung đột được ghi đè theo leader

### Ví dụ sử dụng
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

### Cam kết phục hồi
- Bền vững: entry đã commit tồn tại qua thay đổi leader
- Nhất quán: tất cả nodes cuối cùng có cùng log theo cùng thứ tự
- Tự động đồng bộ: leader mới chủ động đồng bộ lại followers

## Nâng cấp tương lai
- Lưu trữ bền vững (IndexedDB/localStorage), snapshot/compaction
- Bảo mật: mã hoá message data channel, xác thực RAFT
- Truyền file tối ưu: chunking, tiến trình, resume
- Theo dõi hiệu năng: tần suất bầu cử, latency heartbeat, log state transitions

## Giấy phép & ghi công
Dựa trên RAFT (Diego Ongaro, John Ousterhout). WebRTC theo chuẩn API của trình duyệt.

## Luồng Dữ Liệu P2P WebRTC + RAFT (Tiếng Việt)

## Mục tiêu
- Mô tả tổng quan cách peers tham gia phòng, bầu leader, gửi/đồng bộ tin nhắn qua replicated log RAFT.
- Làm rõ cơ chế flush 20 messages (leader-only) tới API và xoá đồng bộ.

## Kiến trúc tổng quan
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

## Tham gia phòng (Join)
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

## Bầu cử Leader (tóm tắt)
- Follower → Candidate khi timeout election.
- Gửi vote-request; nhận đa số → trở thành Leader.
- Nếu nhận AppendEntries hợp lệ từ leader khác (term ≥ current) → hạ xuống Follower.
Tham chiếu: `src/utils/raft.ts:252-268`, `src/utils/raft.ts:235-250`, `src/utils/raft.ts:405-410`.

## Gửi tin nhắn (Leader)
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

## Gửi tin nhắn (Follower)
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

## Đồng bộ khi peer mới vào
- Leader đẩy log ngay khi thấy peer mới (sau data channel open).
- Heartbeat là AppendEntries rỗng, mang `leaderCommit` giúp followers apply commit.
Tham chiếu: `src/utils/raft.ts:83-89`, `src/utils/raft.ts:297-303`.

## Flush 20 messages (leader-only)
- Khi số message ≥ 20, leader gọi API với 20 message đầu, rồi append entry xoá.
Flow:
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

## Chống split-brain
- Chỉ `raft.addPeer()` sau khi data channel mở.
- Hạ về Follower khi nhận AppendEntries hợp lệ từ leader khác.
Tham chiếu: `src/pages/Index.tsx:120-127`, `src/utils/raft.ts:405-410`.

## Lỗi thường gặp & kiểm tra
- Tin nhắn đầu không sync: khởi tạo `commitIndex/lastApplied = -1` để entry index 0 được apply.
  - `src/utils/raft.ts:43-49`.
- Không có leader: cập nhật `leaderId` vào UI khi nhận AppendEntries/heartbeat.
  - `src/utils/raft.ts:136-143`, `src/utils/raft.ts:405-410`, `src/pages/Index.tsx:117-126`.
- Hai leader cùng lúc: hạ leader/candidate về follower khi nhận AppendEntries.
  - `src/utils/raft.ts:405-410`.

## Ghi chú cấu hình
- Thời gian RAFT hiện tại:
```
ELECTION_TIMEOUT_MIN = 1000ms
ELECTION_TIMEOUT_MAX = 30000ms
HEARTBEAT_INTERVAL   = 500ms
```
Tham chiếu: `src/utils/raft.ts:57-59`.