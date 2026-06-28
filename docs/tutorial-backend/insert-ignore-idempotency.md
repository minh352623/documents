# INSERT IGNORE vs INSERT INTO + UNIQUE KEY: Idempotency Trong Môi Trường Multi-Thread

> **TL;DR:** Cả `INSERT INTO` và `INSERT IGNORE` đều có thể dùng với `UNIQUE KEY`. Điểm khác biệt **không phải** là có hay không có UNIQUE — mà là **cách phản ứng** khi UNIQUE bị vi phạm. Trong môi trường multi-thread, đây là sự khác biệt giữa crash và idempotency.

---

## 1. Idempotency là gì và tại sao quan trọng?

**Idempotency** (tính bất biến kết quả) nghĩa là: dù bạn thực hiện một thao tác **1 lần hay 100 lần**, kết quả cuối cùng vẫn **giống nhau**.

Trong thực tế, đây là vấn đề xảy ra liên tục:

- Kafka consumer retry khi processing thất bại
- HTTP request được gửi lại do timeout
- Nhiều thread/worker cùng xử lý một event
- Webhook từ bên thứ 3 gửi duplicate

Nếu không có idempotency, hậu quả có thể là:

- **Trừ tiền 2 lần** trong hệ thống thanh toán
- **Gửi email 2 lần** đến khách hàng
- **Tạo đơn hàng trùng lặp** trong e-commerce

---

## 2. Schema dùng chung: UNIQUE KEY có mặt ở cả hai

Điểm quan trọng cần hiểu rõ ngay từ đầu: **UNIQUE KEY là constraint trên schema**, không phải đặc quyền của riêng `INSERT IGNORE`. Cả hai cách đều dùng chung một schema:

```sql
-- Schema này dùng cho CẢ HAI trường hợp bên dưới
CREATE TABLE payments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id    VARCHAR(100) NOT NULL,
    amount      DECIMAL(10,2),
    status      VARCHAR(20),
    created_at  DATETIME DEFAULT NOW(),

    UNIQUE KEY uq_order_id (order_id)   -- ← Có mặt ở cả hai cách
);
```

`UNIQUE KEY` nói với database: **"Không bao giờ cho phép 2 row có cùng `order_id`"**. Đây là constraint ở tầng storage engine — luôn được enforce bất kể bạn dùng câu lệnh INSERT nào.

Vậy sự khác biệt nằm ở đâu? Nằm ở **phản ứng** khi constraint bị vi phạm.

---

## 3. INSERT INTO + UNIQUE KEY: Throw Error

Khi vi phạm UNIQUE, `INSERT INTO` ném ra lỗi và **dừng thực thi**:

```sql
-- Lần 1: OK
INSERT INTO payments (order_id, amount, status)
VALUES ('ORD-001', 500.00, 'SUCCESS');
-- Query OK, 1 row affected

-- Lần 2: CRASH
INSERT INTO payments (order_id, amount, status)
VALUES ('ORD-001', 500.00, 'SUCCESS');
-- ERROR 1062 (23000): Duplicate entry 'ORD-001' for key 'uq_order_id'
```

### Trong môi trường multi-thread

```
Timeline với INSERT INTO + UNIQUE KEY:
──────────────────────────────────────────────────────────

T=0ms   Thread 1: Nhận message order_id="ORD-001"
T=1ms   Thread 2: Nhận CÙNG message (do Kafka retry)

T=5ms   Thread 1: INSERT INTO ... → ✅ rows affected = 1
T=6ms   Thread 2: INSERT INTO ... → ❌ ERROR 1062: Duplicate entry!

──────────────────────────────────────────────────────────
```

Bây giờ Thread 2 phải **tự xử lý exception này ở application layer**:

```go
// Go
func processPayment(orderID string, amount float64) error {
    _, err := db.Exec(`
        INSERT INTO payments (order_id, amount, status)
        VALUES (?, ?, 'SUCCESS')
    `, orderID, amount)

    if err != nil {
        // Phải tự parse error để biết đây là duplicate hay lỗi khác
        var mysqlErr *mysql.MySQLError
        if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
            // Duplicate entry → đây là message đã xử lý, bỏ qua
            log.Printf("Order %s already processed (duplicate), skipping", orderID)
            return nil
        }
        // Lỗi khác → propagate lên
        return fmt.Errorf("db error: %w", err)
    }
    return nil
}
```

