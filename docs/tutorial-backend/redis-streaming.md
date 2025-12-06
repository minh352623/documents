---
sidebar_position: 8
title: Redis Streaming
description: Redis Streaming
---

## Giới thiệu Redis Streams

Redis Streams là cấu trúc dữ liệu dạng log theo thời gian (append-only) cho phép ghi và đọc các sự kiện theo thứ tự với ID tăng dần. Streams hỗ trợ cơ chế consumer groups để nhiều consumer cùng đọc, mỗi consumer nhận một phần công việc đảm bảo không bị trùng lặp khi xử lý. Khác với Pub/Sub (mất tin nếu không online), Streams lưu trữ sự kiện để các consumer có thể đọc lại, đảm bảo độ tin cậy cao hơn cho hệ thống xử lý sự kiện.

- Mỗi bản ghi (entry) có dạng `ID -> { field: value, ... }`.
- Hỗ trợ `XADD` (ghi), `XREAD`/`XREADGROUP` (đọc), `XACK` (xác nhận), `XPENDING` (kiểm tra bản ghi chưa xử lý), `XCLAIM` (nhận lại bản ghi đang pending), `XTRIM` (cắt ngắn stream theo chiến lược lưu trữ).
- Consumer Group: tạo bằng `XGROUP CREATE`, cho phép điều phối bản ghi tới các consumer trong cùng nhóm.
- Bền vững: dữ liệu được lưu, có thể đọc lại sau downtime, phù hợp cho các pipeline xử lý bất đồng bộ, event-driven.

Khi nào nên dùng Streams thay vì Pub/Sub?
- Cần đảm bảo không bỏ lỡ sự kiện ngay cả khi consumer tạm thời offline.
- Cần khả năng scale nhiều worker và theo dõi trạng thái xử lý từng sự kiện.
- Cần reprocessing hoặc backfill dữ liệu lịch sử.

## Trường hợp sử dụng phù hợp

- Hàng đợi công việc (job queue) đáng tin cậy với xác nhận xử lý (`XACK`).
- Event sourcing và log sự kiện nghiệp vụ theo thời gian.
- Xử lý nền: gửi email, thông báo, tạo báo cáo, resize ảnh.
- Phân tích thời gian thực: thu thập metric, telemetry từ IoT hoặc ứng dụng.
- Chat/messaging có lưu trữ để replay khi cần.
- Outbox pattern: ghi sự kiện thay đổi DB ra stream, hệ khác tiêu thụ.
- Đồng bộ giữa dịch vụ microservices, tránh mất dữ liệu khi một dịch vụ tạm ngừng.

## Example với Node.js (ioredis)

Cài đặt:
```bash
npm install ioredis
```

Producer: ghi sự kiện vào stream `orders-stream`.
```ts
// producer.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const STREAM_KEY = 'orders-stream';

async function produce() {
  const id = await redis.xadd(
    STREAM_KEY,
    '*',
    'type', 'order.created',
    'orderId', '12345',
    'amount', '99000',
  );
  console.log('Produced entry id:', id);
}

produce()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
```

Consumer Group: tạo group và đọc bằng `XREADGROUP`.
```ts
// consumer.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const STREAM_KEY = 'orders-stream';
const GROUP = 'order-workers';
const CONSUMER = `worker-${Math.random().toString(16).slice(2)}`;

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP, '$', 'MKSTREAM');
    console.log('Group created');
  } catch (e: any) {
    // Nhóm đã tồn tại sẽ lỗi, bỏ qua
    if (!String(e.message).includes('BUSYGROUP')) throw e;
  }
}

async function consume() {
  await ensureGroup();
  while (true) {
    const res = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER,
      'BLOCK', 5000,       // block 5s
      'COUNT', 10,         // đọc tối đa 10 bản ghi/lần
      'STREAMS', STREAM_KEY,
      '>'                  // chỉ lấy bản ghi mới
    );

    if (!res) continue; // timeout

    for (const [stream, entries] of res) {
      for (const [id, fields] of entries as any[]) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        console.log('Processing id:', id, obj);

        // TODO: xử lý nghiệp vụ

        // xác nhận đã xử lý
        await redis.xack(stream, GROUP, id);
      }
    }
  }
}

consume().catch(err => { console.error(err); process.exit(1); });
```

