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
package Services // Dùng chữ hoa, số nhiều

// ✅ Correct
package user
package auth
package order
```

### 1.2. Receiver Name
Viết tắt 1-3 ký tự của struct, nhất quán. Tuyệt đối không dùng `this`, `self`.

```go
type OrderService struct{}

// ❌ Incorrect
func (this *OrderService) Create() {}
func (self *OrderService) Update() {}

// ✅ Correct
func (s *OrderService) Create() {} // 's' viết tắt cho Service
func (os *OrderService) Update() {} // Hoặc 'os'
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
func NewUserService(repo user.Repository) *UserService {
    return &UserService{
        repo: repo,
    }
}
```

### 2.2. Hạn chế Magic Numbers

```go
// ❌ Incorrect
if retryCount > 5 {
    time.Sleep(10 * time.Second)
}

// ✅ Correct
const (
    MaxRetries    = 5
    RetryInterval = 10 * time.Second
)

if retryCount > MaxRetries {
    time.Sleep(RetryInterval)
}
```

---

## 3. Xử lý Lỗi (Error Handling)

### 3.1. Fail Fast & Guard Clauses
Tránh nesting (lồng nhau) quá sâu bằng cách return sớm.

```go
// ❌ Incorrect: Nesting sâu, khó đọc
func procesUser(u *User) error {
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
func procesUser(u *User) error {
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
Luôn wrap lỗi để giữ lại stack trace hoặc ngữ cảnh nơi xảy ra lỗi.

```go
// ❌ Incorrect: Mất ngữ cảnh, chỉ biết query lỗi
if err != nil {
    return err
}

// ✅ Correct: Biết rõ lỗi xảy ra khi nào, ở đâu
if err != nil {
    return fmt.Errorf("failed to fetch user by id %s: %w", userID, err)
}
```

---

## 4. Xử lý Đồng thời (Concurrency)

### 4.1. Context Propagation
Context phải luôn là tham số đầu tiên của hàm I/O.

```go
// ❌ Incorrect
func (r *Repo) GetUser(id string) (*User, error) {
    // Không có context, không thể cancel hoặc timeout
}

// ✅ Correct
func (r *Repo) GetUser(ctx context.Context, id string) (*User, error) {
    // Truyền ctx xuống database driver
    err := r.db.QueryRowContext(ctx, "SELECT ...", id).Scan(...)
}
```

### 4.2. Goroutine Leak Prevention
Luôn đảm bảo Goroutine sẽ dừng lại.

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
        case <-ctx.Done(): // Thoát khi context bị cancel
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
    if err := doTask2(); err != nil { // task 2 vẫn chạy dù task 1 lỗi
        errChan <- err
    }
}()
wg.Wait()
close(errChan)
// Phải loop read errChan cực khổ...

// ✅ Correct: errgroup tự động quản lý context cancel và error propagation
g, gCtx := errgroup.WithContext(ctx)

g.Go(func() error {
    // Nếu task này lỗi, gCtx sẽ bị cancel, các task khác nhận được tín hiệu
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
Mọi Goroutine chạy ngầm (background worker) **BẮT BUỘC** phải có cơ chế recover panic để tránh làm crash cả ứng dụng.

```go
// ❌ Incorrect: Nếu job panic, cả app sẽ chết
go func() {
    processJob()
}()

// ✅ Correct: Luôn recover trong background goroutine
go func() {
    defer func() {
        if r := recover(); r != nil {
            slog.Error("recovered from panic", "err", r)
        }
    }()
    processJob()
}()
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

```go
// ❌ Incorrect: Tạo nhiều object string tạm, chậm
s := ""
for i := 0; i < 1000; i++ {
    s += "data"
}

// ✅ Correct: Nhanh và tối ưu bộ nhớ
var sb strings.Builder
sb.Grow(1000 * 4) // (Optional) Pre-allocate nếu ước lượng được
for i := 0; i < 1000; i++ {
    sb.WriteString("data")
}
s := sb.String()
```

### 5.3. Pointer vs Value (Memory Optimization)
Chọn receiver type phù hợp để tối ưu GC và hiệu năng.

*   **Pointer Receiver (`*T`)**: Dùng khi struct lớn (> 64 bytes) HOẶC cần thay đổi giá trị state bên trong.
*   **Value Receiver (`T`)**: Dùng khi struct nhỏ (tọa độ, config), immutable, concurrency-safe (do copy).

```go
type Config struct {
    Timeout int
    Retries int
}

// ❌ Incorrect: Struct nhỏ nhưng dùng pointer (gây áp lực GC)
func (c *Config) GetTimeout() int { return c.Timeout }

// ✅ Correct: Value receiver cho struct nhỏ, read-only
func (c Config) GetTimeout() int { return c.Timeout }

type LargeData struct {
    Data [1024]byte
}

// ❌ Incorrect: Copy cả mảng lớn mỗi khi gọi hàm
func (d LargeData) Process() {}

// ✅ Correct: Pointer receiver tránh việc copy
func (d *LargeData) Process() {}
```

---

## 6. Logging (Structured Logging)

### 6.1. Contextual Logging

```go
// ❌ Incorrect: Khó parse, thiếu cấu trúc
fmt.Printf("Error updating user %d: %v\n", userID, err)

// ✅ Correct: Dễ dàng filter theo key-value trên hệ thống log
slog.Error("failed to update user",
    "user_id", userID,
    "error", err,
    "attempt", retryCount,
)
```

---

## 7. Testing

### 7.1. Table-Driven Tests

```go
// ✅ Correct
func TestAdd(t *testing.T) {
    tests := []struct {
        name string
        a, b int
        want int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := Add(tt.a, tt.b); got != tt.want {
                t.Errorf("Add() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

---

## 8. Configuration (12-Factor App)

### 8.1. Environment Variables
*   Cấu hình phải được load từ **Environment Variables**.
*   Sử dụng thư viện quản lý config (như `viper`, `koanf` hoặc `cleanenv`) để map env vars vào struct strongly-typed.
*   Tuyệt đối không hardcode credentials trong code.

---

## 9. Data Structures & JSON Tags

### 9.1. Struct Tags Consistency
*   Mọi API trả về JSON phải định nghĩa `json` tag rõ ràng (ưu tiên **snake_case**).
*   Tuyệt đối ẩn các trường nhạy cảm bằng `json:"-"`.

```go
type User struct {
    // ✅ Luôn có json tag, snake_case
    ID        string `json:"id"`
    FirstName string `json:"first_name"`
    
    // ❌ Incorrect: Lộ password ra API response
    // Password string `json:"password"`
    
    // ✅ Correct: Không bao giờ serialize field này
    Password  string `json:"-"`
}
```

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
