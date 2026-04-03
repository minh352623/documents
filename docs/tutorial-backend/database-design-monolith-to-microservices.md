# Thiết Kế Database cho Monolith có thể Scale ra Microservices

> **Mục tiêu:** Xây dựng một database schema trong kiến trúc Monolith ngay từ đầu với tư duy "microservice-ready" — giúp việc tách service sau này ít đau đớn nhất có thể.

---

## Mục lục

1. [Tổng quan tư duy thiết kế](#1-tổng-quan-tư-duy-thiết-kế)
2. [Nguyên tắc phân chia domain (Bounded Context)](#2-nguyên-tắc-phân-chia-domain-bounded-context)
3. [Thiết kế schema theo domain](#3-thiết-kế-schema-theo-domain)
4. [Tránh các anti-pattern gây khó scale](#4-tránh-các-anti-pattern-gây-khó-scale)
5. [Quản lý tham chiếu giữa các domain](#5-quản-lý-tham-chiếu-giữa-các-domain)
6. [Chiến lược ID](#6-chiến-lược-id)
7. [Thiết kế cho Data Consistency](#7-thiết-kế-cho-data-consistency)
8. [Migration Path — Từ Monolith sang Microservices](#8-migration-path--từ-monolith-sang-microservices)
9. [Checklist thực tế](#9-checklist-thực-tế)
10. [Tóm tắt](#10-tóm-tắt)

---

## 1. Tổng quan tư duy thiết kế

Khi một Monolith được thiết kế không có kế hoạch tách service, database thường trở thành "big ball of mud" — mọi bảng join với nhau chằng chịt, không thể tách ra mà không phá vỡ toàn bộ hệ thống.

**Mục tiêu không phải là thiết kế microservice từ đầu**, mà là:

- Giữ Monolith đơn giản, dễ phát triển trong giai đoạn đầu.
- Nhưng tổ chức code và database theo các **domain rõ ràng** để sau này tách ra ít ma sát nhất.

Nguyên tắc cốt lõi: **"Share code, not data"** — các module có thể dùng chung business logic, nhưng không được phụ thuộc trực tiếp vào data của nhau.

---

## 2. Nguyên tắc phân chia domain (Bounded Context)

Trước khi thiết kế bất kỳ bảng nào, cần xác định rõ các **Bounded Context** — ranh giới nghiệp vụ độc lập trong hệ thống.

### 2.1 Ví dụ phân chia domain

Lấy ví dụ hệ thống quản lý thiết bị (Equipment Management System):

```
┌──────────────────────────────────────────────────────────────┐
│                        MONOLITH                              │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Identity  │  │  Inventory  │  │    Maintenance      │  │
│  │   Domain    │  │   Domain    │  │      Domain         │  │
│  │             │  │             │  │                     │  │
│  │ users       │  │ equipments  │  │ maintenance_orders  │  │
│  │ roles       │  │ categories  │  │ technicians         │  │
│  │ permissions │  │ locations   │  │ work_logs           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐                           │
│  │   Audit     │  │   Report    │                           │
│  │   Domain    │  │   Domain    │                           │
│  │             │  │             │                           │
│  │ audit_logs  │  │ reports     │                           │
│  │ change_hist │  │ snapshots   │                           │
│  └─────────────┘  └─────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Quy tắc phân chia

- Mỗi domain phải có **một nhiệm vụ duy nhất** (Single Responsibility).
- Một bảng chỉ thuộc về **một domain duy nhất**.
- Không được có business logic quan trọng nằm ở tầng database (stored procedures, triggers phức tạp).

---

## 3. Thiết kế schema theo domain

### 3.1 Sử dụng Schema namespace (PostgreSQL)

Với PostgreSQL, dùng **schema** để tách biệt từng domain ngay trong cùng một database:

```sql
-- Tạo schema riêng cho từng domain
CREATE SCHEMA identity;
CREATE SCHEMA inventory;
CREATE SCHEMA maintenance;
CREATE SCHEMA audit;

-- Bảng thuộc về domain nào thì đặt trong schema đó
CREATE TABLE identity.users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory.equipments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    serial_number   VARCHAR(100) UNIQUE,
    category_id     UUID NOT NULL REFERENCES inventory.categories(id),
    owner_user_id   UUID NOT NULL, -- Tham chiếu sang identity domain, KHÔNG dùng FK
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> **Lợi ích:** Khi tách microservice, chỉ cần "nhấc" nguyên schema đó ra một database riêng, không cần refactor tên bảng.

### 3.2 Với MySQL (không có schema namespace)

Dùng **prefix theo domain** cho tên bảng:

```sql
-- Identity domain
CREATE TABLE identity_users (...);
CREATE TABLE identity_roles (...);
CREATE TABLE identity_permissions (...);

-- Inventory domain
CREATE TABLE inventory_equipments (...);
CREATE TABLE inventory_categories (...);

-- Maintenance domain
CREATE TABLE maintenance_orders (...);
CREATE TABLE maintenance_work_logs (...);
```

---

## 4. Tránh các anti-pattern gây khó scale

### 4.1 ❌ Cross-domain Foreign Key

Đây là **anti-pattern nghiêm trọng nhất** khi muốn tách microservice sau này.

```sql
-- ❌ SAI: FK trực tiếp sang domain khác
CREATE TABLE maintenance.orders (
    id          UUID PRIMARY KEY,
    equipment_id UUID NOT NULL REFERENCES inventory.equipments(id), -- ❌ Cross-domain FK
    user_id      UUID NOT NULL REFERENCES identity.users(id)        -- ❌ Cross-domain FK
);
```

Khi tách ra 2 database riêng, FK này sẽ không thể tồn tại và phải bỏ, đồng nghĩa mất toàn bộ referential integrity ở tầng DB.

```sql
-- ✅ ĐÚNG: Lưu ID nhưng không khai báo FK
CREATE TABLE maintenance.orders (
    id              UUID PRIMARY KEY,
    equipment_id    UUID NOT NULL, -- Chỉ lưu ID, validate ở application layer
    requested_by    UUID NOT NULL, -- Tương tự
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Thêm comment để rõ nguồn gốc
COMMENT ON COLUMN maintenance.orders.equipment_id IS 'References inventory.equipments(id)';
COMMENT ON COLUMN maintenance.orders.requested_by IS 'References identity.users(id)';
```

### 4.2 ❌ Shared Mutable Tables

```sql
-- ❌ SAI: Một bảng được nhiều domain write vào
CREATE TABLE shared_notifications (
    id          UUID PRIMARY KEY,
    type        VARCHAR(50), -- 'maintenance', 'inventory', 'identity'...
    payload     JSONB,
    ...
);
```

Thay vào đó, mỗi domain quản lý outbox/event của riêng mình.

### 4.3 ❌ God Table

```sql
-- ❌ SAI: Một bảng "ôm" quá nhiều thứ
CREATE TABLE items (
    id          UUID PRIMARY KEY,
    type        VARCHAR(50), -- 'equipment', 'tool', 'consumable', 'spare_part'
    -- 50 cột, chỉ một số cột có giá trị tùy theo type
    ...
);
```

Tách thành bảng riêng cho từng loại thực thể.

### 4.4 ❌ Business Logic trong Database

```sql
-- ❌ SAI: Trigger tính toán business logic
CREATE TRIGGER update_equipment_status
AFTER INSERT ON maintenance.orders
FOR EACH ROW
BEGIN
    UPDATE inventory.equipments     -- ❌ Cross-domain write trong trigger
    SET status = 'under_maintenance'
    WHERE id = NEW.equipment_id;
END;
```

Business logic này phải nằm ở application layer, không phải database.

---

## 5. Quản lý tham chiếu giữa các domain

Khi không dùng Cross-domain FK, cần có chiến lược để đảm bảo data consistency.

### 5.1 Application-level Validation

```go
// Golang example: Validate cross-domain reference ở service layer
func (s *MaintenanceService) CreateOrder(ctx context.Context, req CreateOrderRequest) (*Order, error) {
    // Validate equipment tồn tại bằng cách gọi sang Inventory service/repository
    exists, err := s.inventoryRepo.EquipmentExists(ctx, req.EquipmentID)
    if err != nil {
        return nil, fmt.Errorf("failed to validate equipment: %w", err)
    }
    if !exists {
        return nil, ErrEquipmentNotFound
    }

    // Validate user tồn tại
    exists, err = s.identityRepo.UserExists(ctx, req.RequestedBy)
    if err != nil {
        return nil, fmt.Errorf("failed to validate user: %w", err)
    }
    if !exists {
        return nil, ErrUserNotFound
    }

    return s.repo.CreateOrder(ctx, req)
}
```

### 5.2 Data Denormalization có chủ đích

Lưu lại một số thông tin cần thiết từ domain khác để tránh join cross-domain:

```sql
CREATE TABLE maintenance.orders (
    id                  UUID PRIMARY KEY,
    equipment_id        UUID NOT NULL,
    equipment_name      VARCHAR(255) NOT NULL,  -- Denormalized từ inventory domain
    equipment_serial    VARCHAR(100),            -- Denormalized
    requested_by        UUID NOT NULL,
    requested_by_name   VARCHAR(255) NOT NULL,   -- Denormalized từ identity domain
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> **Lưu ý:** Denormalize có chọn lọc — chỉ những trường ít thay đổi và cần thiết để hiển thị / audit.

### 5.3 Outbox Pattern cho eventual consistency

Mỗi domain có bảng outbox riêng để publish event mà không cần distributed transaction:

```sql
-- Mỗi domain có bảng outbox riêng
CREATE TABLE inventory.outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id    UUID NOT NULL,          -- ID của entity liên quan
    aggregate_type  VARCHAR(100) NOT NULL,  -- 'equipment', 'category'...
    event_type      VARCHAR(100) NOT NULL,  -- 'equipment.created', 'equipment.deleted'
    payload         JSONB NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | published | failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ
);

CREATE INDEX idx_inventory_outbox_status ON inventory.outbox_events(status, created_at)
    WHERE status = 'pending';
```

---

## 6. Chiến lược ID

### 6.1 Dùng UUID thay vì Auto-increment Integer

```sql
-- ❌ Auto-increment: Conflict khi merge nhiều database
id BIGSERIAL PRIMARY KEY

-- ✅ UUID v4: Global unique
id UUID PRIMARY KEY DEFAULT gen_random_uuid()

-- ✅ UUID v7 (khuyến nghị): Sortable + global unique (PostgreSQL 17+)
id UUID PRIMARY KEY DEFAULT gen_random_uuid() -- dùng UUIDv7 library ở app layer
```

**Lý do:** Khi tách ra microservice với database riêng, auto-increment sẽ bị conflict (cả hai DB đều có `id = 1`). UUID đảm bảo unique globally.

### 6.2 Cân nhắc ULID

ULID (Universally Unique Lexicographically Sortable Identifier) kết hợp ưu điểm của cả hai:

```
01ARZ3NDEKTSV4RRFFQ69G5FAV
│                          │
└── Timestamp (48-bit) ────┘ └── Random (80-bit) ──┘

- Sortable theo thời gian (tốt cho index)
- Global unique (safe khi merge)
- Dạng string thân thiện hơn UUID
```

---

## 7. Thiết kế cho Data Consistency

### 7.1 Soft Delete thay vì Hard Delete

```sql
-- Thêm cột deleted_at thay vì xóa thật
ALTER TABLE inventory.equipments
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Query mặc định filter bản ghi chưa xóa
SELECT * FROM inventory.equipments WHERE deleted_at IS NULL;

-- Tạo index để query hiệu quả
CREATE INDEX idx_equipments_active ON inventory.equipments(id) WHERE deleted_at IS NULL;
```

**Lý do:** Các domain khác có thể đang giữ reference đến ID này. Hard delete sẽ phá vỡ consistency của toàn hệ thống.

### 7.2 Audit Columns nhất quán

Thêm các cột audit vào **mọi bảng quan trọng**:

```sql
-- Template cho mọi bảng
CREATE TABLE <domain>.<table_name> (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ... business columns ...

    -- Audit columns (bắt buộc)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID,           -- References identity.users(id)
    updated_by  UUID,           -- References identity.users(id)
    deleted_at  TIMESTAMPTZ,    -- Soft delete
    version     INTEGER NOT NULL DEFAULT 1  -- Optimistic locking
);
```

### 7.3 Optimistic Locking với version column

```sql
-- Update với optimistic locking
UPDATE inventory.equipments
SET
    name = $1,
    updated_at = NOW(),
    version = version + 1
WHERE id = $2 AND version = $3; -- Nếu version không khớp → bị người khác update trước
```

---

## 8. Migration Path — Từ Monolith sang Microservices

Khi thiết kế theo các nguyên tắc trên, việc tách service có thể thực hiện theo từng bước mà không cần Big Bang rewrite.

### Bước 1: Monolith với Schema Isolation (Hiện tại)

```
┌─────────────────────────────────┐
│         Application             │
│  ┌────────┐  ┌─────────────┐   │
│  │Inven.  │  │Maintenance  │   │
│  │Module  │  │  Module     │   │
│  └────────┘  └─────────────┘   │
└─────────────────────────────────┘
              │
┌─────────────────────────────────┐
│     Single Database             │
│  ┌──────────┐ ┌──────────────┐ │
│  │inventory │ │ maintenance  │ │
│  │ schema   │ │   schema     │ │
│  └──────────┘ └──────────────┘ │
└─────────────────────────────────┘
```

### Bước 2: Strangler Fig — Tách từng service

```
┌──────────────┐    ┌──────────────────┐
│  Monolith    │    │ Inventory Service│
│  (còn lại)  │    │   (tách ra)      │
└──────────────┘    └──────────────────┘
       │                    │
┌──────┴──────┐    ┌────────┴────────┐
│  Main DB    │    │  Inventory DB   │
│(maintenance)│    │ (inventory      │
│  schema     │    │  schema moved)  │
└─────────────┘    └─────────────────┘
```

### Bước 3: Full Microservices

```
┌───────────┐  ┌──────────────┐  ┌──────────────┐
│ Identity  │  │  Inventory   │  │ Maintenance  │
│ Service   │  │   Service    │  │   Service    │
└───────────┘  └──────────────┘  └──────────────┘
      │                │                 │
┌─────┴───┐    ┌───────┴──────┐  ┌───────┴──────┐
│ Identity│    │  Inventory   │  │ Maintenance  │
│   DB    │    │     DB       │  │     DB       │
└─────────┘    └──────────────┘  └──────────────┘
```

---

## 9. Checklist thực tế

Sử dụng checklist này khi review database design:

### Schema Structure
- [ ] Các bảng đã được nhóm theo domain rõ ràng (schema namespace hoặc prefix)
- [ ] Không có bảng nào thuộc về nhiều hơn một domain
- [ ] Không có stored procedure/trigger chứa business logic phức tạp

### ID Strategy
- [ ] Tất cả primary key dùng UUID (hoặc ULID), không dùng BIGSERIAL/AUTO_INCREMENT
- [ ] Không có composite primary key phụ thuộc vào auto-increment của bảng khác

### Cross-domain References
- [ ] Không có Foreign Key khai báo cross-domain
- [ ] Các cross-domain reference có comment ghi rõ nguồn gốc
- [ ] Có application-level validation cho cross-domain reference

### Data Consistency
- [ ] Tất cả bảng quan trọng có `created_at`, `updated_at`, `deleted_at`
- [ ] Soft delete được áp dụng, không hard delete dữ liệu có tham chiếu
- [ ] Có `version` column cho optimistic locking ở các bảng cần concurrency control

### Event / Messaging
- [ ] Mỗi domain có bảng outbox riêng nếu cần publish event
- [ ] Event payload chứa đủ thông tin để consumer xử lý mà không cần gọi lại DB gốc

### Index
- [ ] Index trên các cột thường xuyên query/filter
- [ ] Partial index cho soft delete (`WHERE deleted_at IS NULL`)
- [ ] Index trên các cột ID tham chiếu cross-domain

---

## 10. Tóm tắt

| Vấn đề | Giải pháp |
|---|---|
| Tất cả bảng lẫn lộn | Phân chia theo domain, dùng schema namespace hoặc prefix |
| Cross-domain FK | Lưu ID nhưng không khai báo FK, validate ở application layer |
| Auto-increment ID conflict | Dùng UUID v4 hoặc ULID |
| Hard delete phá consistency | Soft delete với cột `deleted_at` |
| Shared trigger/stored proc | Di chuyển toàn bộ business logic lên application layer |
| Distributed transaction khi tách | Outbox Pattern + eventual consistency |
| Concurrency conflict | Optimistic locking với `version` column |

> **Triết lý cốt lõi:** Thiết kế như thể mỗi domain là một service độc lập — nhưng triển khai chúng trong cùng một ứng dụng và database cho đến khi thực sự cần tách ra.

---

*Document này được soạn với mục tiêu thực tiễn cho các dự án vừa và nhỏ muốn có lộ trình scale rõ ràng từ Monolith lên Microservices.*
