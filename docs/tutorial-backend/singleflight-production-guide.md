# Cache Stampede Protection — SingleFlight & Redis Distributed Lock

> **Mục tiêu:** Tài liệu này trình bày đầy đủ hai pattern bảo vệ cache stampede trong production: `SingleFlight` (in-process) và `Redis Distributed Lock` (cross-instance), bao gồm triển khai Golang & Node.js, pitfall, khi nào dùng cái nào, và cách kết hợp cả hai.

---

## Mục lục

1. [Vấn đề: Cache Stampede](#1-vấn-đề-cache-stampede)
2. [SingleFlight — Golang](#2-singleflight--golang)
3. [SingleFlight — Node.js](#3-singleflight--nodejs)
4. [SingleFlight — Pitfall & Cách xử lý](#4-singleflight--pitfall--cách-xử-lý)
5. [Redis Distributed Lock](#5-redis-distributed-lock)
6. [Distributed Lock — Pitfall & Cách xử lý](#6-distributed-lock--pitfall--cách-xử-lý)
7. [Kết hợp SingleFlight + Distributed Lock](#7-kết-hợp-singleflight--distributed-lock)
8. [Ưu / Nhược điểm & Khi nào dùng cái nào](#8-ưu--nhược-điểm--khi-nào-dùng-cái-nào)
9. [Observability & Monitoring](#9-observability--monitoring)
10. [Checklist production](#10-checklist-production)

---

## 1. Vấn đề: Cache Stampede

Khi cache miss xảy ra đồng thời với nhiều request, tất cả đều query database cùng lúc gây overload.

```
Không có bảo vệ:

T=0ms  → 100 requests → cache miss → 100 DB queries 💥

SingleFlight (1 instance):

T=0ms  → 100 requests → cache miss
            └─ 1 DB query chạy thật
            └─ 99 requests share kết quả ✅
            Nhưng nếu có 3 instances → vẫn có 3 DB queries tổng

Distributed Lock (3 instances):

T=0ms  → Instance A acquire lock → 1 DB query ✅
       → Instance B, C chờ lock → check cache sau khi lock release
            Toàn cluster chỉ có 1 DB query ✅

SingleFlight + Distributed Lock (best of both worlds):

T=0ms  → Mỗi instance dedup nội bộ (SingleFlight)
       → Chỉ 1 goroutine/instance ra ngoài giành lock
       → Toàn cluster chỉ có 1 DB query ✅✅
```

### Phạm vi bảo vệ

```
┌─────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                  │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │   Instance A     │    │   Instance B     │           │
│  │                  │    │                  │           │
│  │  [SingleFlight]  │    │  [SingleFlight]  │           │
│  │  dedup nội bộ    │    │  dedup nội bộ    │           │
│  └────────┬─────────┘    └────────┬─────────┘           │
│           │                       │                     │
│           └──────────┬────────────┘                     │
│                      │                                  │
│              [Distributed Lock]                         │
│              chỉ 1 instance query DB                    │
│                      │                                  │
│                   ┌──▼──┐                               │
│                   │  DB │                               │
│                   └─────┘                               │
└─────────────────────────────────────────────────────────┘
```

---

## 2. SingleFlight — Golang

### 2.1 Cài đặt

```bash
go get golang.org/x/sync/singleflight
```

### 2.2 Struct chuẩn production

```go
// internal/cache/singleflight_service.go
package cache

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "log/slog"
    "math/rand"
    "time"

    "github.com/redis/go-redis/v9"
    "golang.org/x/sync/singleflight"
)

type UserRepository interface {
    FindByID(ctx context.Context, id int) (*User, error)
    Update(ctx context.Context, user *User) error
}

type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

type UserCacheService struct {
    redis  *redis.Client
    repo   UserRepository
    sfg    singleflight.Group
    ttl    time.Duration
    logger *slog.Logger
}

func NewUserCacheService(
    rdb *redis.Client,
    repo UserRepository,
    ttl time.Duration,
    logger *slog.Logger,
) *UserCacheService {
    return &UserCacheService{redis: rdb, repo: repo, ttl: ttl, logger: logger}
}
```

### 2.3 GetUser — Đầy đủ production logic

```go
func (s *UserCacheService) GetUser(ctx context.Context, userID int) (*User, error) {
    cacheKey := fmt.Sprintf("user:%d", userID)

    // ── Bước 1: Thử đọc từ cache ────────────────────────────────────────
    user, err := s.fromCache(ctx, cacheKey)
    if err == nil {
        return user, nil
    }
    if !errors.Is(err, redis.Nil) {
        // Redis lỗi thật (timeout, connection refused...) → log và tiếp tục
        s.logger.Warn("redis get failed, bypassing cache", "key", cacheKey, "err", err)
    }

    // ── Bước 2: Cache miss → dùng singleflight ──────────────────────────
    result, fetchErr, shared := s.sfg.Do(cacheKey, func() (interface{}, error) {
        // QUAN TRỌNG: Tạo context mới, độc lập với caller's context.
        // Nếu dùng ctx của caller, khi caller timeout → DB call bị cancel
        // và lỗi lan ra tất cả goroutine đang chờ.
        fetchCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        u, dbErr := s.repo.FindByID(fetchCtx, userID)
        if dbErr != nil {
            return nil, fmt.Errorf("db query failed: %w", dbErr)
        }

        // Populate cache trong goroutine riêng để không delay caller
        go s.toCache(context.Background(), cacheKey, u)

        return u, nil
    })

    if fetchErr != nil {
        s.logger.Error("fetch user failed",
            "userID", userID,
            "shared", shared, // true = lỗi được share từ goroutine khác
            "err", fetchErr,
        )
        return nil, fetchErr
    }

    s.logger.Debug("singleflight resolved", "userID", userID, "shared", shared)
    return result.(*User), nil
}
```

### 2.4 Helper methods

```go
func (s *UserCacheService) fromCache(ctx context.Context, key string) (*User, error) {
    val, err := s.redis.Get(ctx, key).Result()
    if err != nil {
        return nil, err
    }
    var user User
    if err := json.Unmarshal([]byte(val), &user); err != nil {
        // Data corrupt → xóa key, trả Nil để trigger fetch lại
        s.redis.Del(ctx, key)
        return nil, redis.Nil
    }
    return &user, nil
}

func (s *UserCacheService) toCache(ctx context.Context, key string, u *User) {
    data, err := json.Marshal(u)
    if err != nil {
        s.logger.Error("marshal user failed", "err", err)
        return
    }
    // TTL jitter: tránh nhiều key expire đồng loạt (herd expiry)
    jitter := time.Duration(rand.Int63n(int64(s.ttl / 10)))
    if err := s.redis.Set(ctx, key, data, s.ttl+jitter).Err(); err != nil {
        s.logger.Warn("redis set failed", "key", key, "err", err)
    }
}

func (s *UserCacheService) InvalidateUser(ctx context.Context, userID int) error {
    cacheKey := fmt.Sprintf("user:%d", userID)
    // Forget để request tiếp theo tạo fresh call
    // thay vì nhận kết quả cũ từ in-flight request đang chạy
    s.sfg.Forget(cacheKey)
    return s.redis.Del(ctx, cacheKey).Err()
}

func (s *UserCacheService) UpdateUser(ctx context.Context, user *User) error {
    if err := s.repo.Update(ctx, user); err != nil {
        return err
    }
    return s.InvalidateUser(ctx, user.ID)
}
```

### 2.5 Generic version (Go 1.21+)

```go
type SingleFlightCache[T any] struct {
    redis  *redis.Client
    sfg    singleflight.Group
    ttl    time.Duration
    loader func(ctx context.Context, key string) (*T, error)
}

func (c *SingleFlightCache[T]) Get(ctx context.Context, key string) (*T, error) {
    val, err := c.redis.Get(ctx, key).Result()
    if err == nil {
        var result T
        if json.Unmarshal([]byte(val), &result) == nil {
            return &result, nil
        }
    }

    v, err, _ := c.sfg.Do(key, func() (interface{}, error) {
        fetchCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        result, err := c.loader(fetchCtx, key)
        if err != nil {
            return nil, err
        }
        data, _ := json.Marshal(result)
        c.redis.Set(context.Background(), key, data, c.ttl)
        return result, nil
    })

    if err != nil {
        return nil, err
    }
    return v.(*T), nil
}

// Sử dụng — không cần type assertion
userCache := &SingleFlightCache[User]{
    redis: rdb,
    ttl:   10 * time.Minute,
    loader: func(ctx context.Context, key string) (*User, error) {
        id, _ := strconv.Atoi(strings.TrimPrefix(key, "user:"))
        return userRepo.FindByID(ctx, id)
    },
}
user, err := userCache.Get(ctx, "user:42")
```

---

## 3. SingleFlight — Node.js

### 3.1 SingleFlight class

```javascript
// lib/single-flight.js
'use strict';

class SingleFlight {
  #inFlight = new Map();

  /**
   * @param {string}   key
   * @param {Function} fn             — async function to execute
   * @param {object}   [opts]
   * @param {number}   [opts.timeoutMs=5000]
   * @returns {Promise<{ value: any, shared: boolean }>}
   */
  async do(key, fn, { timeoutMs = 5000 } = {}) {
    const shared = this.#inFlight.has(key);

    if (shared) {
      // Clone error để stack trace không bị trộn lẫn khi debug
      return this.#inFlight.get(key)
        .then(value => ({ value, shared: true }))
        .catch(err => Promise.reject(this.#cloneError(err)));
    }

    const promise = this.#withTimeout(fn(), timeoutMs, key)
      .finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, promise);
    const value = await promise;
    return { value, shared: false };
  }

  forget(key) { this.#inFlight.delete(key); }

  get size() { return this.#inFlight.size; }

  #withTimeout(promise, ms, key) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`SingleFlight timeout after ${ms}ms [key=${key}]`)),
          ms
        )
      ),
    ]);
  }

  #cloneError(err) {
    const cloned = new Error(err.message);
    cloned.name  = err.name;
    cloned.cause = err;
    return cloned;
  }
}

module.exports = { SingleFlight };
```

### 3.2 UserCacheService

```javascript
// services/user-cache.service.js
'use strict';

const { SingleFlight } = require('../lib/single-flight');

class UserCacheService {
  #redis; #userRepo; #sf; #ttlSeconds; #logger;

  constructor({ redis, userRepo, ttlSeconds = 600, logger = console }) {
    this.#redis      = redis;
    this.#userRepo   = userRepo;
    this.#sf         = new SingleFlight();
    this.#ttlSeconds = ttlSeconds;
    this.#logger     = logger;
  }

  async getUser(userId) {
    const cacheKey = `user:${userId}`;

    const cached = await this.#fromCache(cacheKey);
    if (cached) return cached;

    try {
      const { value: user, shared } = await this.#sf.do(
        cacheKey,
        () => this.#fetchAndCache(userId, cacheKey),
        { timeoutMs: 5000 }
      );
      this.#logger.debug('singleflight resolved', { userId, shared });
      return user;
    } catch (err) {
      this.#logger.error('getUser failed', { userId, err: err.message });
      throw err;
    }
  }

  async invalidateUser(userId) {
    const cacheKey = `user:${userId}`;
    this.#sf.forget(cacheKey);
    await this.#redis.del(cacheKey);
  }

  async updateUser(user) {
    await this.#userRepo.update(user);
    await this.invalidateUser(user.id);
  }

  async #fromCache(key) {
    try {
      const raw = await this.#redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      this.#logger.warn('cache get failed', { key, err: err.message });
      await this.#redis.del(key).catch(() => {});
      return null;
    }
  }

  async #fetchAndCache(userId, cacheKey) {
    const user = await this.#userRepo.findById(userId);
    if (!user) throw new Error(`User ${userId} not found`);

    const jitter = Math.floor(Math.random() * this.#ttlSeconds * 0.1);
    setImmediate(async () => {
      await this.#redis
        .set(cacheKey, JSON.stringify(user), 'EX', this.#ttlSeconds + jitter)
        .catch(err => this.#logger.warn('cache set failed', { cacheKey, err: err.message }));
    });

    return user;
  }
}

module.exports = { UserCacheService };
```

---

## 4. SingleFlight — Pitfall & Cách xử lý

### 4.1 Shared Error — Lỗi lan ra tất cả caller

```go
// ❌ 1 DB timeout → 100 requests đều fail
result, err, _ := sfg.Do(key, fn)

// ✅ Dùng shared flag để log phân biệt nguồn lỗi
result, err, shared := sfg.Do(key, fn)
if err != nil {
    if shared {
        metrics.IncrCounter("singleflight.shared_error")
    }
    return nil, err
}
```

### 4.2 Context Cancellation — Golang specific

```go
// ❌ Sai: Caller timeout → DB call bị cancel → lỗi lan ra tất cả goroutine chờ
sfg.Do(key, func() (interface{}, error) {
    return db.Query(ctx, userID) // ctx của caller!
})

// ✅ Đúng: Context độc lập với timeout riêng
sfg.Do(key, func() (interface{}, error) {
    fetchCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    return db.Query(fetchCtx, userID)
})
```

### 4.3 Key Design sai

```go
// ❌ Quá rộng: gộp nhầm user khác nhau
sfg.Do("get_user", func() (interface{}, error) { ... })

// ❌ Quá hẹp: timestamp → không bao giờ dedup
sfg.Do(fmt.Sprintf("user:%d:%d", userID, time.Now().UnixMilli()), ...)

// ✅ Đúng
sfg.Do(fmt.Sprintf("user:%d", userID), ...)

// ✅ Query phức tạp → hash params
hash := sha256.Sum256([]byte(fmt.Sprintf("%v", params)))
sfg.Do(fmt.Sprintf("search:%x", hash[:8]), ...)
```

### 4.4 Memory Leak — fn() treo vĩnh viễn (Node.js)

```javascript
// ❌ Không timeout → key sống mãi nếu fn() không resolve
const promise = fn().finally(() => this.#inFlight.delete(key));

// ✅ Luôn wrap với timeout
const promise = Promise.race([
  fn(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout [key=${key}]`)), timeoutMs)
  ),
]).finally(() => this.#inFlight.delete(key));
```

### 4.5 Giới hạn căn bản: Chỉ bảo vệ trong 1 process

```
Instance A (100 req) → SingleFlight → 1 DB query ✅
Instance B (100 req) → SingleFlight → 1 DB query ✅  ← vẫn 2 queries!
Instance C (100 req) → SingleFlight → 1 DB query ✅  ← vẫn 3 queries!
```

> Đây là lý do cần thêm **Distributed Lock** khi deploy nhiều instance.

---

## 5. Redis Distributed Lock

### 5.1 Khái niệm & Cơ chế

Redis Distributed Lock dùng Redis như một **coordination point** để đảm bảo **toàn bộ cluster** chỉ có 1 worker thực sự query DB tại một thời điểm.

**Cơ chế hoạt động:**

```
Instance A                 Redis                  Instance B
    │                        │                        │
    │── SET lock:user:42 ───▶│                        │
    │   NX PX 5000           │                        │
    │◀─ OK (acquired) ───────│                        │
    │                        │◀── SET lock:user:42 ───│
    │                        │    NX PX 5000          │
    │                        │─── nil (locked) ──────▶│
    │                        │                        │ chờ hoặc fallback
    │   [query DB]           │                        │
    │   [populate cache]     │                        │
    │── DEL lock:user:42 ───▶│                        │
    │                        │                        │ retry → cache HIT ✅
```

**Flow chuẩn — Double-check cache sau khi acquire lock:**

```
Request đến
    │
    ▼
Check cache lần 1 ──HIT──▶ Trả kết quả
    │ MISS
    ▼
Acquire Lock
    ├── FAIL ──▶ Fallback / Stale data
    └── SUCCESS
          │
          ▼
        Check cache lần 2   ◀── Instance khác có thể đã populate
          ├── HIT ──────────▶ Trả kết quả (tránh DB query thừa)
          └── MISS
                │
                ▼
              Query DB
                │
                ▼
              Populate cache
                │
                ▼
              Release lock
```

> **Tại sao phải check cache lần 2?** Khi instance A đang giữ lock và query DB, instance B đang chờ. Sau khi A release, B acquire lock — nếu B không check lại cache sẽ query DB lần nữa dù cache đã có.

### 5.2 Golang — với `redsync`

```bash
go get github.com/go-redsync/redsync/v4
```

```go
// internal/cache/dist_lock_service.go
package cache

import (
    "context"
    "fmt"
    "log/slog"
    "math/rand"
    "time"

    "github.com/go-redsync/redsync/v4"
    "github.com/go-redsync/redsync/v4/redis/goredis/v9"
    goredislib "github.com/redis/go-redis/v9"
)

type UserDistLockService struct {
    redis  *goredislib.Client
    repo   UserRepository
    rs     *redsync.Redsync
    ttl    time.Duration
    logger *slog.Logger
}

func NewUserDistLockService(
    rdb *goredislib.Client,
    repo UserRepository,
    ttl time.Duration,
    logger *slog.Logger,
) *UserDistLockService {
    pool := goredis.NewPool(rdb)
    return &UserDistLockService{
        redis: rdb, repo: repo,
        rs: redsync.New(pool), ttl: ttl, logger: logger,
    }
}

func (s *UserDistLockService) GetUser(ctx context.Context, userID int) (*User, error) {
    cacheKey := fmt.Sprintf("user:%d", userID)
    lockKey  := fmt.Sprintf("lock:user:%d", userID)

    // ── Bước 1: Check cache trước khi lock ──────────────────────────────
    if user, err := s.fromCache(ctx, cacheKey); err == nil {
        return user, nil
    }

    // ── Bước 2: Acquire distributed lock ────────────────────────────────
    mutex := s.rs.NewMutex(lockKey,
        redsync.WithExpiry(5*time.Second),            // tự expire nếu instance crash
        redsync.WithTries(3),                         // retry tối đa 3 lần
        redsync.WithRetryDelay(50*time.Millisecond),
    )

    if err := mutex.LockContext(ctx); err != nil {
        // Không acquire được → fallback xuống DB trực tiếp
        s.logger.Warn("failed to acquire lock, fallback",
            "lockKey", lockKey, "err", err)
        return s.repo.FindByID(ctx, userID)
    }

    defer func() {
        releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        if ok, err := mutex.UnlockContext(releaseCtx); !ok || err != nil {
            s.logger.Error("failed to release lock", "lockKey", lockKey, "err", err)
        }
    }()

    // ── Bước 3: Check cache lần 2 sau khi có lock ───────────────────────
    if user, err := s.fromCache(ctx, cacheKey); err == nil {
        s.logger.Debug("cache hit after lock", "cacheKey", cacheKey)
        return user, nil
    }

    // ── Bước 4: Query DB ────────────────────────────────────────────────
    fetchCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    user, err := s.repo.FindByID(fetchCtx, userID)
    if err != nil {
        return nil, fmt.Errorf("db query failed: %w", err)
    }

    go s.toCache(context.Background(), cacheKey, user)
    return user, nil
}

func (s *UserDistLockService) InvalidateUser(ctx context.Context, userID int) error {
    return s.redis.Del(ctx, fmt.Sprintf("user:%d", userID)).Err()
}
```

### 5.3 Node.js — với `redlock`

```bash
npm install redlock ioredis
```

```javascript
// services/user-dist-lock.service.js
'use strict';

const Redlock = require('redlock');

class UserDistLockService {
  #redis; #userRepo; #redlock; #ttlSeconds; #logger;

  constructor({ redis, userRepo, ttlSeconds = 600, logger = console }) {
    this.#redis      = redis;
    this.#userRepo   = userRepo;
    this.#ttlSeconds = ttlSeconds;
    this.#logger     = logger;

    this.#redlock = new Redlock([redis], {
      retryCount:  3,
      retryDelay:  50,
      retryJitter: 20, // jitter để tránh thundering herd khi retry
    });

    this.#redlock.on('error', (err) => {
      this.#logger.error('redlock internal error', { err: err.message });
    });
  }

  async getUser(userId) {
    const cacheKey = `user:${userId}`;
    const lockKey  = `lock:user:${userId}`;

    // Bước 1: Check cache
    const cached = await this.#fromCache(cacheKey);
    if (cached) return cached;

    // Bước 2: Acquire lock
    let lock;
    try {
      lock = await this.#redlock.acquire([lockKey], 5000);
    } catch (err) {
      this.#logger.warn('failed to acquire lock, fallback', { lockKey });
      return this.#userRepo.findById(userId);
    }

    try {
      // Bước 3: Double-check cache sau khi có lock
      const cachedAfterLock = await this.#fromCache(cacheKey);
      if (cachedAfterLock) {
        this.#logger.debug('cache hit after lock', { cacheKey });
        return cachedAfterLock;
      }

      // Bước 4: Query DB
      const user = await this.#userRepo.findById(userId);
      if (!user) throw new Error(`User ${userId} not found`);

      setImmediate(() => this.#toCache(cacheKey, user));
      return user;

    } finally {
      await lock.release().catch(err =>
        this.#logger.error('lock release failed', { lockKey, err: err.message })
      );
    }
  }

  async #fromCache(key) {
    try {
      const raw = await this.#redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async #toCache(key, data) {
    const jitter = Math.floor(Math.random() * this.#ttlSeconds * 0.1);
    await this.#redis
      .set(key, JSON.stringify(data), 'EX', this.#ttlSeconds + jitter)
      .catch(err => this.#logger.warn('cache set failed', { key, err: err.message }));
  }

  async invalidateUser(userId) {
    await this.#redis.del(`user:${userId}`);
  }
}

module.exports = { UserDistLockService };
```

---

## 6. Distributed Lock — Pitfall & Cách xử lý

### 6.1 Quên check cache lần 2

```go
// ❌ Acquire lock xong query DB ngay — bỏ qua data instance khác đã populate
mutex.Lock()
user := db.Query(fetchCtx, userID)

// ✅ Luôn check cache lần 2 trước khi query DB
mutex.Lock()
if user, err := fromCache(ctx, cacheKey); err == nil {
    return user, nil
}
user := db.Query(fetchCtx, userID)
```

### 6.2 Không set lock TTL — Lock sống mãi khi instance crash

```go
// ❌ Instance crash → lock không bao giờ được release
mutex := rs.NewMutex(lockKey)

// ✅ Luôn set expiry hợp lý + defer unlock
mutex := rs.NewMutex(lockKey, redsync.WithExpiry(5*time.Second))
defer mutex.UnlockContext(releaseCtx)
```

### 6.3 Lock contention — Quá nhiều instances chờ nhau

```go
// ❌ Retry 100 lần → request timeout trước khi có lock
mutex := rs.NewMutex(lockKey,
    redsync.WithTries(100),
    redsync.WithRetryDelay(50*time.Millisecond), // chờ ~5 giây
)

// ✅ Giới hạn retry, fallback nhanh nếu không lấy được lock
mutex := rs.NewMutex(lockKey,
    redsync.WithTries(3),
    redsync.WithRetryDelay(50*time.Millisecond), // chờ tối đa ~150ms
)
if err := mutex.LockContext(ctx); err != nil {
    return s.repo.FindByID(ctx, userID) // fallback: query thẳng DB
}
```

### 6.4 Redis down → toàn bộ cluster bị block

```go
// ❌ Không có fallback → Redis down = service down
if err := mutex.LockContext(ctx); err != nil {
    return nil, err
}

// ✅ Bypass lock khi Redis không khả dụng
if err := mutex.LockContext(ctx); err != nil {
    s.logger.Warn("lock unavailable, bypassing", "err", err)
    return s.repo.FindByID(ctx, userID) // DB chịu tải nhiều hơn nhưng service vẫn sống
}
```

### 6.5 Lock expiry ngắn hơn DB query — Lock tự expire trước khi xong

```go
// Vấn đề: DB query mất 7s nhưng lock TTL chỉ 5s
// → Lock expire → instance khác acquire → 2 DB queries chạy song song

// ✅ Extend lock trong khi query đang chạy
done := make(chan struct{})
go func() {
    ticker := time.NewTicker(3 * time.Second) // extend mỗi 3s (trước khi TTL 5s hết)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            mutex.ExtendContext(ctx)
        case <-done:
            return
        }
    }
}()

user, err := s.repo.FindByID(fetchCtx, userID)
close(done)
```

```javascript
// Node.js: extend thủ công
const lock = await redlock.acquire([lockKey], 5000);
// Nếu cần thêm thời gian
await lock.extend(5000);
```

---

## 7. Kết hợp SingleFlight + Distributed Lock

### 7.1 Tại sao kết hợp?

| Chỉ SingleFlight | Chỉ Distributed Lock | Kết hợp cả hai |
|---|---|---|
| Dedup trong 1 process | Dedup toàn cluster | Dedup cả trong process lẫn toàn cluster |
| N instances → N DB queries | Nhiều goroutine tranh lock → Redis bị hammer | Chỉ 1 goroutine/instance ra ngoài giành lock |
| Không cần Redis | Redis là SPOF | SingleFlight là lớp bảo vệ trước Redis |

### 7.2 Flow kết hợp

```
100 requests → Instance A
         │
         ▼
  ┌─────────────────────┐
  │   SingleFlight      │  ← dedup nội bộ: 99 goroutines chờ, 1 tiếp tục
  └──────────┬──────────┘
             │
             ▼
        Cache miss?
             │ YES
             ▼
  ┌─────────────────────┐
  │  Distributed Lock   │  ← chỉ 1 instance trong cluster được vào
  └──────────┬──────────┘
             │
        ┌────┴──────┐
       FAIL        SUCCESS
        │               │
        ▼               ▼
     Fallback      Check cache lần 2
     (query DB)         │
                   ┌────┴────┐
                  HIT       MISS
                   │           │
                   ▼           ▼
              Trả result   Query DB
                             │
                             ▼
                        Populate cache
                             │
                             ▼ (shared với 99 goroutines còn lại)
                        Release lock
```

### 7.3 Golang — Combined implementation

```go
// internal/cache/combined_service.go
package cache

import (
    "context"
    "encoding/json"
    "fmt"
    "log/slog"
    "math/rand"
    "time"

    "github.com/go-redsync/redsync/v4"
    "github.com/go-redsync/redsync/v4/redis/goredis/v9"
    goredislib "github.com/redis/go-redis/v9"
    "golang.org/x/sync/singleflight"
)

type CombinedCacheService struct {
    redis  *goredislib.Client
    repo   UserRepository
    sfg    singleflight.Group
    rs     *redsync.Redsync
    ttl    time.Duration
    logger *slog.Logger
}

func NewCombinedCacheService(
    rdb *goredislib.Client,
    repo UserRepository,
    ttl time.Duration,
    logger *slog.Logger,
) *CombinedCacheService {
    pool := goredis.NewPool(rdb)
    return &CombinedCacheService{
        redis: rdb, repo: repo,
        rs: redsync.New(pool), ttl: ttl, logger: logger,
    }
}

func (s *CombinedCacheService) GetUser(ctx context.Context, userID int) (*User, error) {
    cacheKey := fmt.Sprintf("user:%d", userID)

    // ── Layer 1: Cache lookup ────────────────────────────────────────────
    if user, err := s.fromCache(ctx, cacheKey); err == nil {
        return user, nil
    }

    // ── Layer 2: SingleFlight — dedup trong process ──────────────────────
    // Chỉ 1 goroutine tiếp tục xuống distributed lock
    val, err, shared := s.sfg.Do(cacheKey, func() (interface{}, error) {
        return s.fetchWithLock(cacheKey, userID)
    })

    if err != nil {
        s.logger.Error("GetUser failed", "userID", userID, "shared", shared, "err", err)
        return nil, err
    }

    s.logger.Debug("resolved", "userID", userID, "shared", shared)
    return val.(*User), nil
}

func (s *CombinedCacheService) fetchWithLock(cacheKey string, userID int) (*User, error) {
    lockKey := fmt.Sprintf("lock:%s", cacheKey)

    // ── Layer 3: Distributed Lock — dedup across cluster ────────────────
    mutex := s.rs.NewMutex(lockKey,
        redsync.WithExpiry(5*time.Second),
        redsync.WithTries(3),
        redsync.WithRetryDelay(50*time.Millisecond),
    )

    fetchCtx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
    defer cancel()

    if err := mutex.LockContext(fetchCtx); err != nil {
        s.logger.Warn("lock failed, direct query", "lockKey", lockKey, "err", err)
        return s.repo.FindByID(fetchCtx, userID)
    }

    defer func() {
        releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        mutex.UnlockContext(releaseCtx)
    }()

    // Double-check cache sau khi có lock
    if user, err := s.fromCache(fetchCtx, cacheKey); err == nil {
        return user, nil
    }

    user, err := s.repo.FindByID(fetchCtx, userID)
    if err != nil {
        return nil, err
    }

    go s.toCache(context.Background(), cacheKey, user)
    return user, nil
}

func (s *CombinedCacheService) fromCache(ctx context.Context, key string) (*User, error) {
    raw, err := s.redis.Get(ctx, key).Result()
    if err != nil {
        return nil, err
    }
    var u User
    if err := json.Unmarshal([]byte(raw), &u); err != nil {
        s.redis.Del(ctx, key)
        return nil, goredislib.Nil
    }
    return &u, nil
}

func (s *CombinedCacheService) toCache(ctx context.Context, key string, u *User) {
    data, _ := json.Marshal(u)
    jitter := time.Duration(rand.Int63n(int64(s.ttl / 10)))
    s.redis.Set(ctx, key, data, s.ttl+jitter)
}

func (s *CombinedCacheService) InvalidateUser(ctx context.Context, userID int) error {
    key := fmt.Sprintf("user:%d", userID)
    s.sfg.Forget(key)
    return s.redis.Del(ctx, key).Err()
}
```

### 7.4 Node.js — Combined implementation

```javascript
// services/combined-cache.service.js
'use strict';

const Redlock          = require('redlock');
const { SingleFlight } = require('../lib/single-flight');

class CombinedCacheService {
  #redis; #userRepo; #sf; #redlock; #ttlSeconds; #logger;

  constructor({ redis, userRepo, ttlSeconds = 600, logger = console }) {
    this.#redis      = redis;
    this.#userRepo   = userRepo;
    this.#ttlSeconds = ttlSeconds;
    this.#logger     = logger;
    this.#sf         = new SingleFlight();

    this.#redlock = new Redlock([redis], {
      retryCount: 3, retryDelay: 50, retryJitter: 20,
    });
    this.#redlock.on('error', err =>
      this.#logger.error('redlock error', { err: err.message })
    );
  }

  async getUser(userId) {
    const cacheKey = `user:${userId}`;

    // Layer 1: Cache
    const cached = await this.#fromCache(cacheKey);
    if (cached) return cached;

    // Layer 2: SingleFlight — dedup trong process
    const { value: user, shared } = await this.#sf.do(
      cacheKey,
      () => this.#fetchWithLock(userId, cacheKey),
      { timeoutMs: 6000 }
    );

    this.#logger.debug('resolved', { userId, shared });
    return user;
  }

  async #fetchWithLock(userId, cacheKey) {
    const lockKey = `lock:${cacheKey}`;

    // Layer 3: Distributed Lock — dedup across cluster
    let lock;
    try {
      lock = await this.#redlock.acquire([lockKey], 5000);
    } catch (err) {
      this.#logger.warn('lock failed, direct query', { lockKey });
      return this.#userRepo.findById(userId);
    }

    try {
      // Double-check cache
      const cached = await this.#fromCache(cacheKey);
      if (cached) return cached;

      const user = await this.#userRepo.findById(userId);
      if (!user) throw new Error(`User ${userId} not found`);

      setImmediate(() => this.#toCache(cacheKey, user));
      return user;

    } finally {
      await lock.release().catch(err =>
        this.#logger.error('lock release failed', { lockKey, err: err.message })
      );
    }
  }

  async #fromCache(key) {
    try {
      const raw = await this.#redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async #toCache(key, data) {
    const jitter = Math.floor(Math.random() * this.#ttlSeconds * 0.1);
    await this.#redis
      .set(key, JSON.stringify(data), 'EX', this.#ttlSeconds + jitter)
      .catch(err => this.#logger.warn('toCache failed', { key, err: err.message }));
  }

  async invalidateUser(userId) {
    const cacheKey = `user:${userId}`;
    this.#sf.forget(cacheKey);
    await this.#redis.del(cacheKey);
  }
}

module.exports = { CombinedCacheService };
```

---

## 8. Ưu / Nhược điểm & Khi nào dùng cái nào

### SingleFlight

**✅ Ưu điểm:**
- Zero external dependency — hoàn toàn in-memory, không cần Redis
- Latency overhead gần như bằng 0
- Đơn giản, dễ implement, dễ test
- Tự động cleanup sau khi request hoàn thành
- Resilient: Redis down không ảnh hưởng gì

**❌ Nhược điểm:**
- Chỉ bảo vệ trong 1 process — không hiệu quả khi scale nhiều instance
- Shared error: 1 lỗi DB lan ra tất cả goroutine/Promise đang chờ
- Context cancellation cần xử lý cẩn thận (Golang)
- Node.js: cần tự implement, không có native support

---

### Redis Distributed Lock

**✅ Ưu điểm:**
- Bảo vệ toàn cluster — guarantee chỉ 1 DB query dù có N instances
- Phù hợp microservices, Kubernetes với nhiều replica
- Có thể extend lock TTL nếu operation chậm
- Kiểm soát chính xác ai được quyền chạy tại mọi thời điểm

**❌ Nhược điểm:**
- Thêm network round-trip đến Redis cho mỗi cache miss
- Redis là single point of failure (có thể dùng Redlock với nhiều Redis nodes)
- Lock contention cao nếu không tune retry/TTL cẩn thận
- Phức tạp: phải handle lock expiry, release trong finally, extend
- Chi phí vận hành Redis cluster cao hơn

---

### Khi nào dùng cái nào?

| Tình huống | Khuyến nghị | Lý do |
|---|---|---|
| Single instance / monolith | **SingleFlight** | Đơn giản, không overhead |
| 2–3 instances, DB chịu được tải | **SingleFlight** | Distributed lock overkill |
| 5+ instances, DB expensive | **Distributed Lock** | Cần cross-instance protection |
| Microservices nhiều replicas | **SingleFlight + Lock** | Tận dụng cả hai lớp |
| Redis không ổn định / latency cao | **SingleFlight** | Không phụ thuộc Redis |
| Guarantee chỉ 1 DB query toàn cluster | **Distributed Lock** bắt buộc | SingleFlight không đảm bảo |
| Write-once / critical idempotent resource | **Distributed Lock** bắt buộc | Cần đảm bảo correctness |

> **Nguyên tắc thực tế:** Bắt đầu với **SingleFlight**. Monitor số lượng DB queries khi scale. Chỉ thêm **Distributed Lock** khi đo được stampede thực sự xảy ra across instances.

---

## 9. Observability & Monitoring

### Golang — Prometheus metrics

```go
var (
    cacheHits        = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "cache_hits_total"},           []string{"resource"})
    cacheMisses      = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "cache_misses_total"},         []string{"resource"})
    sfShared         = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "singleflight_shared_total"},  []string{"resource"})
    lockAcquired     = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "lock_acquired_total"},        []string{"resource", "result"})
    dbDuration       = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "db_query_duration_seconds", Buckets: prometheus.DefBuckets}, []string{"resource"})
    lockWaitDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "lock_wait_duration_seconds", Buckets: prometheus.DefBuckets}, []string{"resource"})
)

