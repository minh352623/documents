---
sidebar_position: 15
title: SAGA & OUTBOX Pattern
---
# SAGA & OUTBOX Pattern

> Hai pattern quan trọng nhất khi build distributed system với microservices.  
> Tài liệu này dùng ví dụ thực tế từ Fintech và EdTech để dễ hình dung.

---

## Mục lục

1. [Vấn đề cần giải quyết](#1-vấn-đề-cần-giải-quyết)
2. [SAGA Pattern](#2-saga-pattern)
   - [Choreography SAGA](#21-choreography-saga)
   - [Orchestration SAGA](#22-orchestration-saga)
   - [Compensating Transaction](#23-compensating-transaction)
3. [OUTBOX Pattern](#3-outbox-pattern)
   - [Vấn đề dual-write](#31-vấn-đề-dual-write)
   - [Giải pháp OUTBOX](#32-giải-pháp-outbox)
   - [Outbox Worker](#33-outbox-worker)
4. [Kết hợp SAGA + OUTBOX](#4-kết-hợp-saga--outbox)
5. [Ví dụ thực tế: Fintech Investment Platform](#5-ví-dụ-thực-tế-fintech-investment-platform)
6. [Ví dụ thực tế: EdTech Enrollment System](#6-ví-dụ-thực-tế-edtech-enrollment-system)
7. [So sánh & khi nào dùng gì](#7-so-sánh--khi-nào-dùng-gì)
8. [Implementation Golang](#8-implementation-golang)

---

## 1. Vấn đề cần giải quyết

### Trong Monolith — đơn giản

```
BEGIN TRANSACTION
  INSERT INTO orders ...
  UPDATE inventory ...
  INSERT INTO payments ...
COMMIT  ← tất cả thành công hoặc rollback hết
```

Một transaction duy nhất — nếu lỗi ở bước nào, toàn bộ rollback. **Đơn giản và an toàn.**

### Trong Microservices — phức tạp hơn nhiều

```
Order Service    → INSERT order vào DB riêng ✅
Payment Service  → Charge credit card ✅
Inventory Service → Reserve stock ❌ FAIL!

→ Tiền đã bị charge, order đã tạo, nhưng stock không được reserve
→ Data inconsistent giữa các service
```

Không thể dùng global transaction vì mỗi service có **database riêng**.  
Đây là lúc cần **SAGA Pattern**.

---

## 2. SAGA Pattern

> **Định nghĩa:** Chia một distributed transaction thành nhiều local transaction nhỏ.  
> Mỗi bước thành công thì publish event cho bước tiếp theo.  
> Nếu một bước fail → chạy **compensating transaction** để undo các bước trước.

### 2.1 Choreography SAGA

Các service **tự giao tiếp** với nhau qua event. Không có ai điều phối trung tâm.

```
┌─────────────┐    OrderCreated     ┌─────────────────┐
│ Order Svc   │ ─────────────────→  │  Payment Svc    │
│ (publishes) │                     │ (listens)       │
└─────────────┘                     └────────┬────────┘
                                             │ PaymentCharged
                                             ↓
                                    ┌─────────────────┐
                                    │  Inventory Svc  │
                                    │ (listens)       │
                                    └────────┬────────┘
                                             │ StockReserved
                                             ↓
                                    ┌─────────────────┐
                                    │  Notify Svc     │
                                    │ (send email)    │
                                    └─────────────────┘
```

**Ưu điểm:**
- Đơn giản, ít component
- Các service loose coupling

**Nhược điểm:**
- Khó track trạng thái toàn bộ flow
- Logic phân tán khắp nơi, khó debug

### 2.2 Orchestration SAGA

Có một **Orchestrator** trung tâm điều phối từng bước.

```
                    ┌─────────────────────┐
                    │   Order Orchestrator │
                    │   (Saga Manager)     │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ↓                    ↓                    ↓
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │ Payment Svc  │    │Inventory Svc │    │  Notify Svc  │
  │              │    │              │    │              │
  └──────────────┘    └──────────────┘    └──────────────┘
```

**Ưu điểm:**
- Dễ track toàn bộ flow ở một chỗ
- Dễ handle compensating transaction

**Nhược điểm:**
- Orchestrator có thể thành bottleneck
- Thêm một component cần maintain

### 2.3 Compensating Transaction

Khi một bước fail, phải **undo ngược lại** các bước đã thành công:

```
Bước thực thi (forward):
  Step 1: Create Order     → compensate: Cancel Order
  Step 2: Charge Payment   → compensate: Refund Payment
  Step 3: Reserve Stock    → compensate: Release Stock
  Step 4: Send Email       → compensate: Send "Order Failed" Email (không thể unsend)

Nếu Step 3 fail:
  → Run: Release Stock (không cần, chưa reserve)
  → Run: Refund Payment ✅
  → Run: Cancel Order ✅
```

> ⚠️ **Lưu ý:** Không phải mọi action đều reversible.  
> Email đã gửi không thể "unsent" — chỉ có thể gửi email mới thông báo lỗi.  
> Đây gọi là **semantic undo**, không phải technical rollback.

---

## 3. OUTBOX Pattern

### 3.1 Vấn đề Dual-Write

Tình huống hay gặp:

```go
// Code có vẻ đúng nhưng ẩn bug nghiêm trọng
func CreateOrder(order Order) error {
    // Bước 1: Lưu DB
    db.Insert(order) // ✅ thành công

    // Bước 2: Publish event
    rabbitMQ.Publish("order.created", order) // ❌ FAIL — mất điện, timeout, etc.

    return nil
}

// Kết quả:
// → Order đã tồn tại trong DB
// → Event không được publish
// → Payment Service không biết order mới → không charge tiền
// → Data inconsistent
```

**Đây là vấn đề dual-write** — không thể đảm bảo 2 hệ thống khác nhau (DB + Message Queue) được update đồng thời.

### 3.2 Giải pháp OUTBOX

**Ý tưởng cốt lõi:** Lưu event vào **cùng database** với data, trong **cùng một transaction**.  
Một worker riêng sẽ đọc bảng outbox và publish lên message queue.

```
┌─────────────────────────────────────────────┐
│           Database Transaction              │
│                                             │
│  ┌──────────────┐    ┌────────────────────┐ │
│  │ orders table │    │   outbox table     │ │
│  │              │    │                    │ │
│  │ id: 123      │    │ id: abc            │ │
│  │ amount: 1000 │    │ type: ORDER_CREATED│ │
│  │ status: new  │    │ payload: {...}     │ │
│  │              │    │ status: PENDING    │ │
│  └──────────────┘    └────────────────────┘ │
│                                             │
│  COMMIT ← cả hai hoặc không cái nào        │
└─────────────────────────────────────────────┘
                    ↓
         ┌─────────────────────┐
         │    Outbox Worker    │
         │  (chạy background)  │
         │  poll every 1s      │
         └──────────┬──────────┘
                    │
                    ↓
         ┌─────────────────────┐
         │    RabbitMQ/Kafka   │
         │  publish event      │
         │  update status=SENT │
         └─────────────────────┘
```

### 3.3 Outbox Worker

```
Worker hoạt động theo flow:

1. SELECT * FROM outbox WHERE status = 'PENDING' LIMIT 100
2. FOR EACH event:
   a. Publish lên message queue
   b. Nếu thành công → UPDATE status = 'SENT'
   c. Nếu thất bại   → retry sau (exponential backoff)
   d. Nếu quá max retries → UPDATE status = 'FAILED', alert team
3. Sleep 1 giây, lặp lại
```

**Schema bảng outbox:**

```sql
CREATE TABLE outbox (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  VARCHAR(100) NOT NULL,      -- 'ORDER_CREATED', 'PAYMENT_CHARGED'
    payload     JSONB NOT NULL,             -- nội dung event
    status      VARCHAR(20) DEFAULT 'PENDING', -- PENDING, SENT, FAILED
    retry_count INT DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW(),
    sent_at     TIMESTAMP
);

CREATE INDEX idx_outbox_status ON outbox(status, created_at)
    WHERE status = 'PENDING';
```

---

## 4. Kết hợp SAGA + OUTBOX

Đây là cách hai pattern **bổ sung cho nhau**:

```
SAGA  = "Làm thế nào để coordinate transaction qua nhiều service?"
OUTBOX = "Làm thế nào để đảm bảo event không bị mất?"
```

```
Order Service:
  1. BEGIN TRANSACTION
  2.   INSERT INTO orders (status='pending')
  3.   INSERT INTO outbox (event_type='ORDER_CREATED', status='PENDING')
  4. COMMIT

Outbox Worker:
  5. Poll outbox → publish 'ORDER_CREATED' lên RabbitMQ
  6. UPDATE outbox SET status='SENT'

Payment Service (SAGA step 2):
  7. Listen 'ORDER_CREATED' event
  8. Charge credit card
  9. BEGIN TRANSACTION
  10.  UPDATE payments (status='charged')
  11.  INSERT INTO outbox (event_type='PAYMENT_CHARGED')
  12. COMMIT

... và cứ tiếp tục theo SAGA flow

Nếu Payment fail:
  → Publish 'PAYMENT_FAILED' event
  → Order Service lắng nghe → Cancel order (compensating transaction)
```

---

## 5. Ví dụ thực tế: Fintech Investment Platform

> Tình huống: User muốn đầu tư 10 triệu VNĐ với kỳ hạn 2 năm.  
> Cần: Kiểm tra số dư → Trừ ví → Tạo gói đầu tư → Gửi confirmation.

### SAGA Flow (Choreography):

```
User request: "Đầu tư 10M, kỳ hạn 2 năm"

Step 1 - Wallet Service:
  → Kiểm tra số dư >= 10M ✅
  → Trừ 10M khỏi available balance
  → Lock 10M vào trạng thái "pending"
  → Publish: WALLET_DEDUCTED { userId, amount: 10M }

Step 2 - Investment Service:
  → Listen: WALLET_DEDUCTED
  → Tạo investment package { lockYears: 2, rate: 100%/year }
  → Tính interest schedule (tính lãi theo giây)
  → Publish: INVESTMENT_CREATED { investmentId, userId }

Step 3 - Notification Service:
  → Listen: INVESTMENT_CREATED
  → Gửi email confirmation
  → Push notification: "Đầu tư thành công!"
  → Publish: NOTIFICATION_SENT

Step 4 - Wallet Service:
  → Listen: NOTIFICATION_SENT (hoặc INVESTMENT_CREATED)
  → Chuyển 10M từ "pending" → "locked"
  → Flow hoàn tất ✅
```

### Compensating Transactions nếu fail:

```
Nếu Investment Service fail (tạo package lỗi):
  → Publish: INVESTMENT_FAILED { reason }

  Wallet Service lắng nghe INVESTMENT_FAILED:
  → Hoàn lại 10M vào available balance
  → Xóa "pending" lock
  → Publish: WALLET_REFUNDED

  Notification Service lắng nghe WALLET_REFUNDED:
  → Gửi email: "Đầu tư thất bại, đã hoàn tiền về ví"
```

### OUTBOX đảm bảo không mất event:

```sql
-- Wallet Service: deduct và lưu outbox cùng 1 transaction
BEGIN;
  UPDATE wallets
  SET available_balance = available_balance - 10000000,
      pending_balance   = pending_balance   + 10000000
  WHERE user_id = 'user-123';

  INSERT INTO outbox (event_type, payload)
  VALUES ('WALLET_DEDUCTED', '{"userId":"user-123","amount":10000000}');
COMMIT;

-- Nếu message queue down → outbox worker retry khi queue up lại
-- Tiền không bao giờ bị trừ mà không có event tương ứng
```

---

## 6. Ví dụ thực tế: EdTech Enrollment System

> Tình huống: Học sinh đăng ký khóa học tại VUS.  
> Cần: Kiểm tra slot → Thanh toán học phí → Cấp quyền truy cập → Gửi lịch học.

### SAGA Flow:

```
Step 1 - Course Service:
  → Kiểm tra còn slot trong lớp không (max 20 học sinh)
  → Reserve 1 slot (tạm giữ 15 phút)
  → Publish: SLOT_RESERVED { courseId, studentId, expireAt }

Step 2 - Payment Service:
  → Listen: SLOT_RESERVED
  → Charge học phí qua cổng thanh toán
  → Publish: PAYMENT_COMPLETED { paymentId, amount }

Step 3 - Access Service:
  → Listen: PAYMENT_COMPLETED
  → Cấp quyền truy cập OVI platform
  → Kích hoạt tài khoản học sinh
  → Publish: ACCESS_GRANTED { studentId, courseId }

Step 4 - Schedule Service:
  → Listen: ACCESS_GRANTED
  → Thêm lịch học vào calendar
  → Publish: SCHEDULE_CREATED

Step 5 - Notification Service:
  → Listen: SCHEDULE_CREATED
  → Gửi email lịch học + link OVI
  → Push notification cho phụ huynh qua Yaah Connect
```

### Compensating nếu Payment fail:

```
Payment fail (thẻ hết tiền, bank từ chối):
  → Publish: PAYMENT_FAILED

Course Service lắng nghe:
  → Release slot đã reserve
  → Slot trở về available

Notification Service:
  → Gửi email: "Thanh toán thất bại, vui lòng thử lại"
  → Gợi ý phương thức thanh toán khác
```

### Xử lý edge case: slot expire

```
Nếu học sinh giữ slot nhưng không thanh toán trong 15 phút:
  → Scheduled job chạy mỗi 1 phút
  → SELECT * FROM reservations WHERE expire_at < NOW() AND status = 'pending'
  → Publish: RESERVATION_EXPIRED
  → Course Service release slot
  → Notification: "Slot đã hết hạn, vui lòng đăng ký lại"
```

---

## 7. So sánh & khi nào dùng gì

### SAGA: Choreography vs Orchestration

| Tiêu chí | Choreography | Orchestration |
|---|---|---|
| Complexity | Đơn giản hơn | Phức tạp hơn |
| Coupling | Loose | Tighter (qua orchestrator) |
| Visibility | Khó track flow | Dễ track, 1 chỗ |
| Debug | Khó | Dễ hơn |
| Phù hợp | Flow đơn giản, ≤4 bước | Flow phức tạp, nhiều nhánh |
| Ví dụ | Notification flow | Order processing |

### Khi nào dùng SAGA?

```
✅ Dùng SAGA khi:
  - Có transaction trải dài qua 2+ microservice
  - Mỗi service có database riêng
  - Cần eventual consistency (không cần strong consistency)
  - Có thể define được compensating transaction cho mỗi bước

❌ Không dùng SAGA khi:
  - Chỉ có 1 service (dùng DB transaction thường)
  - Cần strong consistency (ví dụ: financial ledger chính xác tuyệt đối)
  - Không thể define compensating transaction
```

### Khi nào dùng OUTBOX?

```
✅ Dùng OUTBOX khi:
  - Cần đảm bảo at-least-once delivery cho event
  - Không muốn mất event khi message queue down
  - Cần audit trail (log tất cả event đã publish)
  - Dùng cùng với SAGA để đảm bảo reliability

❌ Không cần OUTBOX khi:
  - Chỉ có 1 service, không cần event
  - Event loss là acceptable (ví dụ: analytics event không quan trọng)
  - Đang dùng Kafka với transactional producer (có cơ chế riêng)
```

---

## 8. Implementation Golang

### SAGA Orchestrator (đơn giản)

```go
// domain/saga/enrollment_saga.go
type EnrollmentSaga struct {
    state   SagaState
    steps   []SagaStep
    history []SagaEvent
}

type SagaStep struct {
    Name        string
    Execute     func(ctx context.Context, data SagaData) error
    Compensate  func(ctx context.Context, data SagaData) error
}

func NewEnrollmentSaga() *EnrollmentSaga {
    return &EnrollmentSaga{
        steps: []SagaStep{
            {
                Name:       "ReserveSlot",
                Execute:    reserveSlot,
                Compensate: releaseSlot,
            },
            {
                Name:       "ProcessPayment",
                Execute:    processPayment,
                Compensate: refundPayment,
            },
            {
                Name:       "GrantAccess",
                Execute:    grantAccess,
                Compensate: revokeAccess,
            },
        },
    }
}

func (s *EnrollmentSaga) Execute(ctx context.Context, data SagaData) error {
    executedSteps := []int{}

    for i, step := range s.steps {
        if err := step.Execute(ctx, data); err != nil {
            // Step fail → compensate tất cả bước đã chạy (ngược lại)
            for j := len(executedSteps) - 1; j >= 0; j-- {
                stepIdx := executedSteps[j]
                s.steps[stepIdx].Compensate(ctx, data)
            }
            return fmt.Errorf("saga failed at step %s: %w", step.Name, err)
        }
        executedSteps = append(executedSteps, i)
    }

    return nil
}
```

### OUTBOX Implementation

```go
// infrastructure/outbox/outbox.go
type OutboxEvent struct {
    ID         uuid.UUID       `db:"id"`
    EventType  string          `db:"event_type"`
    Payload    json.RawMessage `db:"payload"`
    Status     string          `db:"status"`
    RetryCount int             `db:"retry_count"`
    CreatedAt  time.Time       `db:"created_at"`
}

// Lưu outbox trong cùng transaction với business data
func SaveWithOutbox(ctx context.Context, tx *sql.Tx,
    businessFn func(*sql.Tx) error,
    eventType string, payload interface{},
) error {
    // Chạy business logic
    if err := businessFn(tx); err != nil {
        return err
    }

    // Lưu event vào outbox — cùng transaction
    payloadBytes, _ := json.Marshal(payload)
    _, err := tx.ExecContext(ctx, `
        INSERT INTO outbox (id, event_type, payload, status)
        VALUES ($1, $2, $3, 'PENDING')
    `, uuid.New(), eventType, payloadBytes)

    return err
}

// Ví dụ sử dụng trong service
func (s *EnrollmentService) Enroll(ctx context.Context, req EnrollRequest) error {
    tx, _ := s.db.BeginTx(ctx, nil)
    defer tx.Rollback()

    err := SaveWithOutbox(ctx, tx,
        func(tx *sql.Tx) error {
            _, err := tx.ExecContext(ctx, `
                INSERT INTO enrollments (student_id, course_id, status)
                VALUES ($1, $2, 'pending')
            `, req.StudentID, req.CourseID)
            return err
        },
        "ENROLLMENT_CREATED",
        EnrollmentCreatedEvent{
            StudentID: req.StudentID,
            CourseID:  req.CourseID,
        },
    )
    if err != nil {
        return err
    }

    return tx.Commit()
}
```

### Outbox Worker

```go
// infrastructure/outbox/worker.go
type OutboxWorker struct {
    db       *sql.DB
    publisher MessagePublisher
    interval  time.Duration
}

func (w *OutboxWorker) Run(ctx context.Context) {
    ticker := time.NewTicker(w.interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            w.processBatch(ctx)
        case <-ctx.Done():
            return
        }
    }
}

func (w *OutboxWorker) processBatch(ctx context.Context) {
    // Lấy batch pending events
    rows, err := w.db.QueryContext(ctx, `
        SELECT id, event_type, payload, retry_count
        FROM outbox
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED  -- quan trọng khi chạy nhiều worker
    `)
    if err != nil {
        return
    }
    defer rows.Close()

    for rows.Next() {
        var event OutboxEvent
        rows.Scan(&event.ID, &event.EventType, &event.Payload, &event.RetryCount)

        if err := w.publisher.Publish(event.EventType, event.Payload); err != nil {
            // Publish fail → tăng retry count
            if event.RetryCount >= 5 {
                w.db.ExecContext(ctx,
                    "UPDATE outbox SET status='FAILED' WHERE id=$1", event.ID)
                // Alert team qua Slack/PagerDuty
            } else {
                w.db.ExecContext(ctx,
                    "UPDATE outbox SET retry_count=retry_count+1 WHERE id=$1", event.ID)
            }
            continue
        }

        // Publish thành công
        w.db.ExecContext(ctx, `
            UPDATE outbox
            SET status='SENT', sent_at=NOW()
            WHERE id=$1
        `, event.ID)
    }
}
```

---

## Tóm tắt

```
SAGA Pattern:
  Vấn đề → Không thể dùng global transaction trong microservices
  Giải pháp → Chia nhỏ thành local transactions + compensating transactions
  Hai loại → Choreography (event-driven) và Orchestration (central coordinator)
  Nhớ → Mỗi bước cần có "undo" tương ứng

OUTBOX Pattern:
  Vấn đề → Không thể đảm bảo DB write và message publish xảy ra cùng lúc
  Giải pháp → Lưu event vào DB cùng transaction với data, worker publish sau
  Nhớ → FOR UPDATE SKIP LOCKED khi có nhiều worker instance

Kết hợp:
  SAGA + OUTBOX = Distributed transaction reliable
  SAGA lo "điều phối" flow
  OUTBOX lo "đảm bảo delivery" cho từng event trong flow
```

---

*Document này dựa trên kinh nghiệm thực tế từ các hệ thống Fintech và EdTech production.*  
*Tham khảo thêm: [microservices.io/patterns/data/saga.html](https://microservices.io/patterns/data/saga.html)*
