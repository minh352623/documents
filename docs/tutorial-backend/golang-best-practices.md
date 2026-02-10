---
sidebar_position: 2
title: Golang Technical Best Practices
---
# Golang Technical Best Practices & Guidelines

Tài liệu này quy định các tiêu chuẩn kỹ thuật bắt buộc (Mandatory) cho toàn bộ đội ngũ Backend Engineer. Mục tiêu là đảm bảo chất lượng code đồng nhất, hiệu năng cao, an toàn bộ nhớ và dễ dàng bảo trì theo triết lý **Clean Code**.

## 1. Cấu trúc Dự án & Đặt tên (Project Layout & Naming)

### 1.1. Quy tắc đặt tên Package
Package phải ngắn gọn, chữ thường, **một từ duy nhất**, danh từ số ít.

```go
// ❌ Incorrect
package user_repository // Dùng underscore
package Services        // Dùng chữ hoa, số nhiều

// ✅ Correct
package user
package auth
package order
```

### 1.2. Receiver Name
Viết tắt 1-3 ký tự của struct, nhất quán trong toàn bộ struct. Tuyệt đối không dùng `this`, `self`.

```go
type OrderService struct{}

// ❌ Incorrect
func (this *OrderService) Create() {}
func (self *OrderService) Update() {}

// ✅ Correct
func (s *OrderService) Create() {} // 's' viết tắt cho Service
func (s *OrderService) Update() {} // Nhất quán dùng 's' cho mọi method
```

### 1.3. Exported vs Unexported
Chỉ export (viết hoa chữ cái đầu) những gì **thực sự cần** được sử dụng từ bên ngoài package. Mọi thứ khác **phải unexported** (chữ thường).

```go
// ❌ Incorrect: Export quá nhiều, lộ implementation details
type UserService struct {
    DB       *gorm.DB    // ❌ Export field internal
    Cache    *redis.Client
}

func (s *UserService) ValidateEmail(email string) bool {} // ❌ Helper không cần export

// ✅ Correct: Chỉ export interface và public methods
type UserService struct {
    db    *gorm.DB       // unexported
    cache *redis.Client  // unexported
}

func (s *UserService) Create(ctx context.Context, req *CreateUserReq) (*User, error) {} // Export
func (s *UserService) validateEmail(email string) bool {}                                // unexported helper
```

### 1.4. Đặt tên biến & hàm
*   **Biến**: camelCase, ngắn gọn nhưng có nghĩa. Tránh viết tắt khó hiểu.
*   **Hàm**: Động từ + Danh từ, mô tả chính xác hành động.
*   **Boolean**: Bắt đầu bằng `is`, `has`, `can`, `should`.

```go
// ❌ Incorrect
var u = GetU(id)         // Tên biến quá ngắn, không rõ nghĩa
func Proc(d []byte) {}   // Tên hàm không rõ hành động
var flag bool            // Boolean không rõ ý nghĩa

// ✅ Correct
var user = GetUserByID(id)
func ProcessPayload(data []byte) {}
var isActive bool
var hasPermission bool
```

---

## 2. Clean Code & Architecture

### 2.1. Dependency Injection (DI)
Sử dụng **Constructor Injection** thay vì khởi tạo dependency bên trong hoặc dùng biến global.

```go
// ❌ Incorrect: Hard dependency, khó test
func NewUserService() *UserService {
    return &UserService{
        repo: &MySQLRepository{}, // Tự khởi tạo
    }
}

// ✅ Correct: Dependency Injection qua Interface
func NewUserService(repo user.Repository, cache cache.Store) *UserService {
    return &UserService{
        repo:  repo,
        cache: cache,
    }
}
```

### 2.2. Interface Design — "Accept Interfaces, Return Structs"
Hàm/method nên **nhận Interface** làm parameter (linh hoạt) và **trả về Struct cụ thể** (rõ ràng).

```go
// ❌ Incorrect: Nhận struct cụ thể → không thể mock khi test
func ProcessOrder(repo *MySQLOrderRepo) error {
    // Bị phụ thuộc cứng vào MySQL
}

// ❌ Incorrect: Trả về interface → mất type information
func NewUserService(repo UserRepository) UserService {
    return &userServiceImpl{repo: repo}
}

// ✅ Correct: Nhận interface, trả struct
type OrderProcessor interface {
    FindByID(ctx context.Context, id string) (*Order, error)
}

func ProcessOrder(repo OrderProcessor) error {
    // Có thể inject mock repo khi test
}

func NewUserService(repo UserRepository) *userServiceImpl {
    return &userServiceImpl{repo: repo}
}
```

### 2.3. Interface nên nhỏ gọn (Interface Segregation)
Interface chỉ nên chứa **1-3 methods**. Interface lớn dẫn đến mock phức tạp và coupling cao.

```go
// ❌ Incorrect: God interface, quá nhiều method
type UserRepository interface {
    Create(ctx context.Context, user *User) error
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id string) error
    FindByID(ctx context.Context, id string) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
    ListAll(ctx context.Context) ([]*User, error)
    Count(ctx context.Context) (int64, error)
    Search(ctx context.Context, query string) ([]*User, error)
}

// ✅ Correct: Chia nhỏ theo nhu cầu sử dụng
type UserReader interface {
    FindByID(ctx context.Context, id string) (*User, error)
    FindByEmail(ctx context.Context, email string) (*User, error)
}

type UserWriter interface {
    Create(ctx context.Context, user *User) error
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id string) error
}

// Service chỉ nhận interface mà nó thực sự cần
type AuthService struct {
    reader UserReader // Chỉ cần đọc, không cần write
}
```

