# Redis Sentinel & Redis Cluster — Team Technical Reference

> **Author:** Tech Lead  
> **Audience:** Backend Dev Team  
> **Last updated:** April 2026  
> **Tags:** `redis`, `infrastructure`, `high-availability`, `scalability`

---

## 📌 Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Redis Sentinel](#2-redis-sentinel)
3. [Redis Cluster](#3-redis-cluster)
4. [So sánh trực tiếp](#4-so-sánh-trực-tiếp)
5. [Khi nào dùng cái nào?](#5-khi-nào-dùng-cái-nào)
6. [Sử dụng thực tế — Code Examples](#6-sử-dụng-thực-tế--code-examples)
7. [Những điểm cần lưu ý (Pitfalls)](#7-những-điểm-cần-lưu-ý-pitfalls)
8. [Checklist triển khai Production](#8-checklist-triển-khai-production)
9. [Tóm tắt quyết định](#9-tóm-tắt-quyết-định)

---

## 1. Tổng quan

Redis là single-threaded in-memory store. Chạy single node thì không có:
- **High Availability (HA):** Nếu node chết → service down.
- **Horizontal Scalability:** Một node bị giới hạn RAM và throughput.

Để giải quyết hai vấn đề này, Redis cung cấp hai giải pháp khác nhau:

| Vấn đề | Giải pháp |
|--------|-----------|
| High Availability (HA) — chịu lỗi tự động | **Redis Sentinel** |
| Horizontal Scaling — phân tán dữ liệu | **Redis Cluster** |

> **Quan trọng:** Sentinel và Cluster giải quyết **các bài toán khác nhau**. Cluster cũng có HA built-in, nhưng cách tiếp cận hoàn toàn khác.

---

## 2. Redis Sentinel

### 2.1 Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                     Redis Sentinel Setup                     │
│                                                             │
│   ┌──────────┐    replicate    ┌──────────┐                 │
│   │  Master  │ ──────────────► │ Replica1 │                 │
│   │ :6379    │                 │ :6380    │                 │
│   └──────────┘                 └──────────┘                 │
│        │           replicate   ┌──────────┐                 │
│        └─────────────────────► │ Replica2 │                 │
│                                │ :6381    │                 │
│                                └──────────┘                 │
│                                                             │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│   │ Sentinel 1 │  │ Sentinel 2 │  │ Sentinel 3 │           │
│   │ :26379     │  │ :26380     │  │ :26381     │           │
│   └────────────┘  └────────────┘  └────────────┘           │
│         │               │               │                   │
│         └───────────────┴───────────────┘                   │
│                    monitor + vote                            │
└─────────────────────────────────────────────────────────────┘
```

**Sentinel làm gì?**
- **Monitor:** Liên tục ping Master và các Replica để kiểm tra health.
- **Notify:** Thông báo cho admin/application khi có sự cố.
- **Automatic Failover:** Khi Master chết, Sentinel bầu chọn (quorum) một Replica lên làm Master mới.
- **Configuration Provider:** Client hỏi Sentinel "Master hiện tại ở đâu?" thay vì hardcode IP.

### 2.2 Cơ chế Failover

```
Step 1: Master unreachable → Sentinel đánh dấu SDOWN (Subjectively Down)
Step 2: Quorum (đa số Sentinel) đồng ý → ODOWN (Objectively Down)
Step 3: Sentinels bầu chọn Sentinel Leader
Step 4: Leader chọn Replica tốt nhất (dựa trên replication lag, priority, runid)
Step 5: Leader gửi SLAVEOF NO ONE cho Replica được chọn → thành Master
Step 6: Các Replica còn lại trỏ về Master mới
Step 7: Sentinel update config, broadcast địa chỉ Master mới
```

**Thời gian failover thực tế:** ~15–30 giây (configurable).

### 2.3 Ưu điểm

- ✅ **HA tự động** — không cần manual intervention khi Master chết.
- ✅ **Đơn giản** — dữ liệu không bị sharding, mọi key đều có trên cả cụm.
- ✅ **Compatible 100%** với mọi Redis command — không giới hạn multi-key ops.
- ✅ **Dễ setup và debug** hơn Cluster.
- ✅ **Client library** hỗ trợ rộng rãi.

### 2.4 Nhược điểm

- ❌ **Không scale write** — chỉ có 1 Master, mọi write dồn vào 1 node.
- ❌ **Giới hạn RAM** — toàn bộ dữ liệu phải fit trong RAM của 1 node.
- ❌ **Sentinel cũng cần HA** — cần ít nhất 3 Sentinel nodes để quorum hoạt động đúng.
- ❌ **Split-brain risk** nếu cấu hình quorum sai.

### 2.5 Cấu hình cơ bản

**sentinel.conf:**
```conf
# Theo dõi master tên "mymaster" ở IP:Port, quorum = 2
sentinel monitor mymaster 192.168.1.10 6379 2

# Master bị coi là down nếu không phản hồi trong 5s
sentinel down-after-milliseconds mymaster 5000

# Timeout cho quá trình failover
sentinel failover-timeout mymaster 60000

# Số replica sync song song sau failover
sentinel parallel-syncs mymaster 1

# Auth (nếu có)
sentinel auth-pass mymaster your_redis_password
```

---

## 3. Redis Cluster

### 3.1 Kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                       Redis Cluster                              │
│                   16384 hash slots total                         │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │  Shard 1         │  │  Shard 2         │  │  Shard 3       │ │
│  │  Slots: 0–5460   │  │  Slots: 5461–    │  │  Slots: 10923– │ │
│  │                  │  │  10922           │  │  16383         │ │
│  │  ┌────────────┐  │  │  ┌────────────┐  │  │ ┌───────────┐  │ │
│  │  │  Master A  │  │  │  │  Master B  │  │  │ │ Master C  │  │ │
│  │  │  :7000     │  │  │  │  :7002     │  │  │ │ :7004     │  │ │
│  │  └────────────┘  │  │  └────────────┘  │  │ └───────────┘  │ │
│  │        │         │  │        │         │  │       │         │ │
│  │  ┌────────────┐  │  │  ┌────────────┐  │  │ ┌───────────┐  │ │
│  │  │ Replica A  │  │  │  │ Replica B  │  │  │ │Replica C  │  │ │
│  │  │  :7001     │  │  │  │  :7003     │  │  │ │ :7005     │  │ │
│  │  └────────────┘  │  │  └────────────┘  │  │ └───────────┘  │ │
│  └──────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                  │
│  Client → CRC16(key) % 16384 → chọn đúng shard                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Hash Slot — Cơ chế phân tán dữ liệu

Redis Cluster chia data thành **16384 hash slots**. Mỗi key được map vào một slot:

```
slot = CRC16(key) % 16384
```

Client-aware library tính toán slot, connect thẳng tới đúng node. Nếu connect nhầm node, Redis trả về `MOVED` redirect.

**Hash Tags — nhóm keys vào cùng 1 slot:**
```
# Các key này cùng slot vì hash tag là {user:1001}
{user:1001}:profile
{user:1001}:session
{user:1001}:cart

# KHÔNG thể dùng MGET trên keys thuộc different slots
MGET user:1001 user:1002  # ❌ Error nếu 2 key ở 2 shard khác nhau
MGET {user:1001}:profile {user:1001}:session  # ✅ OK, cùng slot
```

### 3.3 Ưu điểm

- ✅ **Scale horizontally** — thêm node là tăng capacity cả write lẫn storage.
- ✅ **HA built-in** — mỗi shard có replica, failover tự động không cần Sentinel.
- ✅ **Không giới hạn RAM** — data phân tán trên nhiều node.
- ✅ **High throughput** — write được phân tán đều trên các Master.

### 3.4 Nhược điểm

- ❌ **Multi-key operations bị giới hạn** — MGET, MSET, transactions chỉ work trong 1 slot.
- ❌ **Lua scripts phức tạp hơn** — script chỉ run trên 1 node, keys phải cùng slot.
- ❌ **Pub/Sub có giới hạn** — message chỉ broadcast trong 1 node, không cross-node.
- ❌ **Database SELECT không được hỗ trợ** — chỉ có db0.
- ❌ **Phức tạp hơn** để setup, monitor, và debug.
- ❌ **Resharding (rebalancing)** cần thời gian và có thể impact performance.

### 3.5 Cấu hình cơ bản

**redis.conf (cluster node):**
```conf
port 7000
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 5000
appendonly yes
```

**Khởi tạo cluster (6 nodes: 3 master + 3 replica):**
```bash
redis-cli --cluster create \
  192.168.1.10:7000 \
  192.168.1.11:7001 \
  192.168.1.12:7002 \
  192.168.1.13:7003 \
  192.168.1.14:7004 \
  192.168.1.15:7005 \
  --cluster-replicas 1
```

---

## 4. So sánh trực tiếp

| Tiêu chí | Redis Sentinel | Redis Cluster |
|----------|---------------|---------------|
| **Mục tiêu chính** | High Availability | Horizontal Scalability + HA |
| **Số master** | 1 | N (thường 3+) |
| **Scale write** | ❌ Không | ✅ Có |
| **Scale storage (RAM)** | ❌ Không | ✅ Có |
| **Multi-key ops (MGET, MSET)** | ✅ Full support | ⚠️ Chỉ cùng slot |
| **Transactions (MULTI/EXEC)** | ✅ Full support | ⚠️ Chỉ cùng slot |
| **Lua scripting** | ✅ Dễ | ⚠️ Cần hash tags |
| **Pub/Sub** | ✅ Full | ⚠️ Giới hạn |
| **SELECT database** | ✅ Multi-DB | ❌ Chỉ db0 |
| **Failover tự động** | ✅ Có (~15–30s) | ✅ Có (~10–20s) |
| **Min nodes** | 3 Sentinel + 1 Master + 1 Replica | 6 nodes (3M+3R) |
| **Client complexity** | Thấp | Trung bình |
| **Ops complexity** | Thấp | Cao |
| **Phù hợp data size** | < RAM của 1 node | Bất kỳ |
| **Phù hợp write throughput** | Vừa phải | Cao |

---

## 5. Khi nào dùng cái nào?

### Dùng Redis Sentinel khi:

```
✅ Dataset fit vừa RAM 1 node (vd: < 50GB)
✅ Cần HA nhưng không cần scale horizontally
✅ App dùng nhiều multi-key operations, Lua scripts, Pub/Sub
✅ Team chưa có nhiều kinh nghiệm Redis Ops
✅ Project đang ở early stage, cần đơn giản hoá infra
✅ Fintech: cần transactions mạnh, không muốn phức tạp hóa
```

### Dùng Redis Cluster khi:

```
✅ Dataset vượt RAM của 1 node
✅ Write throughput quá cao cho 1 master (> 100k ops/s)
✅ Cần scale mà không down service (add node online)
✅ Large-scale cache: product catalog, feed, session store dạng key-value đơn giản
✅ Mỗi shard key độc lập, ít cần cross-key operations
```

### Decision Tree

```
Bạn có cần lưu > RAM của 1 node HOẶC write throughput rất cao không?
│
├── KHÔNG → Dùng Redis Sentinel
│           (đơn giản, full-featured, dễ vận hành)
│
└── CÓ → App có dùng nhiều multi-key ops / Lua / SELECT db không?
          │
          ├── CÓ NHIỀU → Xem xét kỹ Cluster, hoặc refactor key design
          │              Dùng hash tags để nhóm keys liên quan
          │
          └── KHÔNG → Dùng Redis Cluster
```

---

## 6. Sử dụng thực tế — Code Examples

### 6.1 Golang — Redis Sentinel (go-redis)

```go
package redis

import (
    "context"
    "time"

    "github.com/redis/go-redis/v9"
)

func NewSentinelClient() *redis.Client {
    return redis.NewFailoverClient(&redis.FailoverOptions{
        // Sentinel addresses (không phải Master address!)
        SentinelAddrs: []string{
            "sentinel-1:26379",
            "sentinel-2:26380",
            "sentinel-3:26381",
        },
        MasterName: "mymaster",
        Password:   "your_redis_password",

        // Connection pool
        PoolSize:     20,
        MinIdleConns: 5,

        // Timeouts
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
    })
}

// Sử dụng bình thường — Sentinel transparent với app code
func CacheSet(ctx context.Context, rdb *redis.Client, key, value string, ttl time.Duration) error {
    return rdb.Set(ctx, key, value, ttl).Err()
}

func CacheGet(ctx context.Context, rdb *redis.Client, key string) (string, error) {
    val, err := rdb.Get(ctx, key).Result()
    if err == redis.Nil {
        return "", nil // cache miss
    }
    return val, err
}
```

### 6.2 Golang — Redis Cluster (go-redis)

```go
package redis

import (
    "context"
    "time"

    "github.com/redis/go-redis/v9"
)

func NewClusterClient() *redis.ClusterClient {
    return redis.NewClusterClient(&redis.ClusterOptions{
        // Chỉ cần 1 vài node — client tự discover toàn bộ cluster
        Addrs: []string{
            "redis-node-1:7000",
            "redis-node-2:7001",
            "redis-node-3:7002",
        },
        Password: "your_redis_password",

        PoolSize:     20,
        MinIdleConns: 5,

        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,

        // Đọc từ replica để giảm tải master (eventual consistency)
        RouteRandomly: true,
    })
}

// ⚠️ Multi-key ops: phải dùng hash tags
func CacheMGetSameSlot(ctx context.Context, rdb *redis.ClusterClient, userID string) error {
    // Đúng: cùng hash tag {user:1001} → cùng slot
    profileKey := "{user:" + userID + "}:profile"
    sessionKey := "{user:" + userID + "}:session"

    results, err := rdb.MGet(ctx, profileKey, sessionKey).Result()
    _ = results
    return err
}

// Pipeline trong Cluster — phải cùng slot
func PipelineSameSlot(ctx context.Context, rdb *redis.ClusterClient, userID string) error {
    pipe := rdb.Pipeline()
    profileKey := "{user:" + userID + "}:profile"
    sessionKey  := "{user:" + userID + "}:session"

    pipe.Set(ctx, profileKey, "data1", time.Hour)
    pipe.Set(ctx, sessionKey, "data2", time.Hour)

    _, err := pipe.Exec(ctx)
    return err
}

// ForEachShard — chạy lệnh trên tất cả shard (vd: FLUSHDB, DBSIZE)
func GetTotalKeyCount(ctx context.Context, rdb *redis.ClusterClient) (int64, error) {
    var total int64
    err := rdb.ForEachShard(ctx, func(ctx context.Context, shard *redis.Client) error {
        count, err := shard.DBSize(ctx).Result()
        total += count
        return err
    })
    return total, err
}
```

### 6.3 Pattern thực tế — Cache-Aside với Sentinel

```go
// Đây là pattern thường dùng nhất trong Fintech service
type UserService struct {
    db    *sql.DB
    cache *redis.Client
}

func (s *UserService) GetUser(ctx context.Context, userID string) (*User, error) {
    cacheKey := "user:" + userID

    // 1. Try cache
    cached, err := s.cache.Get(ctx, cacheKey).Result()
    if err == nil {
        var user User
        if err := json.Unmarshal([]byte(cached), &user); err == nil {
            return &user, nil
        }
    }

    // 2. Cache miss → query DB
    user, err := s.fetchFromDB(ctx, userID)
    if err != nil {
        return nil, err
    }

    // 3. Write to cache
    data, _ := json.Marshal(user)
    // TTL jitter để tránh cache stampede
    ttl := 10*time.Minute + time.Duration(rand.Intn(60))*time.Second
    s.cache.Set(ctx, cacheKey, data, ttl)

    return user, nil
}
```

### 6.4 Pattern thực tế — Distributed Lock với Sentinel

```go
// Dùng Redisson-style lock với Sentinel
func AcquireLock(ctx context.Context, rdb *redis.Client, lockKey string, ttl time.Duration) (bool, error) {
    lockValue := uuid.New().String()
    ok, err := rdb.SetNX(ctx, "lock:"+lockKey, lockValue, ttl).Result()
    return ok, err
}

func ReleaseLock(ctx context.Context, rdb *redis.Client, lockKey, lockValue string) error {
    // Lua script để atomic check-and-delete
    script := redis.NewScript(`
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
    `)
    return script.Run(ctx, rdb, []string{"lock:" + lockKey}, lockValue).Err()
}
```

---

## 7. Những điểm cần lưu ý (Pitfalls)

### 7.1 Redis Sentinel — Pitfalls

#### ⚠️ Cấu hình quorum sai
```
Quorum là số Sentinel tối thiểu đồng ý để declare ODOWN.
Với 3 Sentinels → quorum = 2 (majority)
Với 2 Sentinels → quorum = 2 → nếu 1 Sentinel chết, không failover được!

→ LUÔN deploy 3 Sentinel nodes trở lên (số lẻ).
```

#### ⚠️ Client reconnect sau failover
```
Sau failover, client đang hold connection tới Master cũ (đã chết).
→ Cần set MaxRetries và retry logic phù hợp.
→ go-redis tự xử lý khi dùng FailoverClient đúng cách.
→ KHÔNG dùng redis.NewClient() với hardcode IP của Master!
```

#### ⚠️ min-slaves-to-write
```conf
# Nếu không có replica nào kết nối, Master từ chối write
# Giúp tránh split-brain data loss
min-replicas-to-write 1
min-replicas-max-lag 10
```

#### ⚠️ Data loss window trong failover
```
Khi Master chết đột ngột, một số write chưa kịp replicate sang Replica.
→ Replica được promote nhưng thiếu data.
→ Đây là trade-off của async replication.
→ Với Fintech: cân nhắc dùng WAIT command cho critical writes.
```

```go
// WAIT buộc đợi ít nhất 1 replica xác nhận đã replicate
// numReplicas=1, timeout=500ms
err := rdb.Wait(ctx, 1, 500*time.Millisecond).Err()
```

### 7.2 Redis Cluster — Pitfalls

#### ⚠️ Cross-slot operations
```go
// ❌ Lỗi nếu 2 keys ở 2 slot khác nhau
rdb.MGet(ctx, "user:1001", "user:1002")

// ✅ Dùng hash tags
rdb.MGet(ctx, "{user:1001}:data", "{user:1001}:meta")

// ✅ Hoặc dùng pipeline per-key (nhiều round trips hơn)
pipe := rdb.Pipeline()
pipe.Get(ctx, "user:1001")
pipe.Get(ctx, "user:1002")
pipe.Exec(ctx) // go-redis tự group theo shard
```

#### ⚠️ SCAN trong Cluster
```go
// ❌ SCAN chỉ scan 1 node
rdb.Scan(ctx, 0, "user:*", 100)

// ✅ Phải scan từng shard
rdb.ForEachMaster(ctx, func(ctx context.Context, master *redis.Client) error {
    var cursor uint64
    for {
        keys, nextCursor, err := master.Scan(ctx, cursor, "user:*", 100).Result()
        // process keys...
        if nextCursor == 0 {
            break
        }
        cursor = nextCursor
    }
    return nil
})
```

#### ⚠️ Hot slot / Hot key
```
Nếu 1 key được access cực nhiều → 1 shard bị overload trong khi các shard khác rảnh.
→ Dùng key sharding thủ công: "hot_key:1", "hot_key:2", ... "hot_key:N"
→ Random pick khi đọc, write tất cả (hoặc read-through cache)
```

#### ⚠️ Resharding (thêm node) không phải zero-downtime hoàn toàn
```
Khi add node mới và redistribute slots, có thể gặp MOVED redirect lag.
→ Plan resharding vào giờ thấp điểm.
→ Monitor replication lag trong quá trình.
```

#### ⚠️ Lua scripting trong Cluster
```lua
-- ❌ Script dùng keys ở nhiều slot khác nhau → lỗi
-- ✅ Script chỉ dùng keys trong cùng 1 slot (hash tag)

-- Khi gọi EVAL:
-- redis-cli EVAL "script" 2 {user:1001}:a {user:1001}:b
-- go-redis tự detect slot từ key đầu tiên trong KEYS[]
```

---

## 8. Checklist triển khai Production

### Redis Sentinel Production Checklist

- [ ] Ít nhất **3 Sentinel nodes** (số lẻ), quorum = majority
- [ ] Sentinels đặt trên **3 máy vật lý/AZ khác nhau**
- [ ] Cấu hình `min-replicas-to-write` và `min-replicas-max-lag`
- [ ] Set `requirepass` và `masterauth`
- [ ] Cấu hình `maxmemory` và `maxmemory-policy`
- [ ] Enable `appendonly yes` (AOF) hoặc RDB snapshot phù hợp
- [ ] Client dùng **FailoverClient** (không hardcode IP Master)
- [ ] Monitor: theo dõi `sentinel_masters`, `sentinel_slaves`, `role`
- [ ] Alert khi `connected_slaves` < expected
- [ ] Backup: scheduled RDB snapshot sang S3 hoặc NFS
- [ ] Test failover định kỳ (kill Master, verify auto-promote)

### Redis Cluster Production Checklist

- [ ] Tối thiểu **6 nodes** (3 Master + 3 Replica), mỗi shard 1 replica
- [ ] Nodes trải đều trên **3 AZ khác nhau**
- [ ] Dùng `ClusterClient` trong go-redis, không dùng `Client`
- [ ] Đã review toàn bộ multi-key operations → áp dụng hash tags
- [ ] Cấu hình `cluster-node-timeout`, `cluster-require-full-coverage`
- [ ] Set `requirepass` (áp dụng cho toàn cluster)
- [ ] Enable AOF trên từng node
- [ ] Monitor: `cluster_state`, `cluster_slots_assigned`, `cluster_known_nodes`
- [ ] Alert khi `cluster_state != ok`
- [ ] Đã test: thêm node, xóa node, failover 1 shard
- [ ] Có runbook xử lý khi cluster vào FAIL state

### Monitoring Metrics quan trọng (chung)

```
# Memory
used_memory_human       → dung lượng hiện tại
mem_fragmentation_ratio → > 1.5 là đáng lo
maxmemory               → giới hạn đã set

# Performance
instantaneous_ops_per_sec → throughput hiện tại
keyspace_hits / keyspace_misses → hit rate
latency_ms              → p99 latency

# Replication
connected_slaves        → số replica đang kết nối
master_repl_offset vs slave_repl_offset → replication lag

# Connections
connected_clients       → số client đang kết nối
blocked_clients         → client đang bị block (BLPOP, etc.)
```

---

## 9. Tóm tắt quyết định

```
┌──────────────────────────────────────────────────────────┐
│                   TÓM TẮT CHO TEAM                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Phần lớn service Fintech/Web3 của team:                 │
│  → Dùng REDIS SENTINEL trước                             │
│  → Đơn giản, ổn định, full-featured                      │
│  → Đủ dùng cho hầu hết use case (session, cache, lock)   │
│                                                          │
│  Chuyển sang REDIS CLUSTER khi:                          │
│  → Dataset > 50–80GB                                     │
│  → Write throughput liên tục > 50–100k ops/s             │
│  → Có kế hoạch migrate key design trước                  │
│                                                          │
│  KHÔNG BAOGIỜ:                                           │
│  → Hardcode IP của Master                                │
│  → Dùng Cluster mà không hiểu hash slot/hash tag         │
│  → Deploy Sentinel với chỉ 2 Sentinel nodes              │
│  → Bỏ qua failover testing                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

> **Câu hỏi hoặc review PR liên quan Redis?** Ping Tech Lead trước khi merge.  
> Document này là living document — cập nhật khi team có learnings mới.
