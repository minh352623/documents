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

---

## Redis 8.4: Cách mạng hóa Stream và OCC - Khi sự đơn giản định nghĩa lại Hiệu suất hệ thống

Trong giới kiến trúc phần mềm, sự phức tạp là kẻ thù của hiệu suất. Việc triển khai các logic như Kiểm soát đồng thời lạc quan (Optimistic Concurrency Control - OCC) hay quản lý vòng đời tin nhắn trong Streams vốn là những bài toán "kinh điển" khiến lập trình viên phải đau đầu với hàng tá dòng kịch bản Lua hoặc các chuỗi lệnh WATCH/MULTI/EXEC rườm rà.

Redis 8.4 không chỉ là một bản cập nhật tính năng thông thường; đây là một bước chuyển mình chiến lược. Với tư cách là một Kỹ sư Giải pháp, tôi đánh giá phiên bản này là lời giải cho việc tối ưu hóa luồng dữ liệu thông qua sự tinh gọn tuyệt đối, cho phép các nhà phát triển đạt được tính nguyên tử (atomicity) mà không cần đánh đổi bằng sự phức tạp của mã nguồn.

### 1. Đột phá Stream: Xử lý tin nhắn tồn đọng và "Poison Pills" trong một lệnh duy nhất

Quản lý tin nhắn tồn đọng (pending messages) luôn là điểm yếu trong các hệ thống phân tán. Trước Redis 8.4, để đảm bảo không có tin nhắn nào bị "rơi", bạn phải duy trì một vòng lặp phức tạp: gọi `XPENDING` để quét, `XAUTOCLAIM` để nhận quyền xử lý tin nhắn cũ (idle pending), và sau đó mới gọi `XREADGROUP` để lấy tin nhắn mới.

Đặc biệt, trong môi trường Redis Cluster, "nỗi đau" này còn lớn hơn vì các lệnh bổ trợ như `XPENDING` không hỗ trợ đa khóa (multi-keys), buộc bạn phải thực hiện nhiều lời gọi riêng biệt, gây ra Overhead cực lớn cho mạng.

**Giải pháp chiến lược từ Redis 8.4:**

Lệnh `XREADGROUP` giờ đây được trang bị đối số `CLAIM <min-idle-time>`, cho phép hợp nhất quy trình trên thành một thao tác nguyên tử duy nhất:

*   **Cơ chế hoạt động:** Redis sẽ ưu tiên kiểm tra các tin nhắn trong PEL (Pending Entries List) đã quá hạn. Nếu tìm thấy, nó sẽ "claim" và trả về ngay lập tức. Nếu không, nó mới tiếp tục tiêu thụ tin nhắn mới.
*   **Điều kiện tiên quyết:** Đối số `CLAIM` chỉ có hiệu lực khi ID được chỉ định là `>` (tin nhắn mới). Nếu ID không phải là `>`, tham số này sẽ bị bỏ qua.
*   **Kiểm soát tin nhắn độc hại (Poison Pills):** Giúp xử lý các tin nhắn gây lỗi lặp đi lặp lại.

**Lợi ích:** Tối ưu hóa RTT (Round Trip Time) và giải quyết triệt để bài toán xử lý đa stream trên Cluster.

### 2. Optimistic Concurrency Control: Khai tử Lua Script cho các thao tác đơn lẻ

Mô hình "Read-Modify-Write" là xương sống của OCC. Để đảm bảo tính nhất quán dữ liệu ở quy mô lớn mà không làm khóa (lock) hệ thống, chúng ta thường dùng Lua Script để kiểm tra giá trị cũ trước khi ghi giá trị mới. Tuy nhiên, việc phải parse và thực thi Lua script trên server tạo ra một tải trọng CPU không đáng có.

Redis 8.4 giới thiệu các đối số so sánh trực tiếp giúp thực hiện OCC nguyên tử trên một khóa (single-key) cực kỳ đơn giản:

*   **SET với IFEQ (Match-value):** Thực hiện `SET <key> <newValue> IFEQ <oldValue>`. Lệnh chỉ thành công nếu giá trị hiện tại trên server khớp chính xác với `oldValue`.
*   **DELEX (Compare-and-delete):** Một lệnh hoàn toàn mới giúp xóa khóa chỉ khi thỏa mãn điều kiện `IFEQ` hoặc `IFDEQ`.