### 2.4. Hạn chế Magic Numbers & Strings
Mọi giá trị cố định phải được khai báo thành **constants**.

```go
// ❌ Incorrect
if retryCount > 5 {
    time.Sleep(10 * time.Second)
}
if user.Status == 1 { /* ... */ }

// ✅ Correct
const (
    MaxRetries    = 5
    RetryInterval = 10 * time.Second
)

const (
    StatusActive   = 1
    StatusInactive = 2
    StatusBanned   = 3
)

if retryCount > MaxRetries {
    time.Sleep(RetryInterval)
}
if user.Status == StatusActive { /* ... */ }
```

### 2.5. Single Responsibility Principle (SRP) cho Service
Mỗi Service chỉ xử lý logic nghiệp vụ của **một domain duy nhất**.

```go
// ❌ Incorrect: OrderService xử lý cả payment, email, inventory
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) error {
    order := &Order{...}
    if err := s.repo.Create(ctx, order); err != nil {
        return err
    }
    s.chargePayment(ctx, order.Amount)     // ❌ Logic payment
    s.sendEmail(ctx, order.UserEmail)       // ❌ Logic email
    s.reduceStock(ctx, order.ProductID)     // ❌ Logic inventory
    return nil
}

// ✅ Correct: Chia nhỏ, phối hợp qua DI
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) error {
    order := &Order{...}
    if err := s.repo.Create(ctx, order); err != nil {
        return fmt.Errorf("failed to create order: %w", err)
    }
    if err := s.paymentSvc.Charge(ctx, order.Amount); err != nil {
        return fmt.Errorf("failed to charge payment: %w", err)
    }
    if err := s.inventorySvc.ReduceStock(ctx, order.ProductID); err != nil {
        return fmt.Errorf("failed to reduce stock: %w", err)
    }
    // Email gửi async (không block flow chính)
    go s.mailSvc.SendOrderConfirmation(ctx, order)
    return nil
}
```

---

## 3. Xử lý Lỗi (Error Handling)

### 3.1. Fail Fast & Guard Clauses
Tránh nesting (lồng nhau) quá sâu bằng cách return sớm.

```go
// ❌ Incorrect: Nesting sâu, khó đọc
func processUser(u *User) error {
    if u != nil {
        if u.IsActive {
            // logic...
            return nil
        } else {
            return errors.New("user inactive")
        }
    } else {
        return errors.New("user nil")
    }
}

// ✅ Correct: Flatten code, xử lý lỗi trước
func processUser(u *User) error {
    if u == nil {
        return errors.New("user nil")
    }
    if !u.IsActive {
        return errors.New("user inactive")
    }
    
    // logic main flow nằm ở indent thấp nhất
    return nil
}
```

### 3.2. Error Wrapping
Luôn wrap lỗi với `%w` để giữ lại chain và cho phép `errors.Is`/`errors.As` hoạt động.

```go
// ❌ Incorrect: Mất ngữ cảnh, mất error chain
if err != nil {
    return err
}

// ❌ Incorrect: Dùng %v → mất error chain, errors.Is sẽ không hoạt động
if err != nil {
    return fmt.Errorf("failed: %v", err)
}

// ✅ Correct: Dùng %w → giữ error chain
if err != nil {
    return fmt.Errorf("failed to fetch user by id %s: %w", userID, err)
}
```

### 3.3. Custom Error Type (Business Error)
Ngoài sentinel errors, sử dụng **custom error type** khi cần đính kèm thêm metadata (error code, details).

```go
// common/apperror/error.go
type AppError struct {
    Code    string                 // Machine-readable code (VD: USER_NOT_FOUND)
    Message string                 // Human-readable message
    Details map[string]interface{} // Chi tiết bổ sung (optional)
    Err     error                  // Original error (for wrapping)
}

func (e *AppError) Error() string { return e.Message }
func (e *AppError) Unwrap() error { return e.Err }

// Constructor helpers
func NewAppError(code, message string) *AppError {
    return &AppError{Code: code, Message: message}
}

func (e *AppError) WithDetails(details map[string]interface{}) *AppError {
    e.Details = details
    return e
}

func (e *AppError) Wrap(err error) *AppError {
    e.Err = err
    return e
}
```

```go
// domain/errors.go — Khai báo tập trung tất cả mã lỗi
var (
    ErrUserNotFound     = NewAppError("USER_NOT_FOUND", "User does not exist")
    ErrEmailExists      = NewAppError("EMAIL_ALREADY_EXISTS", "Email is already registered")
    ErrBalanceNotEnough = NewAppError("BALANCE_NOT_ENOUGH", "Insufficient balance")
    ErrInvalidInput     = NewAppError("INVALID_INPUT", "Input validation failed")
)
```

