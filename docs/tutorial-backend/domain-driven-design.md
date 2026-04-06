# Domain Driven Design (DDD) — Hướng Dẫn Toàn Diện Cho Backend Engineer

> **Mục tiêu tài liệu:** Cung cấp hiểu biết đầy đủ về DDD — từ lý thuyết đến thực tiễn — để team áp dụng đúng trong các dự án backend (Golang, Fintech, Web3).

---

## Mục Lục

1. [DDD là gì?](#1-ddd-là-gì)
2. [Tại sao DDD ra đời?](#2-tại-sao-ddd-ra-đời)
3. [Các khái niệm cốt lõi](#3-các-khái-niệm-cốt-lõi)
   - [Ubiquitous Language](#31-ubiquitous-language-ngôn-ngữ-chung)
   - [Bounded Context](#32-bounded-context)
   - [Domain, Subdomain](#33-domain--subdomain)
   - [Entity](#34-entity)
   - [Value Object](#35-value-object)
   - [Aggregate & Aggregate Root](#36-aggregate--aggregate-root)
   - [Domain Event](#37-domain-event)
   - [Repository](#38-repository)
   - [Domain Service](#39-domain-service)
   - [Application Service](#310-application-service)
   - [Factory](#311-factory)
4. [Kiến trúc phân tầng trong DDD](#4-kiến-trúc-phân-tầng-trong-ddd)
5. [DDD + Clean Architecture](#5-ddd--clean-architecture)
6. [DDD trong thực tế — Ví dụ Golang](#6-ddd-trong-thực-tế--ví-dụ-golang)
7. [Ưu điểm](#7-ưu-điểm)
8. [Nhược điểm & Cạm bẫy](#8-nhược-điểm--cạm-bẫy)
9. [Khi nào nên dùng DDD? Khi nào KHÔNG nên?](#9-khi-nào-nên-dùng-ddd-khi-nào-không-nên)
10. [Anti-patterns cần tránh](#10-anti-patterns-cần-tránh)
11. [DDD & Microservices](#11-ddd--microservices)
12. [Tóm tắt nhanh — Quick Reference](#12-tóm-tắt-nhanh--quick-reference)

---

## 1. DDD là gì?

**Domain-Driven Design (DDD)** là một phương pháp tiếp cận thiết kế phần mềm, trong đó **nghiệp vụ (domain) là trung tâm** của mọi quyết định kiến trúc và thiết kế code.

Khái niệm này được Eric Evans giới thiệu trong cuốn sách nổi tiếng:
> 📘 *"Domain-Driven Design: Tackling Complexity in the Heart of Software"* — Eric Evans, 2003

Ý tưởng chủ đạo: **Phần mềm nên phản ánh đúng mô hình của nghiệp vụ thực tế**, không phải bị điều khiển bởi database schema, framework hay công nghệ.

```
Thế giới thực (Business Domain)
         ↓  [Hiểu & mô hình hóa]
    Domain Model (Code)
         ↓  [Implement]
    Software System
```

---

## 2. Tại sao DDD ra đời?

### Vấn đề trước khi có DDD

Trong các hệ thống truyền thống, developer thường:

- **Tư duy theo database**: Thiết kế bảng trước, rồi viết code xoay quanh bảng đó.
- **Logic nghiệp vụ nằm rải rác**: Lúc ở controller, lúc ở service, lúc ở stored procedure.
- **Ngôn ngữ không thống nhất**: Dev nói "User", BA nói "Khách hàng", PM nói "Account" — cùng một thứ, ba tên gọi.
- **Code khó bảo trì**: Thêm một rule nghiệp vụ mới → sửa ở 5 chỗ khác nhau.

### DDD giải quyết gì?

| Vấn đề | Giải pháp DDD |
|--------|--------------|
| Logic nghiệp vụ rải rác | Tập trung vào Domain Layer |
| Ngôn ngữ không nhất quán | Ubiquitous Language |
| Code không phản ánh nghiệp vụ | Domain Model = Business Model |
| Hệ thống lớn khó tách module | Bounded Context |
| Khó test business logic | Domain objects thuần, không phụ thuộc infra |

---

## 3. Các Khái Niệm Cốt Lõi

### 3.1 Ubiquitous Language (Ngôn ngữ chung)

**Định nghĩa:** Một bộ từ vựng thống nhất được Developer, Domain Expert (BA, PM, business) **cùng sử dụng** trong mọi cuộc trò chuyện, tài liệu, và trong cả code.

**Nguyên tắc:**
- Không được "dịch" khi chuyển từ business sang code
- Mỗi khái niệm chỉ có **một tên duy nhất**
- Nếu business gọi là "Order", code phải là `Order`, không phải `Transaction`, `Purchase`, hay `Bill`

**Ví dụ thực tế (Fintech):**

```
❌ Không nhất quán:
  Business: "Lệnh chuyển tiền"
  Code:     TransactionRequest, PaymentCommand, TransferDTO, MoneyMoveEntity

✅ Ubiquitous Language:
  Tất cả đều gọi là: "TransferOrder"
  Code: type TransferOrder struct { ... }
```

---

### 3.2 Bounded Context

**Định nghĩa:** Ranh giới rõ ràng trong đó một **Domain Model cụ thể** có hiệu lực. Bên ngoài ranh giới đó, cùng một khái niệm có thể có nghĩa khác.

Đây là **khái niệm quan trọng nhất trong DDD** khi áp dụng cho microservices.

**Ví dụ:** Khái niệm `User` trong các context khác nhau:

```
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   Identity Context   │    │   Payment Context    │    │  Notification Context│
│                      │    │                      │    │                      │
│  User {              │    │  Customer {          │    │  Recipient {         │
│    id                │    │    id                │    │    id                │
│    email             │    │    walletBalance      │    │    email             │
│    passwordHash      │    │    kycStatus         │    │    pushToken         │
│    roles             │    │    riskScore         │    │    preferences       │
│  }                   │    │  }                   │    │  }                   │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

Cùng là "người dùng" nhưng mỗi context chỉ quan tâm đến **thuộc tính phù hợp với nghiệp vụ của mình**.

**Context Map:** Biểu đồ mô tả quan hệ giữa các Bounded Context:
- **Shared Kernel**: Hai context chia sẻ một phần model chung
- **Customer/Supplier**: Context này phụ thuộc output của context kia
- **Anti-corruption Layer (ACL)**: Dịch model giữa các context để tránh ô nhiễm
- **Open Host Service**: Publish API chuẩn cho context khác dùng

---

### 3.3 Domain / Subdomain

```
Domain (Toàn bộ nghiệp vụ)
│
├── Core Domain        ← Lợi thế cạnh tranh, đầu tư nhiều nhất
│   └── ví dụ: Risk Scoring Engine (Fintech)
│
├── Supporting Subdomain ← Hỗ trợ core, có thể tự build
│   └── ví dụ: KYC Verification, Audit Logging
│
└── Generic Subdomain  ← Không tạo ra lợi thế, nên mua/dùng thư viện
    └── ví dụ: Email sending, Authentication, PDF generation
```

> 💡 **Quy tắc đầu tư:** Dồn sức vào Core Domain. Generic Subdomain nên dùng third-party (SendGrid, Auth0...) để tiết kiệm thời gian.

---

### 3.4 Entity

**Định nghĩa:** Đối tượng được **xác định bởi identity (ID)**, không phải bởi giá trị thuộc tính.

Hai Entity khác nhau dù có cùng thuộc tính, nếu khác ID → chúng là **hai đối tượng khác nhau**.

```go
// Entity trong Golang
type Order struct {
    id         OrderID     // Identity — bất biến
    customerID CustomerID
    items       []OrderItem
    status      OrderStatus
    totalAmount Money
    createdAt   time.Time
}

// Hai order có thể có cùng item, cùng amount, nhưng khác id → khác nhau
```

**Đặc điểm:**
- Có lifecycle (tạo → thay đổi → xóa)
- So sánh bằng ID, không phải bằng giá trị
- Thường được lưu vào database

---

### 3.5 Value Object

**Định nghĩa:** Đối tượng **không có identity**, được xác định **hoàn toàn bởi giá trị**. Bất biến (immutable).

```go
// Value Object
type Money struct {
    amount   decimal.Decimal
    currency string
}

// Money{100, "USD"} == Money{100, "USD"} → TRUE (cùng giá trị = cùng đối tượng)
// Không có ID, không có lifecycle

func (m Money) Add(other Money) Money {
    if m.currency != other.currency {
        panic("currency mismatch")
    }
    return Money{amount: m.amount.Add(other.amount), currency: m.currency}
    // Trả về VALUE MỚI, không mutate
}

type Address struct {
    street   string
    city     string
    country  string
    zipCode  string
}

type Email struct {
    value string
}

func NewEmail(raw string) (Email, error) {
    if !isValidEmail(raw) {
        return Email{}, errors.New("invalid email format")
    }
    return Email{value: strings.ToLower(raw)}, nil
}
```

**Lợi ích của Value Object:**
- Encapsulate validation logic (email hợp lệ, tiền không âm...)
- Thread-safe vì immutable
- Dễ test
- Tránh "Primitive Obsession" anti-pattern

---

### 3.6 Aggregate & Aggregate Root

**Định nghĩa:**
- **Aggregate**: Nhóm các Entity và Value Object được coi là **một đơn vị thống nhất** về mặt dữ liệu và nghiệp vụ.
- **Aggregate Root**: Entity "đứng đầu" aggregate. Mọi thay đổi bên trong aggregate **phải đi qua Aggregate Root**.

#### Giải thích bằng ngôn ngữ đời thường

Hình dung một **căn phòng ngân hàng có két sắt**:

- **Két sắt** = Aggregate (nhóm mọi thứ quan trọng lại)
- **Bảo vệ đứng cửa** = Aggregate Root (`Order`, `Account`, `Cart`...)
- **Tiền, giấy tờ, vàng bên trong** = các Entity và Value Object con (`OrderItem`, `Address`, `Money`...)
- **Khách hàng muốn lấy tiền** = External Service gọi vào

Không ai được tự vào két lấy tiền. Phải qua bảo vệ, bảo vệ kiểm tra điều kiện, rồi mới thực hiện.

#### So sánh có / không có Aggregate

```
❌ Không có Aggregate — Ai cũng sửa thẳng vào data:

  OrderService  ──────────────► OrderItem
  PaymentSvc    ──────────────► Status       (Chaos! Không ai bảo vệ rule)
  ShippingSvc   ──────────────► Address


✅ Có Aggregate — Chỉ Root nhận lệnh từ bên ngoài:

  ┌── Aggregate Boundary ──────────────────────────┐
  │                                                │
  │   Order (Root / Gatekeeper)                   │
  │   ├── kiểm tra điều kiện                      │
  │   ├── áp dụng business rule                   │
  │   └── mới được phép thay đổi ──► OrderItem    │
  │                            └──► Status        │
  │                            └──► Address       │
  └────────────────────────────────────────────────┘
        ▲
        │ (chỉ vào đây, không leo rào)
  External Services
```

#### Ví dụ 1: E-commerce — Order Aggregate

```go
// ❌ KHÔNG CÓ AGGREGATE — service tự sửa thẳng, không qua ai
orderItems = append(orderItems, newItem)  // OrderService tự thêm item
order.Status = "confirmed"               // PaymentService tự đổi status
order.Address = newAddr                  // ShippingService tự đổi địa chỉ
// → Không ai kiểm tra rule, data có thể không nhất quán

// ✅ CÓ AGGREGATE — Order là gatekeeper duy nhất
type Order struct {
    id          OrderID
    status      OrderStatus
    items       []OrderItem    // private — bên ngoài không được đụng trực tiếp
    totalAmount Money
    address     ShipAddress
}

// Chỉ Order mới biết cách thêm item ĐÚNG
func (o *Order) AddItem(productID ProductID, qty int, price Money) error {
    if o.status != OrderStatusDraft {
        return ErrCannotModifyConfirmedOrder  // Rule được bảo vệ tại đây
    }
    if qty <= 0 {
        return ErrInvalidQuantity
    }
    item := NewOrderItem(productID, qty, price)
    o.items = append(o.items, item)
    o.recalculateTotal()  // Tự cập nhật tổng tiền sau mỗi thay đổi
    return nil
}

// Chỉ Order mới biết cách confirm ĐÚNG
func (o *Order) Confirm() error {
    if len(o.items) == 0 {
        return ErrEmptyOrderCannotConfirm     // Rule bảo vệ tại đây
    }
    if o.status != OrderStatusDraft {
        return ErrAlreadyConfirmed
    }
    o.status = OrderStatusConfirmed
    o.addDomainEvent(OrderConfirmedEvent{OrderID: o.id})
    return nil
}
```

#### Ví dụ 2: Fintech — Account Aggregate

Đây là ví dụ quan trọng nhất trong Fintech — sai Aggregate boundary ở đây gây ra lỗi tiền bạc thật.

```go
type Account struct {
    id           AccountID
    balance      Money         // Value Object — không âm
    status       AccountStatus
    dailyLimit   Money         // Business rule: giới hạn 50tr/ngày
    dailyDebited Money         // Track hôm nay đã debit bao nhiêu
}

// Mọi thay đổi balance PHẢI qua Debit/Credit — không ai được gán thẳng
func (a *Account) Debit(amount Money) error {
    // Rule 1: Tài khoản phải active
    if a.status == AccountStatusFrozen {
        return ErrAccountFrozen
    }
    // Rule 2: Số dư phải đủ
    if a.balance.Amount < amount.Amount {
        return ErrInsufficientBalance
    }
    // Rule 3: Không vượt hạn mức ngày
    if a.dailyDebited.Amount+amount.Amount > a.dailyLimit.Amount {
        return ErrExceedsDailyLimit
    }
    // Chỉ sau khi pass hết 3 rules mới thay đổi state
    a.balance.Amount -= amount.Amount
    a.dailyDebited.Amount += amount.Amount
    return nil
}
```

Nếu không có Aggregate, `balance` có thể bị sửa trực tiếp từ bất kỳ service nào mà không kiểm tra gì cả.

#### Ranh giới Aggregate — Gom những gì? Bỏ những gì?

Dùng câu hỏi này để quyết định:

> **"Nếu A thay đổi mà không biết B, có vi phạm business rule không?"**
> - Nếu **Có** → A và B phải cùng một Aggregate.
> - Nếu **Không** → tách ra, tham chiếu qua ID.

```
Order Aggregate:                   Customer Aggregate:
┌──────────────────────────┐       ┌─────────────────────┐
│ Order (Root)             │       │ Customer (Root)     │
│ ├── OrderItem[]      ✅  │       │ ├── name            │
│ ├── ShipAddress      ✅  │       │ ├── email           │
│ ├── OrderStatus      ✅  │       │ └── (thôi)          │
│ └── customerID       ✅  │       └─────────────────────┘
│                          │
│ ❌ Customer object        │  ← Không — chỉ lưu customerID
│ ❌ Payment object         │  ← Không — Payment là Aggregate riêng
│ ❌ 500+ OrderItems        │  ← Cảnh báo: nếu quá lớn, cần tách
└──────────────────────────┘
```

#### Dấu hiệu Aggregate đang bị sai

| Triệu chứng | Vấn đề | Giải pháp |
|-------------|--------|-----------|
| Load Order kéo theo 1000 items | Aggregate quá lớn | Tách `OrderSummary` + `OrderDetails` |
| 2 user cùng lúc bị lỗi lock | Aggregate quá rộng | Thu nhỏ boundary |
| Service khác gán thẳng `order.items = ...` | Không có encapsulation | Dùng method, ẩn fields |
| Muốn query nhưng phải load cả Aggregate | Read model trộn Write model | Áp dụng CQRS |

**Một câu tóm gọn để nhớ:**

> Aggregate Root là **người phát ngôn duy nhất** của một nhóm objects. Muốn thay đổi gì bên trong — phải nói chuyện với anh ấy. Anh ấy sẽ kiểm tra luật, rồi quyết định có làm không.

#### Quy tắc vàng của Aggregate

1. Chỉ tham chiếu đến Aggregate khác thông qua **ID**, không phải object trực tiếp
2. Một transaction chỉ nên thay đổi **một Aggregate**
3. Aggregate phải **luôn ở trạng thái nhất quán** (invariants maintained)
4. Kích thước Aggregate nên **nhỏ** — chỉ gom những gì cần bảo vệ cùng nhau

---

### 3.7 Domain Event

**Định nghĩa:** Sự kiện đã xảy ra trong domain, được đặt tên ở thì quá khứ. Dùng để thông báo cho các phần khác của hệ thống mà không tạo coupling trực tiếp.

```go
// Domain Event — luôn đặt tên thì quá khứ
type OrderConfirmed struct {
    OrderID    OrderID
    CustomerID CustomerID
    TotalAmount Money
    OccurredAt  time.Time
}

type PaymentProcessed struct {
    PaymentID  PaymentID
    OrderID    OrderID
    Amount     Money
    OccurredAt time.Time
}

type UserKYCApproved struct {
    UserID     UserID
    ApprovedBy string
    OccurredAt time.Time
}
```

**Luồng xử lý:**

```
Order.Confirm()
    → Tạo OrderConfirmed event
    → Domain event dispatcher
        → Notification Service: gửi email xác nhận
        → Inventory Service: reserve stock
        → Analytics Service: track conversion
```

---

### 3.8 Repository

**Định nghĩa:** Interface trừu tượng hóa việc lưu trữ và lấy Aggregate. Domain chỉ biết đến interface, không biết PostgreSQL, Redis hay Elasticsearch.

```go
// Interface nằm trong Domain Layer
type OrderRepository interface {
    Save(ctx context.Context, order *Order) error
    FindByID(ctx context.Context, id OrderID) (*Order, error)
    FindByCustomerID(ctx context.Context, customerID CustomerID) ([]*Order, error)
    Delete(ctx context.Context, id OrderID) error
}

// Implementation nằm trong Infrastructure Layer
type postgresOrderRepository struct {
    db *sql.DB
}

func (r *postgresOrderRepository) FindByID(ctx context.Context, id OrderID) (*Order, error) {
    row := r.db.QueryRowContext(ctx, `SELECT ... FROM orders WHERE id = $1`, id.String())
    // Map từ database row → Domain Object
    return mapRowToOrder(row)
}
```

**Quan trọng:** Repository chỉ dành cho **Aggregate Root**, không phải mọi entity.

---

### 3.9 Domain Service

**Định nghĩa:** Logic nghiệp vụ **không tự nhiên thuộc về một Entity hay Value Object cụ thể**, hoặc cần phối hợp nhiều Aggregate.

```go
// Không nên: Order.TransferTo(otherOrder) — một Order không nên biết về Order khác
// Không nên: Payment.CalculateRisk() — Payment không đủ context để tính risk

// Đúng: Domain Service
type TransferService struct {
    riskEngine RiskEngine
}

func (s *TransferService) ExecuteTransfer(
    ctx context.Context,
    fromAccount *Account,
    toAccount *Account,
    amount Money,
) error {
    // Logic nghiệp vụ thuần — không IO, không infra
    if err := fromAccount.Debit(amount); err != nil {
        return err
    }
    riskScore := s.riskEngine.Evaluate(fromAccount, toAccount, amount)
    if riskScore.IsHighRisk() {
        return ErrHighRiskTransaction
    }
    toAccount.Credit(amount)
    return nil
}
```

---

### 3.10 Application Service

**Định nghĩa:** Điều phối luồng use case. Không chứa business logic — chỉ gọi Domain objects và infrastructure.

```go
// Application Service — Use Case: "Xác nhận đơn hàng"
type OrderApplicationService struct {
    orderRepo    OrderRepository
    eventBus     EventBus
    unitOfWork   UnitOfWork
}

func (s *OrderApplicationService) ConfirmOrder(ctx context.Context, cmd ConfirmOrderCommand) error {
    // 1. Load aggregate
    order, err := s.orderRepo.FindByID(ctx, cmd.OrderID)
    if err != nil {
        return err
    }

    // 2. Execute domain logic
    if err := order.Confirm(); err != nil {
        return err
    }

    // 3. Persist
    if err := s.orderRepo.Save(ctx, order); err != nil {
        return err
    }

    // 4. Publish events
    for _, event := range order.DomainEvents() {
        s.eventBus.Publish(ctx, event)
    }

    return nil
}
```

---

### 3.11 Factory

**Định nghĩa:** Đóng gói logic **tạo** Aggregate phức tạp. Đảm bảo object luôn được tạo ở trạng thái hợp lệ.

```go
// Factory method
func NewOrder(customerID CustomerID, items []OrderItemInput) (*Order, error) {
    if len(items) == 0 {
        return nil, ErrMustHaveAtLeastOneItem
    }

    order := &Order{
        id:         NewOrderID(),
        customerID: customerID,
        status:     OrderStatusDraft,
        createdAt:  time.Now(),
    }

    for _, input := range items {
        if err := order.AddItem(input.ProductID, input.Qty, input.Price); err != nil {
            return nil, err
        }
    }

    return order, nil
}
```

---

## 4. Kiến Trúc Phân Tầng Trong DDD

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                    │
│           (HTTP Handler, gRPC, GraphQL, CLI)            │
│         Chuyển đổi request → Application Command/Query  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                  Application Layer                      │
│         (Use Cases / Application Services)              │
│    Điều phối luồng, KHÔNG chứa business logic          │
│    Transaction boundary, Authorization check           │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   Domain Layer ⭐                        │
│    Entity, Value Object, Aggregate, Domain Service      │
│    Domain Event, Repository Interface, Factory         │
│    THUẦN TÚẾT nghiệp vụ, không import infra package   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                Infrastructure Layer                     │
│    PostgreSQL, Redis, RabbitMQ, HTTP clients           │
│    Repository implementations, Event bus impl          │
│    External API adapters (KYC provider, Payment GW)    │
└─────────────────────────────────────────────────────────┘
```

**Dependency Rule:** Phụ thuộc chỉ đi **từ ngoài vào trong**. Domain Layer không được import bất kỳ layer nào khác.

---

## 5. DDD + Clean Architecture

DDD và Clean Architecture **bổ sung cho nhau rất tốt**:

| Clean Architecture | DDD tương ứng |
|-------------------|---------------|
| Entities | Domain Entities + Value Objects |
| Use Cases | Application Services |
| Interface Adapters | Controllers, Presenters, Repository Impls |
| Frameworks & Drivers | Infrastructure (DB, MQ, external APIs) |

**Cấu trúc thư mục Golang điển hình:**

```
my-service/
├── cmd/
│   └── server/
│       └── main.go
│
├── internal/
│   ├── domain/                    ← Domain Layer (thuần túy)
│   │   ├── order/
│   │   │   ├── order.go           ← Aggregate Root
│   │   │   ├── order_item.go      ← Entity
│   │   │   ├── order_status.go    ← Value Object
│   │   │   ├── money.go           ← Value Object
│   │   │   ├── repository.go      ← Repository Interface
│   │   │   ├── events.go          ← Domain Events
│   │   │   └── service.go         ← Domain Service
│   │   └── customer/
│   │       ├── customer.go
│   │       └── repository.go
│   │
│   ├── application/               ← Application Layer
│   │   ├── command/
│   │   │   ├── confirm_order.go
│   │   │   └── create_order.go
│   │   └── query/
│   │       └── get_order.go
│   │
│   ├── infrastructure/            ← Infrastructure Layer
│   │   ├── persistence/
│   │   │   ├── postgres/
│   │   │   │   └── order_repo.go  ← Repository Implementation
│   │   │   └── redis/
│   │   │       └── cache.go
│   │   ├── messaging/
│   │   │   └── rabbitmq/
│   │   │       └── event_bus.go
│   │   └── external/
│   │       └── payment_gateway.go
│   │
│   └── interfaces/                ← Presentation Layer
│       ├── http/
│       │   ├── handler/
│       │   │   └── order_handler.go
│       │   └── middleware/
│       └── grpc/
│           └── order_server.go
│
├── pkg/                           ← Shared utilities (không chứa domain logic)
│   ├── logger/
│   ├── errors/
│   └── pagination/
│
└── go.mod
```

---

## 6. DDD Trong Thực Tế — Ví Dụ Golang

### Ví dụ: Hệ thống chuyển tiền (Fintech)

#### Domain Layer

```go
// internal/domain/account/account.go

package account

import (
    "errors"
    "time"
)

// Value Objects
type AccountID string
type CustomerID string

type Money struct {
    Amount   float64
    Currency string
}

func (m Money) IsZeroOrNegative() bool { return m.Amount <= 0 }

func (m Money) Subtract(other Money) (Money, error) {
    if m.Currency != other.Currency {
        return Money{}, errors.New("currency mismatch")
    }
    if m.Amount < other.Amount {
        return Money{}, ErrInsufficientBalance
    }
    return Money{Amount: m.Amount - other.Amount, Currency: m.Currency}, nil
}

// Domain Errors
var (
    ErrInsufficientBalance    = errors.New("insufficient balance")
    ErrAccountFrozen          = errors.New("account is frozen")
    ErrExceedsDailyLimit      = errors.New("exceeds daily transfer limit")
    ErrInvalidTransferAmount  = errors.New("transfer amount must be positive")
)

// Domain Events
type MoneyDebited struct {
    AccountID  AccountID
    Amount     Money
    OccurredAt time.Time
}

type MoneyCredited struct {
    AccountID  AccountID
    Amount     Money
    OccurredAt time.Time
}

// Account — Aggregate Root
type Account struct {
    id           AccountID
    customerID   CustomerID
    balance      Money
    status       AccountStatus
    dailyDebited Money
    domainEvents []interface{}
}

func NewAccount(customerID CustomerID, initialDeposit Money) (*Account, error) {
    if initialDeposit.IsZeroOrNegative() {
        return nil, ErrInvalidTransferAmount
    }
    return &Account{
        id:         AccountID(generateID()),
        customerID: customerID,
        balance:    initialDeposit,
        status:     AccountStatusActive,
    }, nil
}

// Business rule: Debit với validation đầy đủ
func (a *Account) Debit(amount Money) error {
    if a.status == AccountStatusFrozen {
        return ErrAccountFrozen
    }
    if amount.IsZeroOrNegative() {
        return ErrInvalidTransferAmount
    }

    newBalance, err := a.balance.Subtract(amount)
    if err != nil {
        return err
    }

    // Business rule: Daily limit
    newDailyDebited := Money{
        Amount:   a.dailyDebited.Amount + amount.Amount,
        Currency: amount.Currency,
    }
    if newDailyDebited.Amount > 50_000_000 { // 50tr VND/ngày
        return ErrExceedsDailyLimit
    }

    a.balance = newBalance
    a.dailyDebited = newDailyDebited

    // Emit domain event
    a.domainEvents = append(a.domainEvents, MoneyDebited{
        AccountID:  a.id,
        Amount:     amount,
        OccurredAt: time.Now(),
    })

    return nil
}

func (a *Account) Credit(amount Money) error {
    if a.status == AccountStatusFrozen {
        return ErrAccountFrozen
    }
    a.balance = Money{
        Amount:   a.balance.Amount + amount.Amount,
        Currency: amount.Currency,
    }
    a.domainEvents = append(a.domainEvents, MoneyCredited{
        AccountID:  a.id,
        Amount:     amount,
        OccurredAt: time.Now(),
    })
    return nil
}

func (a *Account) DomainEvents() []interface{} { return a.domainEvents }
func (a *Account) ClearEvents()                { a.domainEvents = nil }
func (a *Account) Balance() Money              { return a.balance }
func (a *Account) ID() AccountID              { return a.id }
```

```go
// internal/domain/account/repository.go

package account

import "context"

type Repository interface {
    Save(ctx context.Context, account *Account) error
    FindByID(ctx context.Context, id AccountID) (*Account, error)
    FindByCustomerID(ctx context.Context, customerID CustomerID) ([]*Account, error)
}
```

```go
// internal/domain/transfer/transfer_service.go

package transfer

import (
    "context"
    "myservice/internal/domain/account"
)

// Domain Service — logic cần 2 aggregate
type TransferDomainService struct{}

func (s *TransferDomainService) Transfer(
    ctx context.Context,
    from *account.Account,
    to *account.Account,
    amount account.Money,
) error {
    if err := from.Debit(amount); err != nil {
        return err
    }
    if err := to.Credit(amount); err != nil {
        // Compensate
        _ = from.Credit(amount)
        return err
    }
    return nil
}
```

#### Application Layer

```go
// internal/application/command/transfer_money.go

package command

import (
    "context"
    "myservice/internal/domain/account"
    "myservice/internal/domain/transfer"
)

type TransferMoneyCommand struct {
    FromAccountID string
    ToAccountID   string
    Amount        float64
    Currency      string
}

type TransferMoneyHandler struct {
    accountRepo   account.Repository
    transferSvc   *transfer.TransferDomainService
    eventBus      EventBus
    unitOfWork    UnitOfWork
}

func (h *TransferMoneyHandler) Handle(ctx context.Context, cmd TransferMoneyCommand) error {
    return h.unitOfWork.Execute(ctx, func(ctx context.Context) error {
        // 1. Load aggregates
        from, err := h.accountRepo.FindByID(ctx, account.AccountID(cmd.FromAccountID))
        if err != nil {
            return err
        }

        to, err := h.accountRepo.FindByID(ctx, account.AccountID(cmd.ToAccountID))
        if err != nil {
            return err
        }

        amount := account.Money{Amount: cmd.Amount, Currency: cmd.Currency}

        // 2. Domain logic
        if err := h.transferSvc.Transfer(ctx, from, to, amount); err != nil {
            return err
        }

        // 3. Persist
        if err := h.accountRepo.Save(ctx, from); err != nil {
            return err
        }
        if err := h.accountRepo.Save(ctx, to); err != nil {
            return err
        }

        // 4. Publish events
        for _, event := range from.DomainEvents() {
            h.eventBus.Publish(ctx, event)
        }
        for _, event := range to.DomainEvents() {
            h.eventBus.Publish(ctx, event)
        }

        return nil
    })
}
```

---

## 7. Ưu Điểm

### ✅ Business Logic tập trung và rõ ràng

Toàn bộ quy tắc nghiệp vụ nằm trong Domain Layer. Khi cần thay đổi rule → biết ngay vào đâu sửa.

### ✅ Code phản ánh nghiệp vụ thực tế

Developer mới join project đọc code hiểu được business flow, không cần hỏi BA.

### ✅ Dễ test

Domain objects không phụ thuộc database, HTTP, hay bất kỳ infra nào → unit test cực nhanh và đơn giản.

```go
func TestAccount_Debit_InsufficientBalance(t *testing.T) {
    acc, _ := NewAccount("cust-1", Money{Amount: 100, Currency: "VND"})
    err := acc.Debit(Money{Amount: 200, Currency: "VND"})
    assert.ErrorIs(t, err, ErrInsufficientBalance)
}
// Không cần mock DB, không cần HTTP server
```

### ✅ Isolation giữa các Bounded Context

Thay đổi trong Payment Context không ảnh hưởng Notification Context → giảm risk khi deploy.

### ✅ Phù hợp với Microservices

Mỗi Bounded Context → một microservice. Ranh giới tự nhiên, rõ ràng.

### ✅ Ubiquitous Language giảm miscommunication

Developer và business nói chuyện cùng ngôn ngữ → ít bug do hiểu sai yêu cầu.

---

## 8. Nhược Điểm & Cạm Bẫy

### ❌ Learning Curve cao

Team cần thời gian học DDD. Nếu áp dụng sai → phức tạp không đáng.

**Giải pháp:** Bắt đầu với Strategic DDD (Bounded Context) trước, Tactical DDD (Entity, Aggregate...) sau.

### ❌ Over-engineering với hệ thống nhỏ

CRUD app đơn giản không cần DDD. Thêm DDD vào → tốn 3x thời gian, không có lợi ích tương xứng.

### ❌ Khó xác định Aggregate boundary

Sai Aggregate boundary → hoặc transaction quá lớn (performance kém), hoặc business rules bị vi phạm.

**Dấu hiệu Aggregate quá lớn:**
- Load một Order kéo theo 500 OrderItems
- Nhiều user lock cùng một Aggregate

### ❌ Tốn boilerplate code

So với CRUD đơn giản, DDD cần nhiều interface, struct, và mapping code hơn.

### ❌ N+1 query nếu không cẩn thận

Repository trả về từng Aggregate → dễ bị N+1. Cần tách Read Model (CQRS) cho query phức tạp.

### ❌ Cần sự tham gia của Domain Expert

DDD không hiệu quả nếu developer không được làm việc trực tiếp với BA/PM để hiểu domain. Nếu chỉ nhận spec qua ticket → mất 50% giá trị của DDD.

---

## 9. Khi Nào Nên Dùng DDD? Khi Nào KHÔNG Nên?

### ✅ NÊN dùng DDD khi:

| Điều kiện | Ví dụ |
|-----------|-------|
| **Nghiệp vụ phức tạp** | Fintech, Insurance, Healthcare, Logistics |
| **Domain thay đổi thường xuyên** | Rule phí, điều kiện vay vốn, thuế |
| **Team lớn** (≥ 5 dev backend) | Cần ranh giới rõ ràng giữa module |
| **Long-lived system** | Sản phẩm phát triển nhiều năm |
| **Microservices** | Cần tách service theo business capability |
| **Domain Expert có thể làm việc cùng** | BA/PM tham gia vào thiết kế model |

### ❌ KHÔNG nên dùng DDD khi:

| Điều kiện | Thay thế |
|-----------|---------|
| **CRUD đơn giản** (admin panel, form nhập liệu) | Repository pattern đơn giản, Active Record |
| **Prototype / MVP** cần ship nhanh | Layered architecture đơn giản |
| **Data pipeline / ETL** | Không có "behavior", chỉ transform data |
| **Team nhỏ** (1-2 dev) | YAGNI — đừng over-engineer |
| **Domain đơn giản, ổn định** | Simple CRUD + clean code là đủ |
| **Script / tool nội bộ** | Viết thẳng, không cần layer |

### 📏 Rule of thumb:

> **"Nếu bạn có thể viết toàn bộ business rules của mình lên 1 trang A4 → DDD có thể là overkill."**

---

## 10. Anti-patterns Cần Tránh

### ❌ Anemic Domain Model

Entity chỉ là data holder, không có behavior. Logic nằm trong Service.

```go
// ❌ ANTI-PATTERN: Anemic Model
type Order struct {
    ID     string
    Status string
    Items  []Item
}

// Logic nằm ngoài Entity — sai!
type OrderService struct{}
func (s *OrderService) ConfirmOrder(order *Order) error {
    if len(order.Items) == 0 { ... }
    order.Status = "confirmed"
    return nil
}

// ✅ ĐÚNG: Rich Domain Model
func (o *Order) Confirm() error {
    if len(o.items) == 0 {
        return ErrEmptyOrder
    }
    o.status = OrderStatusConfirmed
    return nil
}
```

### ❌ God Aggregate

Một Aggregate chứa quá nhiều thứ → khó scale, lock contention cao.

```go
// ❌ Sai: Customer biết hết mọi thứ
type Customer struct {
    id       CustomerID
    orders   []*Order      // Không — Order là Aggregate riêng
    payments []*Payment    // Không — Payment là Aggregate riêng
    addresses []*Address   // OK nếu số lượng nhỏ và cần bảo vệ cùng nhau
}

// ✅ Đúng: Tách thành Aggregate riêng, tham chiếu qua ID
type Order struct {
    customerID CustomerID  // Chỉ lưu ID, không lưu object
}
```

### ❌ Domain logic trong Application Service

```go
// ❌ Sai: Business rule trong Application Service
func (s *OrderService) ConfirmOrder(ctx context.Context, orderID string) error {
    order, _ := s.repo.FindByID(ctx, orderID)
    if len(order.Items) == 0 {   // Business rule rò rỉ ra ngoài Domain!
        return errors.New("empty order")
    }
    order.Status = "confirmed"
    return s.repo.Save(ctx, order)
}

// ✅ Đúng: Logic trong Domain
func (s *OrderAppService) ConfirmOrder(ctx context.Context, orderID string) error {
    order, _ := s.repo.FindByID(ctx, orderID)
    if err := order.Confirm(); err != nil {  // Domain quyết định
        return err
    }
    return s.repo.Save(ctx, order)
}
```

### ❌ Bypass Repository với ORM trực tiếp

```go
// ❌ Sai: Application Service dùng gorm trực tiếp
func (s *Service) Handle(ctx context.Context) {
    s.db.Where("status = ?", "draft").Find(&orders)  // Infrastructure leak!
}

// ✅ Đúng: Qua Repository interface
func (s *Service) Handle(ctx context.Context) {
    orders, _ := s.orderRepo.FindByStatus(ctx, OrderStatusDraft)
}
```

---

## 11. DDD & Microservices

DDD và Microservices là **cặp đôi hoàn hảo**. Bounded Context định nghĩa **ranh giới tự nhiên** cho microservice.

```
┌─────────────────────────────────────────────────────────────────┐
│                        DDD Domain Map                          │
│                                                                │
│  ┌─────────────────┐    ┌─────────────────┐                   │
│  │  Identity BC    │    │   Order BC      │                   │
│  │  auth-service   │    │  order-service  │                   │
│  └────────┬────────┘    └────────┬────────┘                   │
│           │ ACL                  │ Domain Event               │
│  ┌────────▼────────┐    ┌────────▼────────┐                   │
│  │  Customer BC    │    │  Payment BC     │                   │
│  │ customer-service│    │ payment-service │                   │
│  └─────────────────┘    └────────┬────────┘                   │
│                                  │ Domain Event               │
│                         ┌────────▼────────┐                   │
│                         │ Notification BC │                   │
│                         │ notif-service   │                   │
│                         └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Giao tiếp giữa Bounded Contexts:

| Cách | Khi nào dùng |
|------|-------------|
| **Synchronous (REST/gRPC)** | Cần response ngay, query data |
| **Asynchronous (Domain Events via MQ)** | Thông báo thay đổi, eventual consistency OK |
| **Shared Database** | ❌ Tránh — phá vỡ Bounded Context isolation |

---

## 12. Tóm Tắt Nhanh — Quick Reference

### Bảng tham chiếu nhanh

| Khái niệm | Vai trò | Có ID không? | Mutable? |
|-----------|---------|-------------|---------|
| Entity | Đối tượng có lifecycle | ✅ | ✅ |
| Value Object | Mô tả giá trị | ❌ | ❌ (immutable) |
| Aggregate Root | Đứng đầu aggregate, entry point | ✅ | ✅ |
| Domain Service | Logic không thuộc về entity nào | ❌ | - |
| Application Service | Điều phối use case | ❌ | - |
| Repository | Trừu tượng hóa lưu trữ | ❌ | - |
| Domain Event | Sự kiện đã xảy ra | ❌ | ❌ (immutable) |

### Checklist khi áp dụng DDD

- [ ] Xác định được **Core Domain** của sản phẩm
- [ ] Vẽ được **Context Map** cho các Bounded Context
- [ ] Đã thống nhất **Ubiquitous Language** với BA/PM
- [ ] Domain Layer **không import** bất kỳ infrastructure package nào
- [ ] Business rules nằm trong **Entity/Value Object**, không nằm trong Service
- [ ] Repository có **interface trong Domain**, implementation trong Infrastructure
- [ ] Aggregate **nhỏ** và có ranh giới rõ ràng
- [ ] Domain Event được đặt tên ở **thì quá khứ**
- [ ] Unit test Domain Layer **không cần mock database**

---

## Tài Liệu Tham Khảo

- 📘 **"Domain-Driven Design"** — Eric Evans (The Blue Book)
- 📗 **"Implementing Domain-Driven Design"** — Vaughn Vernon (The Red Book)
- 📙 **"Learning Domain-Driven Design"** — Vlad Khononov (mới hơn, dễ đọc hơn)
- 🌐 **Domain-Driven Design Reference** — Eric Evans (free PDF)
- 🎥 **DDD Europe Conference** talks trên YouTube

---

> ✍️ **Tác giả:** Backend Team  
> 📅 **Cập nhật:** 2025  
> 🔖 **Tags:** `DDD`, `Clean Architecture`, `Golang`, `Backend`, `Microservices`, `Fintech`