**Ví dụ:** Khi cập nhật `Product:Description`, thay vì gửi một đoạn kịch bản Lua, bạn chỉ cần gửi một lệnh `SET` kèm giá trị cũ. Nếu một client khác đã nhanh tay cập nhật trước, lệnh sẽ thất bại, đảm bảo tính toàn vẹn dữ liệu với chi phí vận hành thấp nhất.

### 3. Cơ chế Digest: Kiến trúc tối ưu băng thông cho Big Data

Khi giá trị lưu trữ là các chuỗi JSON khổng lồ hoặc các tệp nhị phân (BLOB), việc tải toàn bộ "giá trị cũ" về client để so sánh là một sự lãng phí băng thông và bộ nhớ khủng khiếp.

Redis 8.4 giải quyết vấn đề này bằng thuật toán băm XXH3 siêu nhanh thông qua cơ chế Digest:

1.  **Lấy dấu vân tay:** Client gọi lệnh `DIGEST` để lấy mã băm của giá trị trên server thay vì lấy toàn bộ dữ liệu.
2.  **Xử lý cục bộ:** Thực hiện các thay đổi dữ liệu cần thiết ở phía client.
3.  **Cập nhật thông minh:** Gửi lệnh `SET <key> <newValue> IFDEQ <match-digest>`.

Server sẽ tự tính toán hash của giá trị hiện tại và so sánh với `match-digest`. Điều này cho phép bạn duy trì khả năng kiểm soát đồng thời lạc quan mà không cần di chuyển các khối dữ liệu lớn qua mạng, cực kỳ hiệu quả cho các hệ thống xử lý dữ liệu lớn.

### 4. MSETEX: Quyền năng thiết lập hàng loạt và quản lý vòng đời

Việc tạo nhiều khóa đồng thời kèm theo thời gian hết hạn (TTL) trước đây thường buộc người dùng phải quay lại với Lua hoặc thực hiện nhiều vòng lệnh. `MSETEX` ra đời để thay thế hoàn toàn `MSET` và `MSETNX` bằng cách tích hợp khả năng quản lý vòng đời mạnh mẽ.

| Tính năng | Đối số hỗ trợ |
| :--- | :--- |
| **Điều kiện thực thi** | `NX` (chỉ tạo mới), `XX` (chỉ cập nhật khóa đã có) |
| **Quản lý thời gian (TTL)** | `EX`, `PX`, `EXAT`, `PXAT`, `PERSIST` |

Sử dụng `MSETEX` giúp giảm thiểu số lượng RTT tới server, đặc biệt hữu ích khi cần khởi tạo nhanh một tập hợp các session hoặc cache items có cùng thời gian sống. Đây là công cụ đắc lực để tối ưu hóa hiệu suất ứng dụng trong các kịch bản tải cao.

---

### Lời kết và Suy ngẫm tương lai

Sức mạnh của Redis 8.4 nằm ở triết lý: **Hiệu suất thông qua sự đơn giản**. Việc đưa các logic phức tạp như OCC, Digest hay Stream Claim vào thành các lệnh bản địa (native) không chỉ giúp code sạch hơn mà còn giảm thiểu đáng kể Overhead cho hệ thống và CPU server.

Là một kiến trúc sư, câu hỏi đặt ra cho bạn không còn là "làm sao để triển khai logic này?" mà là: *"Liệu việc đơn giản hóa các thao tác nguyên tử này có khiến bạn tự tin loại bỏ hoàn toàn các đoạn mã Lua phức tạp và rườm rà trong hệ thống hiện tại của mình không?"*

Hãy tải ngay Redis 8.4 và bắt đầu tinh gọn hệ thống của bạn từ hôm nay.

### Nguồn tham khảo

- [Simplifying Streams and Strings in Redis](https://redis.io/blog/simplifying-streams-and-strings/?fbclid=IwY2xjawPqaWNleHRuA2FlbQIxMABicmlkETFwbTRlY1FTSkVUb2lsSEF1c3J0YwZhcHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHvivO2WuA4bDKgCL2ZYxg3h2fN1Ba0neRbCnN04o45xXQ-SY3jQb9dJplg1F_aem_tT0FfTef2er7qfRZjrsWYA)