```typescript
// NestJS
async processPayment(orderId: string, amount: number): Promise<void> {
  try {
    await this.paymentRepo.insert({ orderId, amount, status: 'SUCCESS' });
  } catch (error) {
    // Phải check error code thủ công
    if (error.code === 'ER_DUP_ENTRY') {
      this.logger.log(`Order ${orderId} already processed, skipping`);
      return;
    }
    throw new InternalServerErrorException('Payment processing failed');
  }
}
```

**Vấn đề của cách này:**

- Phải biết MySQL error code `1062` (hoặc `ER_DUP_ENTRY`)
- Logic xử lý duplicate bị trộn lẫn với logic xử lý lỗi thật
- Dễ nhầm hoặc bỏ sót khi maintain sau này
- **Không phải idempotency thực sự** — vẫn có exception flow

---

## 4. INSERT IGNORE + UNIQUE KEY: Silent Skip

`INSERT IGNORE` có cùng UNIQUE KEY, nhưng khi vi phạm constraint, nó **bỏ qua silently** thay vì throw error:

```sql
-- Lần 1: OK
INSERT IGNORE INTO payments (order_id, amount, status)
VALUES ('ORD-001', 500.00, 'SUCCESS');
-- Query OK, 1 row affected

-- Lần 2: Bỏ qua, KHÔNG có error
INSERT IGNORE INTO payments (order_id, amount, status)
VALUES ('ORD-001', 500.00, 'SUCCESS');
-- Query OK, 0 rows affected  ← Không phải error, chỉ là "không có gì thay đổi"
```

### Trong môi trường multi-thread

```
Timeline với INSERT IGNORE + UNIQUE KEY:
──────────────────────────────────────────────────────────

T=0ms   Thread 1: Nhận message order_id="ORD-001"
T=1ms   Thread 2: Nhận CÙNG message (do Kafka retry)

T=5ms   Thread 1: INSERT IGNORE ... → ✅ rows affected = 1 (inserted)
T=6ms   Thread 2: INSERT IGNORE ... → ✅ rows affected = 0 (ignored, no error!)

──────────────────────────────────────────────────────────

Kết quả trong DB:
┌────┬──────────┬────────┬─────────┐
│ id │ order_id │ amount │ status  │
├────┼──────────┼────────┼─────────┤
│  1 │ ORD-001  │ 500.00 │ SUCCESS │  ← Chỉ 1 row duy nhất ✅
└────┴──────────┴────────┴─────────┘
```

Code ở application layer trở nên **rõ ràng và đơn giản hơn**:

```go
// Go
func processPayment(orderID string, amount float64) error {
    result, err := db.Exec(`
        INSERT IGNORE INTO payments (order_id, amount, status)
        VALUES (?, ?, 'SUCCESS')
    `, orderID, amount)
    if err != nil {
        // Đây là lỗi THẬT (network, disk, v.v.), không phải duplicate
        return fmt.Errorf("db error: %w", err)
    }

    rowsAffected, _ := result.RowsAffected()
    if rowsAffected == 0 {
        // Duplicate → đã xử lý rồi, bỏ qua an toàn
        log.Printf("Order %s already processed, skipping", orderID)
        return nil
    }

    // rowsAffected == 1 → insert mới, tiếp tục business logic
    log.Printf("Order %s payment recorded", orderID)
    return nil
}
```

```typescript
// NestJS
async processPayment(orderId: string, amount: number): Promise<void> {
  const result = await this.paymentRepo
    .createQueryBuilder()
    .insert()
    .into(Payment)
    .values({ orderId, amount, status: 'SUCCESS' })
    .orIgnore()   // ← Tương đương INSERT IGNORE
    .execute();

  if (result.raw.affectedRows === 0) {
    this.logger.log(`Order ${orderId} already processed, skipping`);
    return;
  }

  this.logger.log(`Order ${orderId} payment recorded successfully`);
}
```