```go
// ❌ Incorrect: Service chỉ trả text, Controller không nhận biết được lỗi gì
func (s *userService) GetByID(ctx context.Context, id string) (*User, error) {
    user, err := s.repo.FindByID(ctx, id)
    if err != nil {
        return nil, errors.New("không tìm thấy user")
    }
    return user, nil
}

// ✅ Correct: Trả về AppError với mã lỗi rõ ràng
func (s *userService) GetByID(ctx context.Context, id string) (*User, error) {
    user, err := s.repo.FindByID(ctx, id)
    if err != nil {
        return nil, ErrUserNotFound.Wrap(err)
    }
    return user, nil
}

// Controller/Handler — errors.As để extract mã lỗi
func MapErrorToStatus(err error) int {
    var appErr *AppError
    if errors.As(err, &appErr) {
        switch appErr.Code {
        case "USER_NOT_FOUND":
            return http.StatusNotFound
        case "EMAIL_ALREADY_EXISTS":
            return http.StatusConflict
        case "BALANCE_NOT_ENOUGH":
            return http.StatusUnprocessableEntity
        default:
            return http.StatusInternalServerError
        }
    }
    return http.StatusInternalServerError
}
```

### 3.4. Không bỏ qua Error
Tuyệt đối **không bỏ qua** error trả về. Nếu thực sự không cần handle, phải comment lý do.

```go
// ❌ Incorrect: Bỏ qua error → bug ẩn
json.Unmarshal(data, &result)
file.Close()

// ✅ Correct
if err := json.Unmarshal(data, &result); err != nil {
    return fmt.Errorf("failed to unmarshal: %w", err)
}

// Nếu thực sự không cần handle, comment lý do
_ = file.Close() // Best-effort close, error logged elsewhere
```

---

## 4. Xử lý Đồng thời (Concurrency)

### 4.1. Context Propagation
Context phải luôn là **tham số đầu tiên** của mọi hàm I/O (database, HTTP, gRPC, file).

```go
// ❌ Incorrect
func (r *Repo) GetUser(id string) (*User, error) {
    // Không có context, không thể cancel hoặc timeout
}

// ✅ Correct
func (r *Repo) GetUser(ctx context.Context, id string) (*User, error) {
    err := r.db.QueryRowContext(ctx, "SELECT ...", id).Scan(...)
}
```

### 4.2. Goroutine Leak Prevention
Luôn đảm bảo Goroutine sẽ dừng lại bằng cách lắng nghe `ctx.Done()` hoặc đóng channel.

```go
// ❌ Incorrect: Goroutine chạy mãi mãi nếu không có tín hiệu dừng
go func() {
    for {
        process()
    }
}()

// ✅ Correct: Lắng nghe ctx.Done()
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            process()
        }
    }
}()
```

### 4.3. Goroutine Group (Errgroup)
Ưu tiên `errgroup` để quản lý nhiều goroutine song song có khả năng trả về lỗi.

```go
// ❌ Incorrect: Phức tạp, dễ sai sót khi handle lỗi và đồng bộ
var wg sync.WaitGroup
errChan := make(chan error, 2)

wg.Add(2)
go func() {
    defer wg.Done()
    if err := doTask1(); err != nil {
        errChan <- err
    }
}()
go func() {
    defer wg.Done()
    if err := doTask2(); err != nil {
        errChan <- err
    }
}()
wg.Wait()
close(errChan)

// ✅ Correct: errgroup tự động quản lý context cancel và error propagation
g, gCtx := errgroup.WithContext(ctx)

g.Go(func() error {
    return doTask1(gCtx)
})

g.Go(func() error {
    return doTask2(gCtx)
})

if err := g.Wait(); err != nil {
    return fmt.Errorf("group task failed: %w", err)
}
```

### 4.4. Panic Recovery
Mọi Goroutine chạy ngầm (background worker) **BẮT BUỘC** phải có cơ chế recover panic.

```go
// ❌ Incorrect: Nếu job panic, cả app sẽ chết
go func() {
    processJob()
}()

// ✅ Correct: Luôn recover trong background goroutine
go func() {
    defer func() {
        if r := recover(); r != nil {
            slog.Error("recovered from panic", "err", r, "stack", string(debug.Stack()))
        }
    }()
    processJob()
}()
```

### 4.5. Graceful Shutdown
Ứng dụng **BẮT BUỘC** phải handle OS signals để shutdown gracefully — đảm bảo hoàn thành requests đang xử lý, đóng database connections, flush logs.

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: router}

    // Chạy server trong goroutine
    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("listen: %s\n", err)
        }
    }()

    // Đợi signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    slog.Info("shutting down server...")

    // Cho phép 30s để hoàn thành requests đang xử lý
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        slog.Error("server forced to shutdown", "error", err)
    }

    // Cleanup: đóng DB, Redis, flush logs...
    db.Close()
    slog.Info("server exited gracefully")
}
```

### 4.6. sync.Once cho Initialization
Sử dụng `sync.Once` khi cần khởi tạo singleton (database connection, config) một cách thread-safe.

```go
// ❌ Incorrect: Race condition khi nhiều goroutine gọi đồng thời
var dbConn *gorm.DB

func GetDB() *gorm.DB {
    if dbConn == nil {
        dbConn, _ = gorm.Open(...) // ❌ Có thể khởi tạo nhiều lần
    }
    return dbConn
}

// ✅ Correct: sync.Once đảm bảo chỉ chạy 1 lần duy nhất
var (
    dbConn *gorm.DB
    dbOnce sync.Once
)

