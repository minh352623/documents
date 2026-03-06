# 🚀 Hướng Dẫn Sử Dụng Redis — Từng Use Case Chi Tiết

> **Tác giả:** Tran Cong Minh  
> **Tags:** Golang, Redis, Backend, Cache, Distributed Systems  
> **Link tài liệu gốc:** [documents-inky.vercel.app](https://documents-inky.vercel.app)

---

Redis là một trong những công cụ không thể thiếu trong backend hiện đại. Bài viết này hướng dẫn chi tiết từng method trong `IRedisService` — kèm ví dụ thực tế từ các project Fintech và Web3 mà mình đã xây dựng.

---

## 📋 Mục Lục

1. [String Operations — Get / Set / Del](#1-string-operations--get--set--del)
2. [WithDistributedLock — Xử lý Race Condition](#2-withdistributedlock--xử-lý-race-condition)
3. [Set Operations — SAdd / SRem / SMembers / SIsMember / SCard](#3-set-operations)
4. [Hash Operations — HIncrBy / HGet / HGetAll](#4-hash-operations)
5. [Pipeline — Batch Commands](#5-pipeline--batch-commands)
6. [ZSet Operations — Leaderboard & Ranking](#6-zset-operations--leaderboard--ranking)

---

## 1. String Operations — Get / Set / Del

String là type cơ bản nhất của Redis. Dùng cho caching, session, rate limiting, feature flags,...

### `Set` — Lưu dữ liệu vào cache

```go
// Signature
Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error
```

**Use case: Cache kết quả query database**

```go
func (s *userService) GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
    cacheKey := fmt.Sprintf("user:profile:%s", userID)

    // Bước 1: Thử lấy từ cache trước
    cached, err := s.redis.Get(ctx, cacheKey)
    if err == nil {
        // Cache hit — deserialize và trả về
        var profile UserProfile
        if err := json.Unmarshal([]byte(cached), &profile); err == nil {
            return &profile, nil
        }
    }

    // Bước 2: Cache miss — query database
    profile, err := s.db.GetUserProfile(ctx, userID)
    if err != nil {
        return nil, err
    }

    // Bước 3: Lưu vào cache với TTL 15 phút
    data, _ := json.Marshal(profile)
    s.redis.Set(ctx, cacheKey, string(data), 15*time.Minute)

    return profile, nil
}
```

> **Lưu ý:** Luôn đặt TTL hợp lý. Không nên dùng `0` (không hết hạn) cho dữ liệu có thể thay đổi.

---

### `Get` — Lấy dữ liệu từ cache

```go
// Signature
Get(ctx context.Context, key string) (string, error)
```

**Use case: Kiểm tra OTP còn hiệu lực không**

```go
func (s *authService) VerifyOTP(ctx context.Context, phone, otp string) error {
    cacheKey := fmt.Sprintf("otp:%s", phone)

    // Lấy OTP đã lưu
    storedOTP, err := s.redis.Get(ctx, cacheKey)
    if err != nil {
        // Key không tồn tại = OTP đã hết hạn
        return errors.New("OTP expired or not found")
    }

    if storedOTP != otp {
        return errors.New("Invalid OTP")
    }

    // OTP đúng — xóa để không dùng lại
    s.redis.Del(ctx, cacheKey)
    return nil
}

// Khi gửi OTP:
func (s *authService) SendOTP(ctx context.Context, phone string) error {
    otp := generateRandomOTP() // "123456"
    cacheKey := fmt.Sprintf("otp:%s", phone)

    // Lưu OTP với TTL 5 phút
    return s.redis.Set(ctx, cacheKey, otp, 5*time.Minute)
}
```

---

### `Del` — Xóa cache khi data thay đổi

```go
// Signature
Del(ctx context.Context, key string) error
```

**Use case: Invalidate cache sau khi update**

```go
func (s *userService) UpdateUserProfile(ctx context.Context, userID string, req UpdateProfileRequest) error {
    // Cập nhật database
    if err := s.db.UpdateUser(ctx, userID, req); err != nil {
        return err
    }

    // Xóa cache cũ để lần sau fetch lại từ DB
    cacheKey := fmt.Sprintf("user:profile:%s", userID)
    s.redis.Del(ctx, cacheKey)

    return nil
}
```

> **Pattern phổ biến:** Cache-Aside (Lazy Loading) — chỉ load vào cache khi có request, xóa cache khi data thay đổi.

---

## 2. WithDistributedLock — Xử Lý Race Condition

Đây là method quan trọng nhất khi làm hệ thống distributed. Dùng để đảm bảo **chỉ một instance xử lý một tác vụ tại một thời điểm**.

```go
// Signature
WithDistributedLock(
    ctx context.Context,
    key string,
    ttlSeconds int64,
    refreshCache bool,
    fn func(ctx context.Context) (int, any, error),
) (int, any, error)
```

### Use case 1: Ngăn duplicate transaction

```go
// PROBLEM: User bấm "Thanh toán" 2 lần liên tiếp trong 500ms
// → 2 goroutine chạy song song → double charge!

func (s *paymentService) ProcessPayment(ctx context.Context, userID string, amount float64) error {
    lockKey := fmt.Sprintf("payment:lock:%s", userID)

    statusCode, result, err := s.redis.WithDistributedLock(
        ctx,
        lockKey,
        30,    // TTL 30 giây — đủ để xử lý payment
        false, // không cần refresh cache
        func(ctx context.Context) (int, any, error) {
            // Chỉ 1 goroutine vào được đây tại một thời điểm

            // Kiểm tra đã xử lý chưa (idempotency)
            idempotencyKey := fmt.Sprintf("payment:done:%s", userID)
            if done, _ := s.redis.Get(ctx, idempotencyKey); done == "1" {
                return 409, nil, errors.New("payment already processed")
            }

            // Thực hiện thanh toán
            txn, err := s.db.CreateTransaction(ctx, userID, amount)
            if err != nil {
                return 500, nil, err
            }

            // Đánh dấu đã xử lý trong 5 phút
            s.redis.Set(ctx, idempotencyKey, "1", 5*time.Minute)

            return 200, txn, nil
        },
    )

    if err != nil {
        return err
    }
    _ = statusCode
    _ = result
    return nil
}
```

---

### Use case 2: Cron job chỉ chạy trên 1 instance (khi deploy nhiều pods)

```go
// PROBLEM: Có 3 pods đang chạy, cron job "tính lãi" chạy đồng thời 3 lần
// → Tính lãi 3 lần cho mỗi user!

func (s *interestService) CalculateDailyInterest(ctx context.Context) {
    lockKey := "cron:daily-interest"

    s.redis.WithDistributedLock(
        ctx,
        lockKey,
        300,   // TTL 5 phút — đủ để chạy xong
        false,
        func(ctx context.Context) (int, any, error) {
            // Chỉ 1 pod trong cluster vào được đây
            log.Info("Running daily interest calculation...")

            users, err := s.db.GetAllActiveInvestors(ctx)
            if err != nil {
                return 500, nil, err
            }

            for _, user := range users {
                s.calculateInterestForUser(ctx, user)
            }

            log.Info("Daily interest calculation done", zap.Int("users", len(users)))
            return 200, nil, nil
        },
    )
}
```

---

### Use case 3: Rate limiting nâng cao

```go
// Giới hạn user chỉ được withdraw 1 lần mỗi 24 giờ
func (s *walletService) Withdraw(ctx context.Context, userID string, amount float64) error {
    lockKey := fmt.Sprintf("withdraw:lock:%s", userID)

    _, _, err := s.redis.WithDistributedLock(
        ctx,
        lockKey,
        86400, // TTL 24 giờ
        false,
        func(ctx context.Context) (int, any, error) {
            return s.processWithdraw(ctx, userID, amount)
        },
    )
    return err
}
```

---

## 3. Set Operations

Redis Set lưu tập hợp các giá trị **không trùng lặp**. Phù hợp cho: danh sách user online, tags, unique visitors,...

```go
SAdd(ctx, key, members...)       // Thêm member vào set
SRem(ctx, key, members...)       // Xóa member khỏi set
SMembers(ctx, key)               // Lấy tất cả members
SIsMember(ctx, key, member)      // Kiểm tra member có trong set không
SCard(ctx, key)                  // Đếm số lượng members
```

### Use case 1: Theo dõi user đang online

```go
const OnlineUsersKey = "users:online"

// User kết nối WebSocket
func (s *presenceService) UserConnected(ctx context.Context, userID string) error {
    return s.redis.SAdd(ctx, OnlineUsersKey, userID)
}

// User ngắt kết nối
func (s *presenceService) UserDisconnected(ctx context.Context, userID string) error {
    return s.redis.SRem(ctx, OnlineUsersKey, userID)
}

// Kiểm tra user có online không
func (s *presenceService) IsOnline(ctx context.Context, userID string) (bool, error) {
    return s.redis.SIsMember(ctx, OnlineUsersKey, userID)
}

// Lấy tất cả user online
func (s *presenceService) GetOnlineUsers(ctx context.Context) ([]string, error) {
    return s.redis.SMembers(ctx, OnlineUsersKey)
}

// Đếm số user online (hiển thị "1,234 users online")
func (s *presenceService) CountOnlineUsers(ctx context.Context) (int64, error) {
    return s.redis.SCard(ctx, OnlineUsersKey)
}
```

---

### Use case 2: Quản lý danh sách blacklist token JWT

```go
// Khi user logout — thêm token vào blacklist
func (s *authService) Logout(ctx context.Context, token string) error {
    // Lưu token hash vào blacklist set
    tokenHash := sha256Hash(token)
    blacklistKey := "auth:blacklist:tokens"

    return s.redis.SAdd(ctx, blacklistKey, tokenHash)
}

// Middleware kiểm tra token có bị blacklist không
func (s *authService) IsTokenBlacklisted(ctx context.Context, token string) (bool, error) {
    tokenHash := sha256Hash(token)
    return s.redis.SIsMember(ctx, "auth:blacklist:tokens", tokenHash)
}
```

---

### Use case 3: Unique visitors trong ngày

```go
func (s *analyticsService) TrackVisitor(ctx context.Context, userID string) error {
    today := time.Now().Format("2006-01-02")
    key := fmt.Sprintf("analytics:visitors:%s", today)

    // Set tự động deduplicate — user visit nhiều lần chỉ đếm 1
    if err := s.redis.SAdd(ctx, key, userID); err != nil {
        return err
    }

    // Set TTL 7 ngày cho key này (nếu chưa có TTL)
    // Thực tế nên check trước khi set
    return nil
}

func (s *analyticsService) GetUniqueVisitors(ctx context.Context, date string) (int64, error) {
    key := fmt.Sprintf("analytics:visitors:%s", date)
    return s.redis.SCard(ctx, key)
}
```

---

## 4. Hash Operations

Redis Hash lưu trữ **map field → value** trong một key duy nhất. Phù hợp cho: user session, counters theo category, object với nhiều fields.

```go
HIncrBy(ctx, key, field, value)  // Tăng/giảm giá trị số của 1 field
HGet(ctx, key, field)            // Lấy giá trị 1 field
HGetAll(ctx, key)                // Lấy toàn bộ fields
```

### Use case 1: Đếm số lượng actions của user (vote, like, share,...)

```go
// Mỗi user có một hash lưu các counters
// Key: "user:stats:{userID}"
// Fields: "votes", "likes", "shares", "comments"

func (s *statsService) IncrementVote(ctx context.Context, userID string) (int64, error) {
    key := fmt.Sprintf("user:stats:%s", userID)
    return s.redis.HIncrBy(ctx, key, "votes", 1)
}

func (s *statsService) DecrementVote(ctx context.Context, userID string) (int64, error) {
    key := fmt.Sprintf("user:stats:%s", userID)
    return s.redis.HIncrBy(ctx, key, "votes", -1) // truyền âm để giảm
}

func (s *statsService) GetUserStats(ctx context.Context, userID string) (map[string]string, error) {
    key := fmt.Sprintf("user:stats:%s", userID)
    // Trả về: {"votes": "42", "likes": "128", "shares": "7"}
    return s.redis.HGetAll(ctx, key)
}

func (s *statsService) GetVoteCount(ctx context.Context, userID string) (string, error) {
    key := fmt.Sprintf("user:stats:%s", userID)
    return s.redis.HGet(ctx, key, "votes")
}
```

---

### Use case 2: Shopping cart

```go
// Key: "cart:{userID}"
// Fields: "{productID}" → "{quantity}"

func (s *cartService) AddItem(ctx context.Context, userID, productID string, qty int64) error {
    key := fmt.Sprintf("cart:%s", userID)
    _, err := s.redis.HIncrBy(ctx, key, productID, qty)
    return err
}

func (s *cartService) RemoveItem(ctx context.Context, userID, productID string) error {
    key := fmt.Sprintf("cart:%s", userID)
    // Set về 0 bằng cách lấy giá trị hiện tại rồi negate
    current, err := s.redis.HGet(ctx, key, productID)
    if err != nil {
        return nil // không có item thì không cần xóa
    }
    qty, _ := strconv.ParseInt(current, 10, 64)
    _, err = s.redis.HIncrBy(ctx, key, productID, -qty)
    return err
}

func (s *cartService) GetCart(ctx context.Context, userID string) (map[string]string, error) {
    key := fmt.Sprintf("cart:%s", userID)
    // {"product:123": "2", "product:456": "1"}
    return s.redis.HGetAll(ctx, key)
}
```

---

### Use case 3: Rate limiting theo từng endpoint

```go
// Key: "ratelimit:{userID}:{date}"
// Fields: "GET:/api/users", "POST:/api/payment",...

func (s *rateLimitService) CheckAndIncrement(
    ctx context.Context,
    userID, endpoint string,
    limit int64,
) (bool, error) {
    today := time.Now().Format("2006-01-02")
    key := fmt.Sprintf("ratelimit:%s:%s", userID, today)

    // Tăng counter cho endpoint này
    count, err := s.redis.HIncrBy(ctx, key, endpoint, 1)
    if err != nil {
        return false, err
    }

    // Vượt quá giới hạn
    if count > limit {
        return false, nil // false = bị rate limited
    }

    return true, nil // true = được phép
}
```

---

## 5. Pipeline — Batch Commands

Pipeline gom nhiều lệnh Redis vào **một lần network round-trip**, giảm latency đáng kể khi cần thực thi nhiều lệnh cùng lúc.

```go
Pipeline() redis.Pipeliner
```

### So sánh không dùng vs dùng Pipeline

```
Không Pipeline (3 round-trips):          Pipeline (1 round-trip):
Client → SET key1 → Redis (1ms)          Client → SET key1 ┐
Client → SET key2 → Redis (1ms)                  → SET key2 ├→ Redis (1ms)
Client → SET key3 → Redis (1ms)                  → SET key3 ┘
Tổng: 3ms                                Tổng: 1ms (nhanh 3x)
```

### Use case 1: Khởi tạo nhiều counters cùng lúc

```go
func (s *gameService) InitPlayerStats(ctx context.Context, playerID string) error {
    pipe := s.redis.Pipeline()

    key := fmt.Sprintf("player:stats:%s", playerID)

    // Gom tất cả lệnh — chưa thực thi
    pipe.HSet(ctx, key, "kills", 0)
    pipe.HSet(ctx, key, "deaths", 0)
    pipe.HSet(ctx, key, "assists", 0)
    pipe.HSet(ctx, key, "score", 0)
    pipe.Expire(ctx, key, 24*time.Hour)

    // Thực thi tất cả trong 1 round-trip
    _, err := pipe.Exec(ctx)
    return err
}
```

---

### Use case 2: Lấy profile của nhiều users cùng lúc

```go
func (s *userService) GetMultipleUserProfiles(ctx context.Context, userIDs []string) ([]string, error) {
    pipe := s.redis.Pipeline()

    // Queue tất cả GET commands
    cmds := make([]*redis.StringCmd, len(userIDs))
    for i, id := range userIDs {
        key := fmt.Sprintf("user:profile:%s", id)
        cmds[i] = pipe.Get(ctx, key)
    }

    // Execute tất cả cùng lúc
    pipe.Exec(ctx)

    // Thu thập kết quả
    results := make([]string, 0, len(userIDs))
    for _, cmd := range cmds {
        val, err := cmd.Result()
        if err == nil {
            results = append(results, val)
        }
    }

    return results, nil
}
```

---

### Use case 3: Atomic update nhiều keys (leaderboard + stats)

```go
func (s *gameService) RecordKill(ctx context.Context, killerID, victimID string) error {
    pipe := s.redis.Pipeline()

    // Cập nhật stats
    killerKey := fmt.Sprintf("player:stats:%s", killerID)
    victimKey := fmt.Sprintf("player:stats:%s", victimID)

    pipe.HIncrBy(ctx, killerKey, "kills", 1)
    pipe.HIncrBy(ctx, victimKey, "deaths", 1)

    // Cập nhật leaderboard
    pipe.ZIncrBy(ctx, "leaderboard:kills", 1, killerID)

    // Tất cả thực thi trong 1 round-trip
    _, err := pipe.Exec(ctx)
    return err
}
```

---

## 6. ZSet Operations — Leaderboard & Ranking

Redis Sorted Set (ZSet) là data structure mạnh nhất cho **ranking, leaderboard, và time-series data**. Mỗi member có một `score` (float64) và tự động được sắp xếp.

```go
ZAdd(ctx, key, members...)              // Thêm member với score
ZIncrBy(ctx, key, increment, member)    // Tăng score của member
ZRange(ctx, key, start, stop)           // Lấy theo thứ tự tăng dần (score thấp → cao)
ZRevRange(ctx, key, start, stop)        // Lấy theo thứ tự giảm dần (score cao → thấp)
ZScore(ctx, key, member)                // Lấy score của 1 member
ZRemRangeByScore(ctx, key, min, max)    // Xóa members theo score range
ZCard(ctx, key)                         // Đếm tổng số members
ZRem(ctx, key, members...)              // Xóa member cụ thể
```

### Use case 1: Real-time Leaderboard

```go
const LeaderboardKey = "game:leaderboard:points"

// User kiếm điểm
func (s *leaderboardService) AddPoints(ctx context.Context, userID string, points float64) error {
    return s.redis.ZIncrBy(ctx, LeaderboardKey, points, userID)
}

// Lấy Top 10 người chơi (điểm cao nhất)
func (s *leaderboardService) GetTop10(ctx context.Context) ([]redis.Z, error) {
    // ZRevRange: index 0 = cao nhất, stop 9 = lấy 10 phần tử
    return s.redis.ZRevRange(ctx, LeaderboardKey, 0, 9)
}

// Lấy rank của 1 user cụ thể
func (s *leaderboardService) GetUserScore(ctx context.Context, userID string) (float64, error) {
    return s.redis.ZScore(ctx, LeaderboardKey, userID)
}

// Xóa user khỏi leaderboard (bị ban)
func (s *leaderboardService) RemoveUser(ctx context.Context, userID string) error {
    return s.redis.ZRem(ctx, LeaderboardKey, userID)
}

// Tổng số người chơi có mặt trên leaderboard
func (s *leaderboardService) TotalPlayers(ctx context.Context) (int64, error) {
    return s.redis.ZCard(ctx, LeaderboardKey)
}
```

**Output mẫu từ GetTop10:**
```json
[
  {"Member": "user:001", "Score": 9850},
  {"Member": "user:042", "Score": 8720},
  {"Member": "user:007", "Score": 7500}
]
```

---

### Use case 2: Khởi tạo leaderboard với ZAdd

```go
// Dùng khi cần set score trực tiếp (không increment)
// Ví dụ: sync từ database vào Redis lúc startup

func (s *leaderboardService) SyncFromDatabase(ctx context.Context) error {
    players, err := s.db.GetAllPlayerScores(ctx)
    if err != nil {
        return err
    }

    // Build members
    members := make([]redis.Z, len(players))
    for i, p := range players {
        members[i] = redis.Z{
            Score:  float64(p.Points),
            Member: p.UserID,
        }
    }

    return s.redis.ZAdd(ctx, LeaderboardKey, members...)
}
```

---

### Use case 3: ZRemRangeByScore — Dọn dẹp data cũ (Time-series)

```go
// Use case: Giữ lại chỉ các events trong 24 giờ gần nhất
// Score = Unix timestamp của event

func (s *eventService) AddEvent(ctx context.Context, userID string) error {
    key := fmt.Sprintf("events:user:%s", userID)
    now := float64(time.Now().Unix())

    return s.redis.ZAdd(ctx, key, redis.Z{
        Score:  now,
        Member: fmt.Sprintf("event:%d", time.Now().UnixNano()),
    })
}

func (s *eventService) CleanOldEvents(ctx context.Context, userID string) error {
    key := fmt.Sprintf("events:user:%s", userID)

    oneDayAgo := float64(time.Now().Add(-24 * time.Hour).Unix())

    // Xóa tất cả events có score (timestamp) nhỏ hơn 24 giờ trước
    deleted, err := s.redis.ZRemRangeByScore(ctx, key, 0, oneDayAgo)
    if err != nil {
        return err
    }

    log.Info("Cleaned old events", zap.Int64("deleted", deleted))
    return nil
}

// Đếm số events trong 1 giờ gần nhất
func (s *eventService) CountRecentEvents(ctx context.Context, userID string) (int64, error) {
    key := fmt.Sprintf("events:user:%s", userID)
    // Lấy tất cả rồi đếm (có thể dùng ZRangeByScore nếu cần filter)
    return s.redis.ZCard(ctx, key)
}
```

---

### Use case 4: Multi-dimensional leaderboard (giống project XP)

```go
// Leaderboard theo network (ETH, BSC, SOL,...)
// Key: "leaderboard:network:{networkName}"

func (s *xpLeaderboardService) AddNetworkPoints(
    ctx context.Context,
    userID, network string,
    points float64,
) error {
    // Cập nhật leaderboard của network cụ thể
    networkKey := fmt.Sprintf("leaderboard:network:%s", network)
    if err := s.redis.ZIncrBy(ctx, networkKey, points, userID); err != nil {
        return err
    }

    // Cập nhật leaderboard tổng
    globalKey := "leaderboard:global"
    return s.redis.ZIncrBy(ctx, globalKey, points, userID)
}

// Top 10 theo network
func (s *xpLeaderboardService) GetNetworkTop10(ctx context.Context, network string) ([]redis.Z, error) {
    key := fmt.Sprintf("leaderboard:network:%s", network)
    return s.redis.ZRevRange(ctx, key, 0, 9)
}

// Top 10 toàn cầu
func (s *xpLeaderboardService) GetGlobalTop10(ctx context.Context) ([]redis.Z, error) {
    return s.redis.ZRevRange(ctx, "leaderboard:global", 0, 9)
}
```

---

## 🎯 Bảng Tóm Tắt — Chọn Operation Nào?

| Nhu cầu | Operation | Ví dụ key |
|---|---|---|
| Cache object/string | `Set` / `Get` / `Del` | `user:profile:{id}` |
| Chống race condition | `WithDistributedLock` | `payment:lock:{id}` |
| Danh sách không trùng | `SAdd` / `SMembers` | `users:online` |
| Kiểm tra membership | `SIsMember` | `auth:blacklist` |
| Đếm unique items | `SCard` | `analytics:visitors:{date}` |
| Counter theo field | `HIncrBy` | `user:stats:{id}` |
| Object nhiều fields | `HGetAll` | `cart:{id}` |
| Batch commands | `Pipeline` | — |
| Ranking / Leaderboard | `ZAdd` / `ZIncrBy` / `ZRevRange` | `leaderboard:global` |
| Dọn data cũ theo score | `ZRemRangeByScore` | `events:user:{id}` |
| Xóa member khỏi rank | `ZRem` | `leaderboard:global` |

---

## ⚠️ Lưu Ý Quan Trọng

### 1. Luôn đặt TTL cho cache key
```go
// ❌ Sai — key tồn tại mãi mãi, memory leak
s.redis.Set(ctx, "some:key", data, 0)

// ✅ Đúng — luôn có TTL phù hợp
s.redis.Set(ctx, "some:key", data, 15*time.Minute)
```

### 2. Đặt tên key có cấu trúc rõ ràng
```go
// ❌ Sai — không rõ scope
"user123"
"leaderboard"

// ✅ Đúng — namespace:entity:id
"user:profile:123"
"leaderboard:network:eth"
"payment:lock:user:456"
```

### 3. WithDistributedLock không thay thế DB transaction
```go
// Lock chỉ bảo vệ race condition ở application layer
// Với financial operations, vẫn cần DB transaction để đảm bảo ACID
_, _, err := s.redis.WithDistributedLock(ctx, lockKey, 30, false,
    func(ctx context.Context) (int, any, error) {
        return s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
            // Business logic bên trong DB transaction
        })
    },
)
```

### 4. Pipeline không đảm bảo atomicity
```go
// Pipeline gom commands nhưng không atomic như MULTI/EXEC
// Nếu cần atomic, dùng Lua script hoặc MULTI/EXEC
pipe := s.redis.Pipeline()
pipe.HIncrBy(ctx, key, "balance", -amount)  // Có thể thành công
pipe.ZIncrBy(ctx, rank, amount, userID)      // Có thể fail độc lập
pipe.Exec(ctx) // Kết quả từng command riêng biệt
```

---

## 🔗 Tài Nguyên Thêm

- [Redis Official Docs](https://redis.io/docs)
- [go-redis Documentation](https://redis.uptrace.dev)
- [Architecture Cache Setting](https://documents-inky.vercel.app/docs/tutorial-backend/architecture-cache-setting)
- [Redis Streaming](https://documents-inky.vercel.app/docs/tutorial-backend/redis-streaming)

---

*Bài viết này được viết dựa trên kinh nghiệm thực tế từ các project Fintech và Web3 tại TekNix Technology Corporation. Nếu có góp ý, vui lòng mở Issue trên GitHub.*
