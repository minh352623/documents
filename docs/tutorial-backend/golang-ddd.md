# 🏗️ Go DDD Template — Hướng Dẫn Kiến Trúc Chi Tiết

> **Dành cho team member** — Bài viết này giải thích toàn bộ cấu trúc thư mục của template Go DDD, giúp bạn hiểu **tại sao** mỗi folder tồn tại, **chứa gì** bên trong, và **khi nào** bạn cần sửa ở đâu.

---

## 📖 Mục Lục

- [Tổng Quan Kiến Trúc](#-tổng-quan-kiến-trúc)
- [Cấu Trúc Thư Mục Toàn Cảnh](#-cấu-trúc-thư-mục-toàn-cảnh)
- [Chi Tiết Từng Folder](#-chi-tiết-từng-folder)
  - [cmd/ — Điểm Khởi Đầu](#1-cmd--điểm-khởi-đầu-ứng-dụng)
  - [internal/ — Trái Tim Dự Án](#2-internal--trái-tim-của-dự-án)
  - [pkg/ — Thư Viện Dùng Chung](#3-pkg--thư-viện-dùng-chung)
  - [utils/ — Tiện Ích Nhỏ](#4-utils--tiện-ích-nhỏ)
  - [Các File & Folder Khác](#5-các-file--folder-khác)
- [Giải Thích Module Theo 4 Layer DDD](#-giải-thích-module-theo-4-layer-ddd)
- [Luồng Xử Lý Một Request](#-luồng-xử-lý-một-request)
- [Các Pattern Quan Trọng](#-các-pattern-quan-trọng)
- [Hướng Dẫn Bắt Đầu](#-hướng-dẫn-bắt-đầu)

---

## 🎯 Tổng Quan Kiến Trúc

Template này áp dụng **Domain-Driven Design (DDD)** kết hợp **Clean Architecture**. Ý tưởng cốt lõi:

| Nguyên tắc | Giải thích |
|---|---|
| **Dependencies chỉ đi từ ngoài vào trong** | Controller → Service → Domain. Domain **không bao giờ** phụ thuộc tầng ngoài. |
| **Domain là trung tâm** | Business logic sống trong `domain/`, không phải trong handler hay repository. |
| **Interface Segregation** | Mỗi interface chỉ chứa các method cần thiết (ví dụ: tách `ProductReader` và `ProductWriter`). |
| **Dependency Injection** | Mọi dependency được inject qua constructor, không dùng global variable. |
| **Inter-Module Communication** | Module giao tiếp qua **interface + adapter**, không import trực tiếp nhau. |

```
┌─────────────────────────────────────────────────────┐
│                   Controller Layer                   │
│            (HTTP handlers, DTOs, routing)            │
├─────────────────────────────────────────────────────┤
│                  Application Layer                   │
│          (Service interfaces & implementations)      │
├─────────────────────────────────────────────────────┤
│                    Domain Layer                      │
│    (Entities, Value Objects, Repository Interfaces,  │
│     Domain Services, Domain Errors)                  │
├─────────────────────────────────────────────────────┤
│                Infrastructure Layer                  │
│   (DB repositories, Mappers, Models, Adapters,       │
│    Cache implementations)                            │
└─────────────────────────────────────────────────────┘
```

---

## 📂 Cấu Trúc Thư Mục Toàn Cảnh

```
go-ddd/
├── cmd/                          # ① Entrypoint — nơi ứng dụng bắt đầu chạy
│   ├── drunk/main.go             #    Hàm main(), graceful shutdown, Swagger
│   └── swag/docs/                #    Swagger generated docs (auto-gen)
│
├── internal/                     # ② Core — toàn bộ business logic
│   ├── auth/                     #    Module Authentication
│   │   ├── application/          #      → Service layer
│   │   ├── controller/           #      → HTTP handlers + DTOs
│   │   ├── domain/               #      → Entities, Value Objects, Errors
│   │   └── infrastructure/       #      → DB repos, Cache implementations
│   │
│   ├── product/                  #    Module Product
│   │   ├── application/          #      → Service layer
│   │   ├── controller/           #      → HTTP handlers + DTOs
│   │   ├── domain/               #      → Entities, Repository Interfaces
│   │   └── infrastructure/       #      → DB repos, Mappers, Adapters
│   │
│   ├── initialize/               #    Dependency Injection & App Bootstrap
│   │   ├── auth/                 #      DI cho module Auth
│   │   ├── product/              #      DI cho module Product
│   │   ├── config.go             #      Load & validate config từ .env
│   │   ├── mysql.go              #      Kết nối MySQL/GORM
│   │   ├── redis.go              #      Kết nối Redis
│   │   ├── router.go             #      Đăng ký routes + middleware
│   │   └── run.go                #      Orchestrate toàn bộ init flow
│   │
│   ├── middleware/               #    Middleware dùng chung
│   │   ├── cors.go               #      CORS configuration
│   │   ├── guards.go             #      HMAC authentication guard
│   │   └── validation.go         #      Request validation
│   │
│   └── common/                   #    Code dùng chung giữa các module
│
├── pkg/                          # ③ Public packages — ai cũng dùng được
│   ├── apperror/error.go         #    Custom AppError type + HTTP mapping
│   └── response/                 #    API response envelope + Wrap pattern
│       ├── response.go           #      SuccessResponse, ErrorResponse, Wrap()
│       └── codeErr.go            #      APIError type cho controller
│
├── utils/                        # ④ Tiện ích nhỏ
│   ├── validator.go              #    Custom validation rules
│   └── cache.go                  #    Cache utilities
│
├── environment/                  #    Environment-specific configs (placeholder)
├── global/                       #    Global variables (placeholder — hạn chế dùng)
├── scripts/                      #    Build & deployment scripts
│
├── .env_dev                      #    Biến môi trường cho development
├── Dockerfile                    #    Docker build configuration
├── Makefile                      #    Các lệnh make tiện dụng
├── init.sql                      #    Database schema initialization
├── go.mod / go.sum               #    Go module dependencies
└── golang_best_practices.md      #    Tài liệu best practices nội bộ
```

---

## 🔍 Chi Tiết Từng Folder

### 1. `cmd/` — Điểm Khởi Đầu Ứng Dụng

**Chức năng**: Chứa hàm `main()` — nơi ứng dụng bắt đầu cuộc đời.

```
cmd/
├── drunk/main.go        # Entry point chính
└── swag/docs/           # Swagger docs tự động sinh
```

**`cmd/drunk/main.go`** làm 3 việc:
1. Gọi `initialize.Run()` để khởi tạo config, DB, router
2. Mount Swagger UI tại `/swagger/*any`
3. Chạy HTTP server với **Graceful Shutdown** — khi nhận signal `SIGINT/SIGTERM`, server sẽ đợi tối đa 30s cho các request đang xử lý hoàn thành trước khi tắt

> **Khi nào sửa?** Rất ít khi. Chỉ sửa khi cần thay đổi Swagger config hoặc shutdown behavior.

---

### 2. `internal/` — Trái Tim Của Dự Án

Đây là thư mục quan trọng nhất, chứa **toàn bộ business logic**. Go convention: `internal/` không thể import từ bên ngoài module.

#### 2.1. Các Module Nghiệp Vụ (`auth/`, `product/`)

Mỗi module là một **Bounded Context** trong DDD, có cấu trúc 4 layer giống nhau:

```
[module]/
├── domain/              # 🧠 Tầng Domain — Business logic thuần
│   ├── model/
│   │   ├── entity/      #   Entities (Product, Account...)
│   │   └── valueobject/ #   Value Objects (Email, Username...)
│   ├── repository/      #   Repository INTERFACES (không phải implementation!)
│   ├── service/         #   Domain Services (logic phức tạp span nhiều entity)
│   ├── cache/           #   Cache INTERFACES
│   └── errors.go        #   Sentinel Errors riêng cho module
│
├── application/         # ⚙️ Tầng Application — Điều phối use cases
│   ├── service/
│   │   ├── *.service.go      # Service INTERFACE
│   │   ├── *.service.impl.go # Service IMPLEMENTATION
│   │   ├── *_service_test.go # Unit tests
│   │   └── dto/              # Application DTOs (input/output cho service)
│   └── schedule/             # Scheduled tasks / cron jobs
│
├── controller/          # 🌐 Tầng Controller — Giao tiếp với bên ngoài
│   ├── http/
│   │   ├── *.handler.go  # HTTP handlers (dùng response.Wrap)
│   │   └── *.router.go   # Route registration
│   └── dto/
│       └── *.req.go      # Request DTOs (binding + validation tags)
│
└── infrastructure/      # 🔧 Tầng Infrastructure — Implement chi tiết kỹ thuật
    ├── persistence/
    │   ├── repository/   # Repository IMPLEMENTATIONS (GORM queries)
    │   ├── model/        # Database models (GORM tags)
    │   └── mapper/       # Domain Entity ↔ DB Model converter
    ├── adapter/          # Inter-module adapters
    └── cache/            # Cache implementations (Redis...)
```

> **Quy tắc vàng**: Dependencies chỉ đi **từ ngoài vào trong**: `controller → application → domain ← infrastructure`.

> **Domain KHÔNG BAO GIỜ import** controller, application, hay infrastructure.

---

#### 2.2. `internal/initialize/` — Dependency Injection

**Chức năng**: Nơi "lắp ráp" (wiring) toàn bộ dependencies. Đây là **Composition Root** của ứng dụng.

```
initialize/
├── run.go          # Orchestrate: LoadConfig → InitDB → InitRouter
├── config.go       # Load config từ .env, validate required fields
├── mysql.go        # Khởi tạo GORM DB connection
├── redis.go        # Khởi tạo Redis connection
├── router.go       # Đăng ký middleware + routes cho tất cả modules
├── auth/
│   ├── repository.go  # Wire auth repositories
│   └── service.go     # Wire auth services
└── product/
    └── init.go        # Wire product repo → adapter → service → handler
```

**Luồng khởi tạo**:
```
main.go
  └── initialize.Run()
        ├── LoadConfig()     → Đọc .env_dev, crash nếu thiếu field
        ├── InitDB()         → Kết nối MySQL qua GORM
        └── InitRouter()     → Tạo gin.Engine
              ├── Middleware: CORS, Validator
              ├── initAuth.InitAuth(db) → authHandler
              └── initProduct.InitProduct(db) → productHandler
                    ├── NewProductRepository(db)
                    ├── NewAuthRepository(db)
                    ├── NewAuthUserVerifier(authRepo)  ← Adapter Pattern!
                    ├── NewProductService(repo, verifier)
                    └── NewProductHandler(service)
```

> **Khi nào sửa?** Mỗi khi thêm module mới hoặc thêm dependency vào service.

---

#### 2.3. `internal/middleware/` — Middleware Dùng Chung

| File | Chức năng |
|---|---|
| `cors.go` | Cấu hình CORS headers cho cross-origin requests |
| `guards.go` | HMAC signature authentication — verify `X-Sign` + `X-Request-Time` headers |
| `validation.go` | Custom validation middleware |

**HMAC Guard** hoạt động:
1. Client gửi `X-Sign` (HMAC signature) và `X-Request-Time` (Unix timestamp)
2. Server rebuild "string-to-sign" từ: `METHOD\nPATH\nTIMESTAMP\nQUERY\nBODY`
3. Server tính HMAC-SHA256 với shared secret key
4. So sánh timing-safe với `hmac.Equal()`

---

### 3. `pkg/` — Thư Viện Dùng Chung

Các package trong `pkg/` có thể được import bởi **bất kỳ module nào** trong `internal/`.

#### 3.1. `pkg/apperror/` — Custom Error Type

```go
type AppError struct {
    Code    string                 // Machine-readable: "PRODUCT_NOT_FOUND"
    Message string                 // Human-readable: "product not found"
    Details map[string]interface{} // Optional metadata
    Err     error                  // Wrapped original error
}
```

**Tại sao cần AppError?**
- Mỗi error có **mã lỗi** (Code) để client xử lý programmatically
- Hỗ trợ `errors.Is()` / `errors.As()` qua method `Unwrap()`
- `MapCodeToHTTPStatus()` tự động map: `PRODUCT_NOT_FOUND → 404`, `UNAUTHORIZED → 401`...

**Cách dùng trong domain**:
```go
// Khai báo sentinel errors trong domain/errors.go
var ErrProductNotFound = apperror.NewAppError("PRODUCT_NOT_FOUND", "product not found")

// Sử dụng trong service
return nil, domain.ErrProductNotFound.Wrap(err)
```

#### 3.2. `pkg/response/` — API Response Chuẩn

Mọi API response đều tuân theo cấu trúc envelope:
```json
{
  "code": 200,
  "message": "success",
  "data": { ... },
  "error": null
}
```

**Pattern `response.Wrap()`** — Handler chỉ cần return `(data, error)`, framework tự xử lý HTTP response:
```go
// Trong router:
products.GET("/:id", response.Wrap(handler.GetProduct))

// Trong handler — không cần gọi c.JSON() thủ công:
func (h *ProductHandler) GetProduct(ctx *gin.Context) (res interface{}, err error) {
    product, err := h.service.GetProductByID(ctx, id)
    if err != nil {
        return nil, err  // Wrap() tự map AppError → HTTP status
    }
    return product, nil  // Wrap() tự trả 200 OK
}
```

---

### 4. `utils/` — Tiện Ích Nhỏ

| File | Chức năng |
|---|---|
| `validator.go` | Custom validation rules cho gin binding |
| `cache.go` | Cache utility helpers |

---

### 5. Các File & Folder Khác

| File/Folder | Chức năng |
|---|---|
| `.env_dev` | Biến môi trường: DB connection, server port, log level |
| `Makefile` | Lệnh tiện dụng: `make start`, `make build`, `make swag` |
| `Dockerfile` | Containerize ứng dụng |
| `init.sql` | SQL schema cho lần chạy đầu tiên |
| `environment/` | Configs theo môi trường (dev/staging/prod) — placeholder |
| `global/` | Global vars — **hạn chế sử dụng**, ưu tiên DI |
| `scripts/` | Build & deploy scripts |

---

## 🧩 Giải Thích Module Theo 4 Layer DDD

Lấy module **Product** làm ví dụ minh họa — mỗi layer có vai trò rõ ràng:

### Layer 1: Domain — "Cái gì?"

> Business logic thuần, **không biết** database hay HTTP là gì.

| Thành phần | File | Vai trò |
|---|---|---|
| **Entity** | `domain/model/entity/product.go` | Struct `Product` với business methods: `CanPurchase()`, `ReduceStock()` |
| **Repository Interface** | `domain/repository/product_reader.go` | Interface `ProductReader`: `FindByID`, `ListWithPagination` |
| | `domain/repository/product_writer.go` | Interface `ProductWriter`: `Create`, `Update`, `ReduceStock` |
| | `domain/repository/user_verifier.go` | Interface `UserVerifier`: verify user tồn tại (inter-module) |
| **Sentinel Errors** | `domain/errors.go` | `ErrProductNotFound`, `ErrInvalidPrice`, `ErrInsufficientStock`... |

**Tại sao tách Reader/Writer?**
→ **Interface Segregation Principle (ISP)**. Service chỉ cần đọc? Inject `ProductReader`. Chỉ cần ghi? Inject `ProductWriter`. Không ép buộc implement method không cần thiết.

---

### Layer 2: Application — "Làm thế nào?"

> Điều phối use cases, gọi domain logic và repositories.

| Thành phần | File | Vai trò |
|---|---|---|
| **Service Interface** | `application/service/product.service.go` | Định nghĩa: `CreateProduct`, `GetProductByID`, `ListProducts` |
| **Service Impl** | `application/service/product.service.impl.go` | Implement: validate → verify user → build entity → persist |
| **Application DTOs** | `application/service/dto/product.dto.go` | `CreateProductDTO`, `PaginationReq`, `PaginatedResult[T]` |
| **Unit Tests** | `application/service/product_service_test.go` | Test service logic với mock repositories |

---

### Layer 3: Controller — "Ai gọi?"

> Nhận HTTP request, validate input, trả response. **Không chứa business logic.**

| Thành phần | File | Vai trò |
|---|---|---|
| **Handler** | `controller/http/product.handler.go` | Parse request → gọi service → return result (Wrap pattern) |
| **Router** | `controller/http/product.router.go` | `POST /products`, `GET /products/:id`, `GET /products` |
| **Request DTOs** | `controller/dto/product.req.go` | `CreateProductReq` (binding tags: `required,min=2,max=255`) |

**2 loại DTO khác nhau — tại sao?**
- `controller/dto` → validation tags cho HTTP binding (`binding:"required"`)
- `application/service/dto` → clean data cho business logic (không có binding tags)
- Tách ra để controller thay đổi validation mà không ảnh hưởng service.

---

### Layer 4: Infrastructure — "Bằng cách nào?"

> Implement chi tiết kỹ thuật: MySQL queries, Redis cache, inter-module adapters.

| Thành phần | File | Vai trò |
|---|---|---|
| **DB Repository** | `infrastructure/persistence/repository/product.repo.go` | GORM queries: `FindByID`, `Create`, `ReduceStock` (transaction) |
| **DB Model** | `infrastructure/persistence/model/product.model.go` | GORM struct với column tags, `TableName()` |
| **Mapper** | `infrastructure/persistence/mapper/product.mapper.go` | `ToDomain()`, `ToModel()`, `ToDomainList()` |
| **Adapter** | `infrastructure/adapter/auth_adapter.go` | `AuthUserVerifier` — gọi auth repo để verify user |

**Tại sao cần Mapper?**
→ Domain Entity và DB Model là 2 struct **khác nhau**. Entity phản ánh business concept, Model phản ánh database schema (GORM tags, column names). Mapper chuyển đổi qua lại giữa chúng.

---

## 🔄 Luồng Xử Lý Một Request

Ví dụ: `POST /v1/2025/products` — Tạo sản phẩm mới.

```
Client Request
    │
    ▼
① [Router]  response.Wrap(handler.CreateProduct)
    │
    ▼
② [Handler] Parse JSON body → CreateProductReq (validation)
    │        Chuyển thành CreateProductDTO
    │
    ▼
③ [Service] Guard clauses: name rỗng? price ≤ 0?
    │        Verify creator tồn tại (qua UserVerifier adapter)
    │        Build domain entity Product
    │        Gọi repo.Create()
    │
    ▼
④ [Repository] mapper.ToModel(entity) → ProductModel
    │           GORM: db.Create(model)
    │           Return productID
    │
    ▼
⑤ [Wrap()]  Không error? → 200 {"code":200, "data":{"product_id":1}}
             Có AppError? → Map code→HTTP status tự động
             Error khác?  → 500 + log server-side
```

---

## ⭐ Các Pattern Quan Trọng

### 1. Adapter Pattern — Giao Tiếp Giữa Các Module

Module `product` cần kiểm tra user có tồn tại không, nhưng **không được import trực tiếp** module `auth`.

```
product/domain/repository/user_verifier.go     ← Interface (Consumer sở hữu)
product/infrastructure/adapter/auth_adapter.go  ← Adapter (implement interface)
    └── Gọi auth/domain/repository.AuthRepository.GetById()
```

**Lợi ích**: Khi `auth` tách thành microservice, chỉ cần thay `AuthUserVerifier` bằng `HTTPAuthAdapter` — **không sửa bất kỳ dòng nào** trong service logic.

### 2. Wrap() Pattern — Error ↔ HTTP Status Tự Động

```
Handler return error
    ├── *APIError    → dùng StatusCode trực tiếp (controller error)
    ├── *AppError    → MapCodeToHTTPStatus() (domain/app error)
    └── other error  → 500 + log (không bao giờ expose nội bộ)
```

### 3. Compile-Time Interface Check

```go
// Trong repository implementation:
var _ domainRepo.ProductRepository = (*ProductRepository)(nil)

// Nếu ProductRepository thiếu method, GO compiler báo lỗi NGAY
// → Không cần đợi runtime mới biết
```

### 4. Config Validation — Crash Early

```go
// App crash ngay khi khởi động nếu thiếu config, không đợi request đầu tiên mới lỗi
var requiredFields = []string{"DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_NAME", "SERVER_PORT"}
```

---

## 🚀 Hướng Dẫn Bắt Đầu

### Yêu Cầu Hệ Thống

- Go 1.21+
- MySQL 8.0+
- Redis (optional, cho caching)
- Make (optional, cho Makefile commands)

### Cài Đặt & Chạy

```bash
# 1. Clone repo
git clone https://github.com/minh352623/GO-DDD.git
cd go-ddd

# 2. Cấu hình environment
cp .env_dev .env_dev   # Sửa DB credentials phù hợp

# 3. Khởi tạo database
mysql -u root < init.sql

# 4. Cài dependencies
go mod download

# 5. Chạy development server
make start
# Hoặc: go run cmd/drunk/main.go

# 6. Swagger UI
# Mở http://localhost:8800/swagger/index.html
```

### Các Lệnh Make Hữu Ích

| Lệnh | Mô tả |
|---|---|
| `make start` | Chạy dev server |
| `make build` | Build binary |
| `make swag` | Generate Swagger docs |
| `make build-all` | Build cho Linux, Windows, macOS |
| `make gen-proto` | Generate gRPC protobuf code |

### Thêm Module Mới — Checklist

Khi cần thêm module (ví dụ: `order`), tạo các folder theo cấu trúc:

```bash
internal/order/
├── domain/
│   ├── model/entity/order.go          # Entity
│   ├── repository/order_reader.go     # Reader interface
│   ├── repository/order_writer.go     # Writer interface
│   └── errors.go                      # Sentinel errors
├── application/service/
│   ├── order.service.go               # Service interface
│   ├── order.service.impl.go          # Implementation
│   └── dto/order.dto.go               # DTOs
├── controller/
│   ├── http/order.handler.go          # HTTP handlers
│   ├── http/order.router.go           # Routes
│   └── dto/order.req.go               # Request DTOs
└── infrastructure/persistence/
    ├── repository/order.repo.go       # GORM implementation
    ├── model/order.model.go           # DB model
    └── mapper/order.mapper.go         # Entity ↔ Model

internal/initialize/order/
└── init.go                            # DI wiring
```

Sau đó đăng ký trong `internal/initialize/router.go`:
```go
orderHandler := initOrder.InitOrder(db)
orderHttp.RegisterOrderRoutes(v1, orderHandler)
```

---

## 📚 Tài Liệu Liên Quan

| Tài liệu | Mô tả |
|---|---|
| `golang_best_practices.md` | Quy tắc code Go nội bộ (§1-§13) |
| `ARCHITECTURE_VI.md` | Giải thích kiến trúc chi tiết (tiếng Việt) |

---

> **💡 Ghi nhớ**: Khi thêm tính năng mới, hãy tự hỏi: "Code này thuộc layer nào?" — nếu không chắc, đặt trong `domain/` trước rồi refactor sau. Domain layer sai thì business sai, các layer khác sai thì chỉ là implementation detail.

## Tài nguyên & Source Code

*   **Example Repository**: [https://github.com/minh352623/GO-DDD.git](https://github.com/minh352623/GO-DDD.git)