func (s *CombinedCacheService) GetUserInstrumented(ctx context.Context, userID int) (*User, error) {
    cacheKey := fmt.Sprintf("user:%d", userID)

    if user, err := s.fromCache(ctx, cacheKey); err == nil {
        cacheHits.WithLabelValues("user").Inc()
        return user, nil
    }
    cacheMisses.WithLabelValues("user").Inc()

    val, err, shared := s.sfg.Do(cacheKey, func() (interface{}, error) {
        lockStart := time.Now()
        mutex := s.rs.NewMutex("lock:"+cacheKey,
            redsync.WithExpiry(5*time.Second),
            redsync.WithTries(3),
        )

        fetchCtx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
        defer cancel()

        if lockErr := mutex.LockContext(fetchCtx); lockErr != nil {
            lockAcquired.WithLabelValues("user", "fail").Inc()
            return s.repo.FindByID(fetchCtx, userID)
        }
        lockAcquired.WithLabelValues("user", "success").Inc()
        lockWaitDuration.WithLabelValues("user").Observe(time.Since(lockStart).Seconds())
        defer mutex.UnlockContext(context.Background())

        if user, err := s.fromCache(fetchCtx, cacheKey); err == nil {
            return user, nil
        }

        dbStart := time.Now()
        user, err := s.repo.FindByID(fetchCtx, userID)
        dbDuration.WithLabelValues("user").Observe(time.Since(dbStart).Seconds())
        if err != nil {
            return nil, err
        }
        go s.toCache(context.Background(), cacheKey, user)
        return user, nil
    })

    if shared {
        sfShared.WithLabelValues("user").Inc()
    }
    if err != nil {
        return nil, err
    }
    return val.(*User), nil
}
```

### Prometheus Alert Rules

```yaml
groups:
  - name: cache_stampede_protection
    rules:
      - alert: HighCacheMissRate
        expr: rate(cache_misses_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m])) > 0.5
        for: 2m
        annotations:
          summary: "Cache miss rate > 50% — possible stampede"

      - alert: HighLockFailRate
        expr: rate(lock_acquired_total{result="fail"}[5m]) > 10
        for: 1m
        annotations:
          summary: "Lock acquisition failing > 10/s — Redis overload hoặc contention"

      - alert: DBQueryLatencySpike
        expr: histogram_quantile(0.99, rate(db_query_duration_seconds_bucket[5m])) > 2
        for: 2m
        annotations:
          summary: "DB p99 > 2s — kiểm tra stampede hoặc slow query"

      - alert: SingleFlightHighSharedRate
        expr: rate(singleflight_shared_total[5m]) / rate(cache_misses_total[5m]) > 0.8
        for: 2m
        annotations:
          summary: "80%+ requests đang chờ singleflight — có thể DB query quá chậm"