func GetDB() *gorm.DB {
    dbOnce.Do(func() {
        var err error
        dbConn, err = gorm.Open(...)
        if err != nil {
            log.Fatalf("failed to connect database: %v", err)
        }
    })
    return dbConn
}
```

---

## 5. Hiệu suất (Performance)

### 5.1. Slice Pre-allocation
Cấp phát trước bộ nhớ nếu biết kích thước (hoặc ước lượng được).

```go
// ❌ Incorrect: Gây ra nhiều lần cấp phát lại (re-allocation) khi append
var users []User
for _, row := range rows {
    users = append(users, row)
}

// ✅ Correct: Chỉ cấp phát 1 lần
users := make([]User, 0, len(rows))
for _, row := range rows {
    users = append(users, row)
}
```

### 5.2. String Concatenation
Sử dụng `strings.Builder` khi concatenate nhiều lần trong vòng lặp.

```go
// ❌ Incorrect: Tạo nhiều object string tạm, O(n²) memory
s := ""
for i := 0; i < 1000; i++ {
    s += "data"
}

// ✅ Correct: O(n) memory
var sb strings.Builder
sb.Grow(1000 * 4) // Pre-allocate nếu ước lượng được
for i := 0; i < 1000; i++ {
    sb.WriteString("data")
}
s := sb.String()
```

### 5.3. Pointer vs Value (Memory Optimization)
Chọn receiver type phù hợp để tối ưu GC và hiệu năng.

*   **Pointer Receiver (`*T`)**: Dùng khi struct lớn (> 64 bytes) HOẶC cần thay đổi state.
*   **Value Receiver (`T`)**: Dùng khi struct nhỏ, immutable, concurrency-safe.

```go
type Config struct {
    Timeout int
    Retries int
}

// ✅ Value receiver cho struct nhỏ, read-only
func (c Config) GetTimeout() int { return c.Timeout }

type LargeData struct {
    Data [1024]byte
}

// ✅ Pointer receiver tránh copy struct lớn
func (d *LargeData) Process() {}
```

### 5.4. Tránh N+1 Query
Tuyệt đối không query database bên trong vòng lặp.

```go
// ❌ Incorrect: N+1 Query → 1 + N queries
orders, _ := repo.GetAllOrders(ctx)
for _, order := range orders {
    user, _ := repo.GetUserByID(ctx, order.UserID) // ❌ Query trong loop
    order.UserName = user.Name
}

// ✅ Correct: 2 queries tổng cộng
orders, _ := repo.GetAllOrders(ctx)
userIDs := make([]string, 0, len(orders))
for _, o := range orders {
    userIDs = append(userIDs, o.UserID)
}

users, _ := repo.GetUsersByIDs(ctx, userIDs) // 1 query WHERE id IN (...)
userMap := make(map[string]*User, len(users))
for _, u := range users {
    userMap[u.ID] = u
}

for i := range orders {
    if u, ok := userMap[orders[i].UserID]; ok {
        orders[i].UserName = u.Name
    }
}
```

### 5.5. Pagination bắt buộc
Mọi API trả về danh sách **BẮT BUỘC** phải có pagination. Không bao giờ trả về toàn bộ bảng.

```go
// ❌ Incorrect: Trả toàn bộ → crash nếu bảng triệu records
func (r *Repo) GetAllUsers(ctx context.Context) ([]*User, error) {
    return r.db.Find(&users).Error
}

// ✅ Correct: Luôn có pagination
type PaginationReq struct {
    Page  int `form:"page" binding:"min=1"`
    Limit int `form:"limit" binding:"min=1,max=100"`
}

func (r *Repo) GetUsers(ctx context.Context, req PaginationReq) ([]*User, int64, error) {
    var users []*User
    var total int64

    offset := (req.Page - 1) * req.Limit
    err := r.db.WithContext(ctx).
        Model(&User{}).
        Count(&total).
        Offset(offset).
        Limit(req.Limit).
        Order("created_at DESC").
        Find(&users).Error

    return users, total, err
}
```

---

## 6. Logging (Structured Logging)

### 6.1. Sử dụng `slog` (Go 1.21+) hoặc Structured Logger
Tuyệt đối không dùng `fmt.Println` / `log.Println` trong production. Sử dụng structured logging với key-value pairs.

```go
// ❌ Incorrect: Khó parse, thiếu cấu trúc, không filter được
fmt.Printf("Error updating user %d: %v\n", userID, err)
log.Println("user created:", userID)

// ✅ Correct: Structured logging với slog
slog.Info("user created", "user_id", userID, "email", user.Email)

slog.Error("failed to update user",
    "user_id", userID,
    "error", err,
    "attempt", retryCount,
)
```

### 6.2. Log Levels chuẩn
Sử dụng đúng log level theo ngữ nghĩa:

*   `Debug`: Thông tin chi tiết cho development (SQL queries, request payload).
*   `Info`: Sự kiện nghiệp vụ quan trọng (user created, order placed).
*   `Warn`: Tình huống bất thường nhưng hệ thống vẫn hoạt động (retry, fallback).
*   `Error`: Lỗi cần xử lý nhưng hệ thống tiếp tục chạy (query failed, API call timeout).

### 6.3. Không Log Dữ liệu Nhạy cảm
Tuyệt đối không log password, token, credit card, PII.

```go
// ❌ Incorrect
slog.Info("login attempt", "email", email, "password", password)
slog.Info("payment", "card_number", cardNumber)