Một số lệnh hữu ích:
- `XPENDING orders-stream order-workers` để xem pending entries.
- `XCLAIM` để claim lại message lâu chưa xử lý từ consumer khác.
- `XTRIM orders-stream MAXLEN ~ 100000` để cắt giảm kích thước stream.

## Example với Golang (go-redis v9)

Cài đặt:
```bash
go get github.com/redis/go-redis/v9
```

Producer: ghi sự kiện vào stream.
```go
// producer.go
package main

import (
    "context"
    "fmt"
    "github.com/redis/go-redis/v9"
)

const STREAM_KEY = "orders-stream"

func main() {
    ctx := context.Background()
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})

    args := &redis.XAddArgs{
        Stream: STREAM_KEY,
        ID:     "*",
        Values: map[string]interface{}{
            "type":    "order.created",
            "orderId": "12345",
            "amount":  99000,
        },
    }

    id, err := rdb.XAdd(ctx, args).Result()
    if err != nil {
        panic(err)
    }
    fmt.Println("Produced entry id:", id)
}
```

Consumer Group: tạo group và đọc.
```go
// consumer.go
package main

import (
    "context"
    "fmt"
    "time"
    "github.com/redis/go-redis/v9"
)

const (
    STREAM_KEY = "orders-stream"
    GROUP      = "order-workers"
    CONSUMER   = "worker-1"
)

func main() {
    ctx := context.Background()
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})

    // Tạo group nếu chưa có (MKSTREAM để tự tạo stream nếu chưa tồn tại)
    if err := rdb.XGroupCreateMkStream(ctx, STREAM_KEY, GROUP, "$ ").Err(); err != nil {
        if err.Error() != "BUSYGROUP Consumer Group name already exists" {
            // Nếu lỗi khác BUSYGROUP thì báo lỗi
            panic(err)
        }
    }

    for {
        res, err := rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
            Group:    GROUP,
            Consumer: CONSUMER,
            Streams:  []string{STREAM_KEY, ">"},
            Count:    10,
            Block:    time.Second * 5,
            NoAck:    false,
        }).Result()
        if err != nil && err != redis.Nil {
            panic(err)
        }

        if len(res) == 0 {
            continue // timeout
        }

        for _, str := range res {
            for _, msg := range str.Messages {
                fmt.Printf("Processing id=%s values=%v\n", msg.ID, msg.Values)

                // TODO: xử lý nghiệp vụ

                if err := rdb.XAck(ctx, STREAM_KEY, GROUP, msg.ID).Err(); err != nil {
                    fmt.Println("XAck error:", err)
                }
            }
        }
    }
}
```

Quản lý dữ liệu và dung lượng:
- Dùng `XTRIM` với `MAXLEN ~` để giữ tối đa một số lượng bản ghi, giảm chi phí lưu trữ.
- Theo dõi `XPENDING` để xử lý những bản ghi bị treo quá lâu (có thể dùng `XCLAIM`).
- Lưu ý cấu hình persistence của Redis (AOF/RDB) để đảm bảo dữ liệu Streams được lưu ổn định.

## Gợi ý triển khai sản xuất

- Đặt key theo domain, ví dụ: `serviceA:orders` để dễ quản lý.
- Thiết kế retry với dead-letter stream khi xử lý thất bại nhiều lần.
- Giám sát metrics: độ trễ đọc, số lượng pending, tỉ lệ lỗi.
- Kết hợp Redis Sentinel/Cluster để đảm bảo HA và khả năng mở rộng.
- Cân nhắc trimming theo kích thước hợp lý để tránh quá tải bộ nhớ.