Không có try/catch cho duplicate. Không cần biết error code. Code tự giải thích.

---

## 5. So sánh trực tiếp: Cùng UNIQUE KEY, khác hành vi

|                              | `INSERT INTO` + UNIQUE           | `INSERT IGNORE` + UNIQUE            |
| ---------------------------- | -------------------------------- | ----------------------------------- |
| **Schema**                   | Giống nhau                       | Giống nhau                          |
| **UNIQUE KEY**               | ✅ Có                            | ✅ Có                               |
| **Khi vi phạm UNIQUE**       | ❌ Throw `ERROR 1062`            | ✅ Silent skip, `rows affected = 0` |
| **`rows_affected`**          | N/A (exception trước khi return) | `1` = inserted, `0` = skipped       |
| **Xử lý tại app layer**      | Phải catch + parse error code    | Chỉ cần check `rows_affected`       |
| **Idempotent flow**          | Có, nhưng qua exception path     | Có, qua happy path                  |
| **Lỗi thật (network, disk)** | ✅ Throw error                   | ✅ Throw error                      |
| **Code complexity**          | Cao hơn (try/catch + error code) | Thấp hơn (if rows == 0)             |

> **Cả hai đều ngăn được duplicate data** nhờ UNIQUE KEY. Sự khác biệt là **developer experience** và **code clarity** khi xử lý duplicate ở application layer.

---

## 6. Cạm bẫy: INSERT IGNORE bỏ qua TẤT CẢ errors, không chỉ duplicate

Đây là điểm quan trọng nhất cần lưu ý khi chọn `INSERT IGNORE`:

```sql
-- ⚠️ INSERT IGNORE cũng IGNORE các lỗi này:

-- 1. Foreign key violation (user_id không tồn tại)
INSERT IGNORE INTO payments (order_id, user_id, amount)
VALUES ('ORD-001', 99999, 500.00);
-- Không có error! Nhưng row KHÔNG được insert nếu FK fail

-- 2. NOT NULL violation
INSERT IGNORE INTO payments (order_id, amount, status)
VALUES (NULL, 500.00, 'SUCCESS');
-- Không có error! Nhưng row KHÔNG được insert

-- 3. Data too long
INSERT IGNORE INTO payments (order_id, amount, status)
VALUES ('ORD-' || REPEAT('X', 500), 500.00, 'SUCCESS');
-- Không có error! Data bị truncate hoặc không insert
```

Khi nào dùng cái gì:

```
Dùng INSERT IGNORE khi:
  ✅ Duplicate là tình huống BÌNH THƯỜNG và được mong đợi
  ✅ Các lỗi khác (FK, NOT NULL) đã được validate trước ở app layer
  ✅ Muốn idempotency clean, không có exception flow

Dùng INSERT INTO + catch error khi:
  ✅ Muốn phân biệt rõ "duplicate" vs "lỗi thật khác"
  ✅ FK violation hay NULL violation cần được báo lỗi rõ ràng
  ✅ Cần audit log chi tiết từng loại lỗi
```

---

## 7. Biến thể: ON DUPLICATE KEY UPDATE

Nếu cần **upsert** thay vì skip, dùng `ON DUPLICATE KEY UPDATE` — cũng yêu cầu UNIQUE KEY:

```sql
-- Insert mới nếu chưa có, update nếu đã có
INSERT INTO payments (order_id, amount, status)
VALUES ('ORD-001', 500.00, 'SUCCESS')
ON DUPLICATE KEY UPDATE
    status    = VALUES(status),
    updated_at = NOW();
```

So sánh 3 hành vi với cùng UNIQUE KEY:

```
┌──────────────────────────────────┬──────────────┬──────────────────┐
│ Câu lệnh                         │ Row đã tồn   │ Row chưa tồn tại │
│                                  │ tại          │                  │
├──────────────────────────────────┼──────────────┼──────────────────┤
│ INSERT INTO                      │ ❌ ERROR 1062 │ ✅ Insert        │
│ INSERT IGNORE                    │ ✅ Skip       │ ✅ Insert        │
│ INSERT ... ON DUPLICATE KEY      │ ✅ Update     │ ✅ Insert        │
└──────────────────────────────────┴──────────────┴──────────────────┘
```