```

---

## 10. Checklist production

```
SingleFlight — Golang:
  ☐ Tạo context độc lập trong sfg.Do() (không dùng caller's context)
  ☐ Log shared flag khi error xảy ra để phân biệt nguồn lỗi
  ☐ TTL jitter để tránh herd expiry
  ☐ Gọi sfg.Forget() khi invalidate cache
  ☐ setCache() chạy trong goroutine riêng (không block caller)
  ☐ Fallback xuống DB nếu Redis timeout/lỗi

SingleFlight — Node.js:
  ☐ Wrap fn() với timeout (Promise.race)
  ☐ Clone error khi re-throw cho shared callers
  ☐ TTL jitter khi set Redis
  ☐ Gọi sf.forget() khi invalidate
  ☐ setImmediate() để cache async, không block event loop
  ☐ Monitor size của inFlight Map

Distributed Lock — Golang:
  ☐ Luôn set lock expiry (WithExpiry)
  ☐ defer mutex.UnlockContext() trong releaseCtx riêng
  ☐ Double-check cache sau khi acquire lock
  ☐ Fallback nếu lock fail (không return error cứng)
  ☐ Giới hạn retry (WithTries ≤ 5)
  ☐ Tạo fetchCtx riêng cho DB query (tách khỏi caller context)
  ☐ Extend lock nếu DB query có thể vượt lock TTL

Distributed Lock — Node.js:
  ☐ Handle redlock 'error' event
  ☐ try/finally để đảm bảo lock.release() luôn chạy
  ☐ Double-check cache sau khi acquire lock
  ☐ Fallback nếu acquire fail
  ☐ retryJitter để tránh thundering herd khi retry

Chung:
  ☐ Key đủ specific, không có timestamp
  ☐ Hash key nếu params phức tạp (SHA-256 truncated)
  ☐ Metrics: hit/miss ratio, shared counter, lock acquired/fail, DB latency
  ☐ Alert: cache miss rate, lock fail rate, DB latency spike, sf shared rate
  ☐ Integration test: simulate concurrent requests để verify dedup behaviour
```

---

> **Tóm lại:** `SingleFlight` và `Distributed Lock` giải quyết Cache Stampede ở **phạm vi khác nhau** — một cái trong process, một cái toàn cluster. SingleFlight nhanh, đơn giản, không overhead. Distributed Lock chắc chắn hơn nhưng phức tạp và phụ thuộc Redis. Trong production với nhiều instance, **kết hợp cả hai** là pattern tối ưu: SingleFlight giảm tải tranh chấp cho Redis lock, Distributed Lock đảm bảo correctness across cluster.
