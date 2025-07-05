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

## 🔄 Redis Sentinel - High Availability Setup

### Lợi ích của Redis Sentinel

Redis Sentinel là một hệ thống giám sát và quản lý tự động cho Redis, cung cấp các lợi ích sau:

#### 1. **High Availability (Tính khả dụng cao)**
- **Automatic Failover**: Tự động chuyển đổi từ master sang slave khi master gặp sự cố
- **Zero Downtime**: Ứng dụng không bị gián đoạn khi có sự cố xảy ra
- **Service Discovery**: Tự động phát hiện và cập nhật thông tin master/slave

#### 2. **Monitoring & Alerting (Giám sát và cảnh báo)**
- **Health Checks**: Liên tục kiểm tra trạng thái của master và slave nodes
- **Real-time Monitoring**: Giám sát real-time về performance và availability
- **Automatic Notifications**: Gửi cảnh báo khi có sự cố xảy ra

#### 3. **Configuration Management (Quản lý cấu hình)**
- **Centralized Configuration**: Quản lý cấu hình tập trung
- **Dynamic Updates**: Cập nhật cấu hình mà không cần restart
- **Consistency**: Đảm bảo tính nhất quán giữa các nodes

#### 4. **Scalability (Khả năng mở rộng)**
- **Horizontal Scaling**: Dễ dàng thêm/bớt Redis nodes
- **Load Distribution**: Phân tán tải giữa master và slave
- **Geographic Distribution**: Phân tán địa lý để giảm latency

### Setup Redis Sentinel với Docker

#### 1. **Tạo docker-compose file cho Redis Sentinel**

```yaml
# docker-compose-sentinel.yml
version: '3.8'

services:
  # Redis Master
  redis-master:
    image: redis:7-alpine
    container_name: redis-master
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis-master-data:/data
    networks:
      - redis-network

  # Redis Slave 1
  redis-slave-1:
    image: redis:7-alpine
    container_name: redis-slave-1
    ports:
      - "6380:6379"
    command: redis-server --appendonly yes --slaveof redis-master 6379
    volumes:
      - redis-slave-1-data:/data
    depends_on:
      - redis-master
    networks:
      - redis-network

  # Redis Slave 2
  redis-slave-2:
    image: redis:7-alpine
    container_name: redis-slave-2
    ports:
      - "6381:6379"
    command: redis-server --appendonly yes --slaveof redis-master 6379
    volumes:
      - redis-slave-2-data:/data
    depends_on:
      - redis-master
    networks:
      - redis-network

  # Sentinel 1
  redis-sentinel-1:
    image: redis:7-alpine
    container_name: redis-sentinel-1
    ports:
      - "26379:26379"
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    depends_on:
      - redis-master
      - redis-slave-1
      - redis-slave-2
    networks:
      - redis-network

  # Sentinel 2
  redis-sentinel-2:
    image: redis:7-alpine
    container_name: redis-sentinel-2
    ports:
      - "26380:26379"
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    depends_on:
      - redis-master
      - redis-slave-1
      - redis-slave-2
    networks:
      - redis-network

  # Sentinel 3
  redis-sentinel-3:
    image: redis:7-alpine
    container_name: redis-sentinel-3
    ports:
      - "26381:26379"
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    depends_on:
      - redis-master
      - redis-slave-1
      - redis-slave-2
    networks:
      - redis-network

volumes:
  redis-master-data:
  redis-slave-1-data:
  redis-slave-2-data:

networks:
  redis-network:
    driver: bridge
```

#### 2. **Tạo file cấu hình Sentinel**

```conf
# sentinel.conf
port 26379
dir /tmp

# Định nghĩa master
sentinel monitor mymaster redis-master 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 10000

# Cấu hình authentication (nếu cần)
# sentinel auth-pass mymaster your_password

# Cấu hình log
loglevel notice
logfile ""

# Cấu hình network
bind 0.0.0.0
protected-mode no
```

#### 3. **Khởi chạy Redis Sentinel**

```bash
# Khởi chạy tất cả services
docker-compose -f docker-compose-sentinel.yml up -d

# Kiểm tra trạng thái
docker-compose -f docker-compose-sentinel.yml ps

# Xem logs của sentinel
docker-compose -f docker-compose-sentinel.yml logs redis-sentinel-1
```