// ✅ Correct
slog.Info("login attempt", "email", email)
slog.Info("payment", "card_last4", cardNumber[len(cardNumber)-4:])
```

---

## 7. Testing

### 7.1. Table-Driven Tests
Mẫu chuẩn cho unit test với nhiều test case.

```go
func TestCalculateDiscount(t *testing.T) {
    tests := []struct {
        name     string
        price    float64
        discount float64
        want     float64
        wantErr  bool
    }{
        {"normal discount", 100, 10, 90, false},
        {"zero discount", 100, 0, 100, false},
        {"full discount", 100, 100, 0, false},
        {"negative price", -100, 10, 0, true},
        {"over 100% discount", 100, 150, 0, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := CalculateDiscount(tt.price, tt.discount)
            if (err != nil) != tt.wantErr {
                t.Errorf("CalculateDiscount() error = %v, wantErr %v", err, tt.wantErr)
                return
            }
            if got != tt.want {
                t.Errorf("CalculateDiscount() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

### 7.2. Mock với Interface
Sử dụng interface để mock dependency trong unit test. Khuyến khích dùng `testify/mock` hoặc `gomock`.

```go
// Mock repository cho unit test
type MockUserRepo struct{}

func (m *MockUserRepo) FindByID(ctx context.Context, id string) (*User, error) {
    if id == "not-found" {
        return nil, nil
    }
    return &User{ID: id, Name: "Test User", IsActive: true}, nil
}

func TestUserService_GetByID(t *testing.T) {
    mockRepo := &MockUserRepo{}
    service := NewUserService(mockRepo)

    t.Run("user found", func(t *testing.T) {
        user, err := service.GetByID(context.Background(), "123")
        if err != nil {
            t.Fatalf("unexpected error: %v", err)
        }
        if user.Name != "Test User" {
            t.Errorf("got name %q, want %q", user.Name, "Test User")
        }
    })

    t.Run("user not found", func(t *testing.T) {
        _, err := service.GetByID(context.Background(), "not-found")
        if err == nil {
            t.Fatal("expected error, got nil")
        }
    })
}
```

### 7.3. Test File Organization
*   File test cùng package: `user_service_test.go`
*   Tuyệt đối không test trực tiếp database/API trong unit test (dùng mock).
*   Integration test đặt trong folder `_test/` hoặc dùng build tag `//go:build integration`.

---

## 8. Configuration (12-Factor App)

### 8.1. Environment Variables với Struct Validation
Cấu hình phải được load từ **Environment Variables** và validate khi khởi động. App phải **crash ngay** nếu thiếu config bắt buộc.

```go
type Config struct {
    Port        int    `env:"PORT" env-default:"8080"`
    DatabaseURL string `env:"DATABASE_URL" env-required:"true"`
    JWTSecret   string `env:"JWT_SECRET" env-required:"true"`
    RedisURL    string `env:"REDIS_URL" env-required:"true"`
    Environment string `env:"APP_ENV" env-default:"development"`
}

func LoadConfig() (*Config, error) {
    var cfg Config
    if err := cleanenv.ReadEnv(&cfg); err != nil {
        return nil, fmt.Errorf("failed to load config: %w", err)
    }
    return &cfg, nil
}

func main() {
    cfg, err := LoadConfig()
    if err != nil {
        log.Fatalf("config error: %v", err) // Crash ngay nếu thiếu config
    }
    // ...
}
```

### 8.2. Không Hardcode Credentials
Tuyệt đối không hardcode bất kỳ secret/credential/API key nào trong code.

```go
// ❌ Incorrect
const jwtSecret = "my-super-secret-key-123"
db, _ := gorm.Open(mysql.Open("root:password123@tcp(localhost:3306)/mydb"))

// ✅ Correct
jwtSecret := cfg.JWTSecret
db, _ := gorm.Open(mysql.Open(cfg.DatabaseURL))
```

---

## 9. Data Structures & JSON Tags

### 9.1. Struct Tags Consistency
*   Mọi API struct phải có `json` tag rõ ràng (ưu tiên **snake_case**).
*   Ẩn field nhạy cảm bằng `json:"-"`.
*   Sử dụng `omitempty` khi field có thể empty/nil.

```go
type User struct {
    ID        string     `json:"id"`
    FirstName string     `json:"first_name"`
    Email     string     `json:"email"`
    AvatarURL *string    `json:"avatar_url,omitempty"` // Nullable field
    Password  string     `json:"-"`                     // Tuyệt đối ẩn
    CreatedAt time.Time  `json:"created_at"`
    UpdatedAt time.Time  `json:"updated_at"`
    DeletedAt *time.Time `json:"deleted_at,omitempty"`
}
```

### 9.2. Tách Request/Response DTO khỏi Entity
Tuyệt đối **không** dùng Entity trực tiếp làm API request/response. Luôn tạo DTO riêng.

```go
// ❌ Incorrect: Dùng entity trực tiếp → lộ internal fields, risk mass assignment
func (h *Handler) CreateUser(c *gin.Context) {
    var user models.User
    c.ShouldBindJSON(&user) // ❌ Client có thể set ID, Role, CreatedAt...
    h.repo.Create(&user)
}

// ✅ Correct: DTO riêng cho request
type CreateUserReq struct {
    Name  string `json:"name" binding:"required"`
    Email string `json:"email" binding:"required,email"`
}

type UserResponse struct {
    ID    string `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

func (h *Handler) CreateUser(c *gin.Context) {
    var req CreateUserReq
    if err := c.ShouldBindJSON(&req); err != nil {
        response.BadRequest(c, err)
        return
    }
    user, err := h.service.Create(c, req)
    if err != nil {
        response.Error(c, err)
        return
    }
    response.Created(c, UserResponse{ID: user.ID, Name: user.Name, Email: user.Email})
}
```

### 9.3. Time Format chuẩn
Sử dụng `time.Time` cho datetime. Khi serialize JSON, nếu cần custom format thì dùng custom type.

```go
// ❌ Incorrect: Lưu time dạng string
type Order struct {
    CreatedAt string `json:"created_at"` // ❌ "2024-01-15 10:30:00" — mất timezone
}

// ✅ Correct: Luôn dùng time.Time → ISO 8601 (RFC 3339) tự động
type Order struct {
    CreatedAt time.Time `json:"created_at"` // → "2024-01-15T10:30:00Z"
}
```

---

## 10. API Response Standard (RESTful & Clean Code)

### 10.1. Standard Response Format
Thống nhất cấu trúc JSON trả về cho toàn bộ API.

**Success Response:**
```go
type Response[T any] struct {
    Data    T           `json:"data,omitempty"`
    Meta    interface{} `json:"meta,omitempty"`
    Message string      `json:"message,omitempty"`
}

// Helper functions
func Success[T any](c *gin.Context, data T) {
    c.JSON(http.StatusOK, Response[T]{Data: data})
}

func Created[T any](c *gin.Context, data T) {
    c.JSON(http.StatusCreated, Response[T]{Data: data, Message: "Created successfully"})
}
```

**Error Response:**
```go
type ErrorResponse struct {
    Code    string      `json:"code"`
    Message string      `json:"message"`
    Details interface{} `json:"details,omitempty"`
}

func Error(c *gin.Context, err error) {
    var appErr *AppError
    if errors.As(err, &appErr) {
        status := MapCodeToHTTPStatus(appErr.Code)
        c.JSON(status, ErrorResponse{
            Code:    appErr.Code,
            Message: appErr.Message,
            Details: appErr.Details,
        })
        return
    }
    // Lỗi không xác định → 500, KHÔNG lộ internal error
    c.JSON(http.StatusInternalServerError, ErrorResponse{
        Code:    "INTERNAL_ERROR",
        Message: "An unexpected error occurred",
    })
}
```

### 10.2. HTTP Status Codes
Sử dụng đúng HTTP Status Code theo ngữ nghĩa RESTful. **Không** trả `200 OK` kèm error code bên trong body.

*   **2xx**: `200 OK`, `201 Created`, `204 No Content`
*   **4xx**: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`, `429 Too Many Requests`
*   **5xx**: `500 Internal Server Error`

### 10.3. Centralized Response Handling
Controller/Handler không construct JSON thủ công. Sử dụng package `response` helper.

```go
// ❌ Incorrect: Duplicate logic, magic numbers
func (h *UserHandler) GetByID(c *gin.Context) {
    user, err := h.service.GetUser(c, id)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()}) // ❌ Lộ internal error
        return
    }
    c.JSON(200, user)
}

// ✅ Correct
func (h *UserHandler) GetByID(c *gin.Context) {
    user, err := h.service.GetUser(c, id)
    if err != nil {
        response.Error(c, err)
        return
    }
    response.Success(c, user)
}
```

---

## 11. Database & Repository

### 11.1. Luôn dùng Parameterized Queries
Tuyệt đối **không** concat string vào SQL query. Luôn dùng placeholder để chống SQL Injection.

```go
// ❌ Incorrect: SQL Injection
query := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)
db.Raw(query).Scan(&users)

// ✅ Correct: Parameterized query
db.Where("name = ?", name).Find(&users)
// Hoặc
db.Raw("SELECT * FROM users WHERE name = ?", name).Scan(&users)
```

### 11.2. Transaction cho Multi-step Operations
Mọi thao tác ghi liên quan đến **nhiều bảng** phải nằm trong **Transaction**.

```go
// ❌ Incorrect: Nếu step 2 lỗi, step 1 đã commit → dữ liệu inconsistent
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) error {
    s.orderRepo.Create(ctx, order)          // Step 1: tạo order
    s.inventoryRepo.ReduceStock(ctx, ...)   // Step 2: giảm stock → LỖI!
    return nil                               // Order đã tạo nhưng stock không giảm
}

// ✅ Correct: Transaction đảm bảo tất cả hoặc không gì cả
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) error {
    return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        if err := tx.Create(order).Error; err != nil {
            return fmt.Errorf("failed to create order: %w", err)
        }
        if err := tx.Model(&Inventory{}).
            Where("product_id = ? AND stock >= ?", req.ProductID, req.Quantity).
            Update("stock", gorm.Expr("stock - ?", req.Quantity)).Error; err != nil {
            return fmt.Errorf("failed to reduce stock: %w", err)
        }
        return nil // Commit
    })
}
```

### 11.3. Luôn `defer Close()` cho Resources
Mọi resource (file, database rows, HTTP response body) **BẮT BUỘC** phải `defer Close()` ngay sau khi mở.

```go
// ❌ Incorrect: Nếu hàm return sớm vì lỗi → resource leak
func ReadFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    data, err := io.ReadAll(f)
    if err != nil {
        return nil, err // ❌ file chưa được close!
    }
    f.Close()
    return data, nil
}

// ✅ Correct: defer Close() ngay sau khi mở thành công
func ReadFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close() // ✅ Luôn close dù có lỗi hay không

    data, err := io.ReadAll(f)
    if err != nil {
        return nil, fmt.Errorf("failed to read file: %w", err)
    }
    return data, nil
}
```

---

## 12. Security

### 12.1. Timeout cho mọi External Call
Mọi HTTP/gRPC call ra bên ngoài **BẮT BUỘC** phải có timeout.

```go
// ❌ Incorrect: Không timeout → request có thể treo vĩnh viễn
resp, err := http.Get("https://external-api.com/data")

// ✅ Correct: Luôn dùng context với timeout
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://external-api.com/data", nil)
resp, err := http.DefaultClient.Do(req)
```

### 12.2. Không lộ Internal Error ra API Response
Khi xảy ra lỗi 500, **KHÔNG** trả error message chi tiết cho client. Log chi tiết ở server side.

```go
// ❌ Incorrect: Lộ stack trace, tên bảng DB, SQL query
c.JSON(500, gin.H{"error": err.Error()})
// Response: {"error": "Error 1062: Duplicate entry 'john@email.com' for key 'users.email'"}

// ✅ Correct: Trả message generic, log chi tiết ở server
slog.Error("failed to create user", "error", err, "email", req.Email)
c.JSON(500, ErrorResponse{
    Code:    "INTERNAL_ERROR",
    Message: "An unexpected error occurred",
})
```

---

## 13. Quy Chuẩn Giao Tiếp Liên Module (Inter-Module Communication)

Tài liệu này hướng dẫn cách truy xuất dữ liệu từ module khác trong kiến trúc Monolith, đảm bảo tính **Loosely Coupled** và sẵn sàng để tách thành **Microservice** bất cứ lúc nào.

### 13.1. Vấn Đề (The Problem)

Import trực tiếp Repository hoặc Service từ module khác tạo ra coupling chặt:

```go
// ❌ Phụ thuộc trực tiếp
import settingsRepo "github.com/.../internal/settings/domain/repository"

type mailService struct {
    templateRepo settingsRepo.EmailTemplateRepository // ❌ Cross-module dependency
}
```

**Hệ quả:**
1. **High Coupling:** Module Mails bị buộc chặt vào module Settings.
2. **Khó Scale:** Nếu Settings tách thành Microservice, code của Mails bị lỗi.
3. **Khó Test:** Unit test phải mock cả thành phần của Settings.

### 13.2. Giải Pháp: Interface + Adapter Pattern

Áp dụng **Dependency Inversion Principle (DIP)**: "Phụ thuộc vào trừu tượng, không phụ thuộc vào cụ thể."

#### Kiến trúc 3 lớp:
1. **Consumer (Mails Module):** Định nghĩa Interface mô tả nhu cầu.
2. **Implementation (Adapter):** Thực thi Interface bằng kỹ thuật cụ thể.
3. **Initializer:** Inject bản thực thi phù hợp vào Service.

### 13.3. Cấu Trúc Thư Mục Chuẩn

```text
internal/mails/
├── domain/
│   └── repository/
│       └── template_reader.go    # 🟢 [Interface] Mails cần đọc template
├── infrastructure/
│   └── adapter/
│       ├── local_adapter.go      # 🔵 [Impl] Lấy từ module Settings local
│       ├── http_adapter.go       # 🟠 [Impl] Lấy qua REST API (Microservice)
│       └── cached_adapter.go     # 🟡 [Optional] Thêm cache layer
```

### 13.4. Ví Dụ Thực Tế (Mails & Settings)

#### Bước 1: Định nghĩa Interface tại Domain Layer (của Mails)

```go
// internal/mails/domain/repository/template_reader.go
type TemplateInfo struct {
    ID      int64
    Subject string
    Content string
}

type TemplateReader interface {
    GetByID(ctx context.Context, id int64) (*TemplateInfo, error)
}
```

#### Bước 2: Tạo Adapter tại Infrastructure Layer

**Local Adapter (Monolith):**
```go
// internal/mails/infrastructure/adapter/local_adapter.go
type LocalTemplateAdapter struct {
    settingsRepo settingsRepo.EmailTemplateRepository
}

func (a *LocalTemplateAdapter) GetByID(ctx context.Context, id int64) (*TemplateInfo, error) {
    t, err := a.settingsRepo.GetById(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("failed to get template %d: %w", id, err)
    }
    return &TemplateInfo{ID: t.Id, Subject: t.Subject, Content: t.Content}, nil
}
```

**HTTP Adapter (Microservice):**
```go
// internal/mails/infrastructure/adapter/http_template_adapter.go
type HTTPTemplateAdapter struct {
    baseURL    string
    httpClient *http.Client
}

func (a *HTTPTemplateAdapter) GetByID(ctx context.Context, id int64) (*TemplateInfo, error) {
    url := fmt.Sprintf("%s/templates/%d", a.baseURL, id)
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    resp, err := a.httpClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("failed to call settings service: %w", err)
    }
    defer resp.Body.Close()
    
    var info TemplateInfo
    if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    return &info, nil
}
```

### 13.5. Chiến Lược Dịch Chuyển (Microservice Readiness)

Khi module Settings được tách ra:
1. Viết `HTTPTemplateAdapter` gọi API của Settings Service.
2. Cập nhật file initializer để chuyển từ `LocalTemplateAdapter` sang `HTTPTemplateAdapter`.
3. Code logic trong `mail.service.impl.go` vẫn giữ nguyên **100%**.

### 13.6. 5 Quy Tắc Vàng cho Team Leaders

> [!IMPORTANT]
> 1. **Consumer sở hữu Interface:** Interface `TemplateReader` phải nằm trong package của Mails, không phải Settings.
> 2. **Không Leak Entity:** Tránh trả về Entity của Settings qua Interface. Hãy dùng DTO đơn giản (như `TemplateInfo`).
> 3. **Adapter nằm ở Infra Layer:** Mọi logic về cách lấy dữ liệu (DB, API, gRPC) phải đóng gói trong `infrastructure/adapter/`.
> 4. **Dependency Injection:** Service chỉ nhận Interface qua Constructor.
> 5. **Mapping:** Luôn luôn có bước mapping dữ liệu từ nguồn (Settings) sang định dạng module hiện tại (Mails) cần.
---

# HƯỚNG DẪN: SỬ DỤNG GOLANG BEST PRACTICES KHI TƯƠNG TÁC VỚI AI

Chào các bạn Backend Engineers,

Để tối ưu hóa việc sử dụng AI trong lập trình và đảm bảo code sinh ra tuân thủ tuyệt đối tiêu chuẩn của dự án, mọi người vui lòng thực hiện theo quy trình hướng dẫn dưới đây.

## 1. Nguyên tắc "Context First" (Bối cảnh là trên hết)

AI rất thông minh nhưng nó không biết các quy định riêng của team chúng ta. Nếu bạn chỉ yêu cầu "Viết cho tôi hàm Update User", AI sẽ viết theo cách phổ thông.

**Quy tắc bắt buộc**: Luôn cung cấp file Best Practice của dự án vào cửa sổ chat trước khi yêu cầu viết code.

---

## 2. Cách thiết lập phiên làm việc với AI (Prompting)

### Bước 1: Thiết lập "Hợp đồng kỹ thuật"
Mỗi khi bắt đầu một Session mới (trên ChatGPT/Claude), hãy dán nội dung file Best Practice kèm câu lệnh sau:

> "Tôi gửi cho bạn tài liệu Best Practice của dự án Golang của tôi. Hãy đọc kỹ các mục từ 1 đến 9 (về Error Handling, Concurrency, Interface, slog...). Từ giờ trở đi, tất cả code bạn viết ra phải tuân thủ tuyệt đối các quy tắc này. Nếu yêu cầu của tôi vi phạm quy tắc, bạn phải nhắc nhở tôi trước khi thực hiện. Xác nhận nếu bạn đã hiểu."

### Bước 2: Yêu cầu viết code cụ thể
Khi yêu cầu AI viết code, hãy nhắc lại các từ khóa quan trọng trong Best Practice để AI tập trung.

*   ❌ **Ví dụ chưa tốt**: "Viết hàm call API lấy thông tin sản phẩm."
*   ✅ **Ví dụ chuẩn**: "Viết hàm lấy thông tin sản phẩm từ Repository. Nhớ wrap error với ngữ cảnh, sử dụng slog để log lỗi và truyền context xuống tầng Database."

---

## 3. Sử dụng AI để Review ngược lại Code của mình

Bạn có thể dùng tài liệu Best Practice để yêu cầu AI kiểm tra code bạn vừa viết:

> "Đây là đoạn code tôi vừa viết. Dựa trên tài liệu Best Practice đã gửi, hãy chỉ ra các điểm chưa đạt chuẩn (ví dụ: thiếu pre-allocation, chưa dùng errgroup, hay đặt tên package sai) và đề xuất bản sửa lỗi."

---

## 4. Mẹo sử dụng theo từng công cụ

### Đối với Cursor hoặc VS Code Copilot
*   **Sử dụng tính năng Reference (@)**: Trong Cursor, hãy gõ `@BestPractice.md` kèm câu lệnh để AI luôn đọc file này làm căn cứ.
*   **Tạo file `.cursorrules` (Nếu dùng Cursor)**: Copy toàn bộ nội dung Best Practice dán vào file này ở thư mục gốc. AI của Cursor sẽ tự động áp dụng cho mọi câu trả lời mà bạn không cần dán lại.

### Đối với ChatGPT / Claude (Web)
*   **Sử dụng tính năng Custom Instructions**: Bạn có thể copy tóm tắt các quy tắc quan trọng (như Error wrapping, Interface design) dán vào phần Custom Instructions của tài khoản. Như vậy, mọi cửa sổ chat mới đều sẽ mặc định hiểu các quy tắc này.

---

## 5. Checklist kiểm tra nhanh Output của AI

Trước khi copy code từ AI vào dự án, member phải tự kiểm tra lại 5 điểm "nóng" sau:

1.  **Error Handling**: Lỗi có được wrap bằng `%w` không? Có dùng `errors.Is` thay vì `==` không?
2.  **Concurrency**: Có sử dụng `errgroup` cho các task song song không? Context có được truyền xuyên suốt không?
3.  **Performance**: Các Slice/Map có được `make` với capacity trước không?
4.  **Interfaces**: Hàm có đang trả về struct cụ thể (concrete type) thay vì interface không?
5.  **Logging**: Có dùng `slog` với đầy đủ key-value không?

---

## 6. Tài nguyên & Source Code

*   **Example Repository**: [https://github.com/minh352623/golang-best-practies/tree/main](https://github.com/minh352623/golang-best-practies/tree/main)
