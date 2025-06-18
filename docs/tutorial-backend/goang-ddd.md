# Go DDD Project

Dự án được xây dựng theo kiến trúc DDD (Domain-Driven Design) với Go, tập trung vào việc tổ chức code rõ ràng, dễ bảo trì và mở rộng.

## Mục lục

- [Kiến trúc DDD](#kiến-trúc-ddd)
- [Cấu trúc Dự án](#cấu-trúc-dự-án)
- [Yêu cầu Hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt](#cài-đặt)
- [Cấu hình](#cấu-hình)
- [Chạy Dự án](#chạy-dự-án)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Quy tắc Phát triển](#quy-tắc-phát-triển)

## Kiến trúc DDD

### 1. Tổng quan về DDD

DDD (Domain-Driven Design) là một phương pháp thiết kế phần mềm tập trung vào việc mô hình hóa domain (lĩnh vực nghiệp vụ) thành các đối tượng và logic có ý nghĩa. Kiến trúc DDD được chia thành 4 tầng chính:

### 2. Các tầng trong DDD

#### 2.1. Domain Layer (Tầng Domain)
- **Vị trí**: `/internal/[module]/domain`
- **Trách nhiệm**:
  - Chứa business logic cốt lõi
  - Định nghĩa các entities, value objects
  - Định nghĩa các business rules
  - Không phụ thuộc vào các tầng khác

#### 2.2. Application Layer (Tầng Ứng dụng)
- **Vị trí**: `/internal/[module]/application`
- **Trách nhiệm**:
  - Điều phối luồng xử lý
  - Chứa các use cases
  - Không chứa business logic
  - Giao tiếp giữa domain và infrastructure

#### 2.3. Infrastructure Layer (Tầng Hạ tầng)
- **Vị trí**: `/internal/[module]/infrastructure`
- **Trách nhiệm**:
  - Implement các interfaces từ domain
  - Xử lý tương tác với database
  - Xử lý cache
  - Giao tiếp với external services

#### 2.4. Interface Layer (Tầng Giao diện)
- **Vị trí**: `/internal/[module]/controller`
- **Trách nhiệm**:
  - Xử lý HTTP requests/responses
  - Chuyển đổi dữ liệu (DTOs)
  - Validation input
  - Định tuyến API

### 3. Ví dụ với Module Auth

#### 3.1. Domain Layer
```go
// /internal/auth/domain/model/entity/account.go
type Account struct {
    ID        string
    Email     string
    Password  string
    Role      string
    Status    string
    CreatedAt time.Time
}

// /internal/auth/domain/repository/auth.repository.go
type IAuthRepository interface {
    FindByEmail(email string) (*Account, error)
    Save(account *Account) error
}
```

#### 3.2. Application Layer
```go
// /internal/auth/application/service/auth.service.go
type IAuthService interface {
    Login(email, password string) (*TokenResponse, error)
    Register(account *Account) error
}
```

#### 3.3. Infrastructure Layer
```go
// /internal/auth/infrastructure/persistence/repository/auth.repository.go
type AuthRepository struct {
    db *gorm.DB
}

func (r *AuthRepository) FindByEmail(email string) (*Account, error) {
    var account Account
    err := r.db.Where("email = ?", email).First(&account).Error
    return &account, err
}
```

#### 3.4. Interface Layer
```go
// /internal/auth/controller/http/auth.handler.go
type AuthHandler struct {
    authService IAuthService
}

func (h *AuthHandler) Login(c *gin.Context) {
    var loginDTO LoginDTO
    if err := c.ShouldBindJSON(&loginDTO); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }
    
    token, err := h.authService.Login(loginDTO.Email, loginDTO.Password)
    if err != nil {
        c.JSON(401, gin.H{"error": "Invalid credentials"})
        return
    }
    
    c.JSON(200, token)
}
```

### 4. Luồng xử lý trong DDD

1. **Request đến Interface Layer**:
   - HTTP request đến endpoint
   - Handler nhận request và validate input

2. **Interface Layer → Application Layer**:
   - Handler gọi Service
   - Chuyển đổi DTO thành domain objects

3. **Application Layer → Domain Layer**:
   - Service sử dụng domain logic
   - Gọi repository để truy vấn data

4. **Domain Layer ↔ Infrastructure Layer**:
   - Repository interface được implement
   - Truy vấn database thông qua infrastructure

5. **Response đi ngược lại**:
   - Domain objects được chuyển thành DTOs
   - Response được trả về client

### 5. Lợi ích của DDD

1. **Tách biệt rõ ràng**:
   - Mỗi tầng có trách nhiệm riêng
   - Dễ dàng thay đổi implementation
   - Dễ dàng test từng tầng

2. **Bảo trì dễ dàng**:
   - Code được tổ chức theo domain
   - Dễ dàng thêm tính năng mới
   - Dễ dàng thay đổi business logic

3. **Khả năng mở rộng**:
   - Có thể thay đổi database
   - Có thể thêm các interface mới
   - Dễ dàng tích hợp với các service khác

4. **Clean Architecture**:
   - Tuân thủ nguyên tắc dependency
   - Dependencies chỉ đi từ ngoài vào trong
   - Domain layer độc lập với framework

## Cấu trúc Dự án

```
├── cmd/                    # Điểm khởi đầu ứng dụng
│   ├── drunk/             # Module chính
│   └── swag/              # API documentation
├── internal/              # Core business logic
│   ├── auth/             # Authentication module
│   ├── user/             # User management module
│   ├── common/           # Shared code
│   ├── initialize/       # Application initialization
│   └── middleware/       # HTTP middleware
├── pkg/                  # Public packages
├── utils/                # Utility functions
├── environment/          # Environment configurations
├── global/               # Global variables
├── scripts/              # Build & deployment scripts
└── tests/                # Test cases
```

### Chi tiết Module (ví dụ với auth)

```
auth/
├── application/           # Business logic
│   ├── schedule/         # Scheduled tasks
│   └── service/          # Service implementations
├── controller/           # API handlers
│   ├── dto/             # Request/Response DTOs
│   ├── http/            # HTTP handlers
│   └── rgpc/            # gRPC handlers
├── domain/              # Domain models
│   ├── model/           # Domain entities
│   └── repository/      # Repository interfaces
└── infrastructure/      # Technical implementations
    ├── cache/          # Caching
    ├── config/         # Configuration
    └── persistence/    # Database implementations
```


https://uniknow.github.io/AgileDev/site/0.1.8-SNAPSHOT/parent/ddd/core/services