### Setup Redis Sentinel trong Golang

#### 1. **Cài đặt dependencies**

```bash
go get github.com/redis/go-redis/v9
```

#### 2. **Cấu hình Redis Client với Sentinel**

```go
// internal/initiallize/redis.go
package initiallize

import (
    "github.com/redis/go-redis/v9"
    "ecom/global"
)

func InitRedis() {
    // Cấu hình Redis Sentinel
    rdb := redis.NewFailoverClient(&redis.FailoverOptions{
        MasterName:    "mymaster",                    // Tên master trong sentinel config
        SentinelAddrs: []string{                      // Danh sách địa chỉ sentinel
            "localhost:26379",
            "localhost:26380", 
            "localhost:26381",
        },
        // Cấu hình connection pool
        PoolSize:     10,
        MinIdleConns: 5,
        // Cấu hình timeout
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
        // Cấu hình retry
        MaxRetries:   3,
        // Cấu hình authentication (nếu cần)
        // Password: "your_password",
    })

    // Test connection
    ctx := context.Background()
    err := rdb.Ping(ctx).Err()
    if err != nil {
        global.Logger.Fatal("Failed to connect to Redis Sentinel", zap.Error(err))
    }

    global.Rdb = rdb
    global.Logger.Info("Redis Sentinel connected successfully")
}
```

#### 3. **Tạo Redis Service với Sentinel Support**

```go
// internal/service/redis/impl/redis_sentinel_impl.go
package impl

import (
    "context"
    "time"
    "github.com/redis/go-redis/v9"
    "go.uber.org/zap"
)

type RedisSentinelImpl struct {
    client *redis.Client
}

func NewRedisSentinelImpl(client *redis.Client) *RedisSentinelImpl {
    return &RedisSentinelImpl{
        client: client,
    }
}

// GetMasterInfo lấy thông tin master hiện tại
func (r *RedisSentinelImpl) GetMasterInfo(ctx context.Context) (string, error) {
    return r.client.SentinelGetMasterAddrByName(ctx, "mymaster").Result()
}

// GetSlaveInfo lấy thông tin tất cả slaves
func (r *RedisSentinelImpl) GetSlaveInfo(ctx context.Context) ([]map[string]string, error) {
    return r.client.SentinelSlaves(ctx, "mymaster").Result()
}

// GetSentinelInfo lấy thông tin tất cả sentinels
func (r *RedisSentinelImpl) GetSentinelInfo(ctx context.Context) ([]map[string]string, error) {
    return r.client.SentinelSentinels(ctx, "mymaster").Result()
}

// HealthCheck kiểm tra sức khỏe của Redis cluster
func (r *RedisSentinelImpl) HealthCheck(ctx context.Context) error {
    return r.client.Ping(ctx).Err()
}

// Các method cơ bản
func (r *RedisSentinelImpl) Get(key string) (string, error) {
    return r.client.Get(context.Background(), key).Result()
}

func (r *RedisSentinelImpl) Set(key string, value interface{}, expiration time.Duration) error {
    return r.client.Set(context.Background(), key, value, expiration).Err()
}

func (r *RedisSentinelImpl) Del(key string) error {
    return r.client.Del(context.Background(), key).Err()
}

func (r *RedisSentinelImpl) Exists(key string) (bool, error) {
    result, err := r.client.Exists(context.Background(), key).Result()
    return result > 0, err
}
```

#### 4. **Tạo Health Check Endpoint**

```go
// internal/controller/health/health.controller.go
package health

import (
    "github.com/gin-gonic/gin"
    "ecom/internal/service/redis"
    "ecom/pkg/response"
)

type HealthController struct {
    redisService redis.RedisService
}

func (c *HealthController) RedisHealth(ctx *gin.Context) {
    // Kiểm tra kết nối Redis
    err := c.redisService.HealthCheck(ctx)
    if err != nil {
        response.FailWithMessage(ctx, "Redis connection failed: "+err.Error())
        return
    }

    // Lấy thông tin master
    masterAddr, err := c.redisService.GetMasterInfo(ctx)
    if err != nil {
        response.FailWithMessage(ctx, "Failed to get master info: "+err.Error())
        return
    }

    // Lấy thông tin slaves
    slaves, err := c.redisService.GetSlaveInfo(ctx)
    if err != nil {
        response.FailWithMessage(ctx, "Failed to get slave info: "+err.Error())
        return
    }

    response.OkWithData(ctx, gin.H{
        "status":      "healthy",
        "master":      masterAddr,
        "slave_count": len(slaves),
        "slaves":      slaves,
    })
}
```