---

## 8. Composite UNIQUE KEY cho nghiệp vụ phức tạp

Idempotency key không nhất thiết phải là 1 column:

```sql
-- Mỗi user chỉ được vote 1 lần cho mỗi post
CREATE TABLE votes (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    post_id    BIGINT NOT NULL,
    vote_type  TINYINT NOT NULL,
    created_at DATETIME DEFAULT NOW(),

    UNIQUE KEY uq_user_post (user_id, post_id)  -- Composite key
);

-- Thread-safe, idempotent
INSERT IGNORE INTO votes (user_id, post_id, vote_type)
VALUES (42, 101, 1);
-- Gọi 100 lần → chỉ tạo 1 vote
```

---

## 9. Idempotency Key Pattern trong API (Stripe-style)

Pattern phổ biến: client gửi kèm `Idempotency-Key` header, server lưu vào DB với UNIQUE KEY:

```sql
CREATE TABLE payments (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    idempotency_key  VARCHAR(255) NOT NULL,
    order_id         VARCHAR(100),
    amount           DECIMAL(10,2),
    status           VARCHAR(20),
    response_body    JSON,      -- Cache response để trả đúng cho duplicate request
    created_at       DATETIME DEFAULT NOW(),

    UNIQUE KEY uq_idempotency (idempotency_key)
);
```

```go
func (s *PaymentService) ProcessPayment(idempotencyKey, orderID string, amount float64) (*Response, error) {
    result, err := s.db.Exec(`
        INSERT IGNORE INTO payments (idempotency_key, order_id, amount, status)
        VALUES (?, ?, ?, 'PENDING')
    `, idempotencyKey, orderID, amount)

    if err != nil {
        return nil, err
    }

    if rows, _ := result.RowsAffected(); rows == 0 {
        // Duplicate request → trả về response đã cache
        return s.getCachedResponse(idempotencyKey)
    }

    // Request mới → xử lý và cache response
    response, err := s.chargePaymentGateway(orderID, amount)
    s.cacheResponse(idempotencyKey, response)
    return response, err
}
```

---

## 10. Tóm tắt: Khi nào dùng cái gì?

```
Tình huống                               Giải pháp
──────────────────────────────────────────────────────────────────
Duplicate KHÔNG được phép, cần biết rõ  INSERT INTO + UNIQUE (catch 1062)
Duplicate là bình thường, cần skip      INSERT IGNORE + UNIQUE ✅
Cần insert-hoặc-update (upsert)         INSERT ... ON DUPLICATE KEY UPDATE
Cross-service distributed idempotency   Redis SETNX + INSERT IGNORE
API public với idempotency key          Idempotency-Key header + INSERT IGNORE
```

---

## Kết luận

**UNIQUE KEY là nền tảng** — không có nó, cả `INSERT INTO` lẫn `INSERT IGNORE` đều không thể đảm bảo idempotency.

**`INSERT INTO` vs `INSERT IGNORE`** là về **cách xử lý khi UNIQUE bị vi phạm**:

- `INSERT INTO` → throw error → application phải catch và phân loại
- `INSERT IGNORE` → silent skip → application chỉ cần check `rows_affected`

Trong môi trường multi-thread với Kafka retry hay HTTP duplicate, `INSERT IGNORE` cho phép viết code **idempotent theo happy path** — không có exception, không có error code ma thuật, chỉ là `if rows == 0 { skip }`.

Nguyên tắc vàng: **Để database enforce uniqueness, để `INSERT IGNORE` handle duplicate gracefully, và để application tập trung vào business logic.**

---

_Bài viết này áp dụng cho MySQL/MariaDB. PostgreSQL dùng `INSERT ... ON CONFLICT DO NOTHING` (tương đương INSERT IGNORE) và `INSERT ... ON CONFLICT DO UPDATE` (tương đương ON DUPLICATE KEY UPDATE)._
