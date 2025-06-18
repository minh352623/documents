---
sidebar_position: 4
title: Redis
description: Redis
---

## Redis Distributed Lock
### Cài đặt package và function cần thiết cho WithDistributedLock

**Cài đặt package:**

```bash
go get github.com/bsm/redislock
go get github.com/redis/go-redis/v9
go get go.uber.org/zap
```

**Ví dụ khởi tạo function và struct:**

```go
import (
    "context"
    "github.com/bsm/redislock"
    "github.com/redis/go-redis/v9"
    "go.uber.org/zap"
)

type redisImpl struct {
    client *redis.Client
    locker *redislock.Client
}

func NewRedisServiceImpl(client *redis.Client) *redisImpl {
    return &redisImpl{
        client: client,
        locker: redislock.New(client),
    }
}

func (r *redisImpl) WithDistributedLock(ctx context.Context, key string, ttlSeconds int64, fn func(ctx context.Context) error) error {
    lockTTL := time.Duration(ttlSeconds) * time.Second
    lock, err := r.locker.Obtain(ctx, key, lockTTL, nil)
    if err == redislock.ErrNotObtained {
        // Xử lý khi không lấy được lock
        return fmt.Errorf("could not obtain lock!")
    }
    if err != nil {
        return fmt.Errorf("could obtain lock! %s", err)
    }
    defer lock.Release(ctx)
    return fn(ctx)
}
```

### Sử dụng WithDistributedLock (Khóa phân tán Redis)

`WithDistributedLock` giúp bạn thực thi một đoạn code với đảm bảo chỉ một tiến trình được thực thi tại một thời điểm dựa trên khóa Redis.

**Cách sử dụng:**

```go
err := redisService.WithDistributedLock(ctx, "ten_khoa", 10, func(ctx context.Context) error {
    // Đặt code cần thực thi bên trong đây
    // Ví dụ: cập nhật số dư tài khoản, gửi thông báo, ...
    return nil
})
if err != nil {
    // Xử lý khi không lấy được lock hoặc lỗi khác
    log.Println("Không thể lấy lock:", err)
}
```

- `key`: Tên khóa Redis dùng để lock (nên đặt duy nhất cho từng tài nguyên cần bảo vệ).
- `ttlSeconds`: Thời gian giữ lock (tính bằng giây).
- `fn`: Hàm sẽ được thực thi khi lấy được lock.

Nếu không lấy được lock, hàm sẽ trả về lỗi để bạn xử lý phù hợp.