#### 5. **Cấu hình Environment Variables**

```env
# .env
REDIS_SENTINEL_MASTER_NAME=mymaster
REDIS_SENTINEL_ADDRS=localhost:26379,localhost:26380,localhost:26381
REDIS_PASSWORD=your_password_if_needed
REDIS_POOL_SIZE=10
REDIS_MIN_IDLE_CONNS=5
```

```yaml
# config/development.yml
redis:
  sentinel:
    master_name: ${REDIS_SENTINEL_MASTER_NAME}
    addrs: ${REDIS_SENTINEL_ADDRS}
    password: ${REDIS_PASSWORD}
    pool_size: ${REDIS_POOL_SIZE}
    min_idle_conns: ${REDIS_MIN_IDLE_CONNS}
```

### Testing Redis Sentinel

#### 1. **Test Failover**

```bash
# Dừng master node
docker-compose -f docker-compose-sentinel.yml stop redis-master

# Kiểm tra logs để xem quá trình failover
docker-compose -f docker-compose-sentinel.yml logs redis-sentinel-1

# Kiểm tra trạng thái mới
docker exec -it redis-sentinel-1 redis-cli -p 26379 sentinel master mymaster
```

#### 2. **Test Connection từ Golang**

```go
// tests/redis_sentinel_test.go
package tests

import (
    "context"
    "testing"
    "time"
    "github.com/redis/go-redis/v9"
)

func TestRedisSentinelConnection(t *testing.T) {
    client := redis.NewFailoverClient(&redis.FailoverOptions{
        MasterName: "mymaster",
        SentinelAddrs: []string{
            "localhost:26379",
            "localhost:26380",
            "localhost:26381",
        },
    })

    ctx := context.Background()
    
    // Test basic operations
    err := client.Set(ctx, "test_key", "test_value", time.Minute).Err()
    if err != nil {
        t.Fatalf("Failed to set key: %v", err)
    }

    val, err := client.Get(ctx, "test_key").Result()
    if err != nil {
        t.Fatalf("Failed to get key: %v", err)
    }

    if val != "test_value" {
        t.Fatalf("Expected 'test_value', got '%s'", val)
    }

    // Test master info
    masterAddr, err := client.SentinelGetMasterAddrByName(ctx, "mymaster").Result()
    if err != nil {
        t.Fatalf("Failed to get master info: %v", err)
    }

    t.Logf("Current master: %v", masterAddr)
}
```

### Monitoring và Logging

#### 1. **Prometheus Metrics**

```go
// internal/middleware/redis_metrics.go
package middleware

import (
    "github.com/gin-gonic/gin"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    redisOperationsTotal = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "redis_operations_total",
            Help: "Total number of Redis operations",
        },
        []string{"operation", "status"},
    )

    redisOperationDuration = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "redis_operation_duration_seconds",
            Help:    "Duration of Redis operations",
            Buckets: prometheus.DefBuckets,
        },
        []string{"operation"},
    )
)

func RedisMetricsMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        
        c.Next()
        
        duration := time.Since(start).Seconds()
        status := "success"
        if c.Writer.Status() >= 400 {
            status = "error"
        }
        
        redisOperationsTotal.WithLabelValues("http_request", status).Inc()
        redisOperationDuration.WithLabelValues("http_request").Observe(duration)
    }
}
```

#### 2. **Structured Logging**

```go
// internal/service/redis/impl/redis_sentinel_impl.go
func (r *RedisSentinelImpl) Get(key string) (string, error) {
    start := time.Now()
    result, err := r.client.Get(context.Background(), key).Result()
    duration := time.Since(start)

    global.Logger.Info("Redis GET operation",
        zap.String("key", key),
        zap.Duration("duration", duration),
        zap.Error(err),
    )

    return result, err
}
```
