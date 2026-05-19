# Semaphore, Panic & Defer trong Golang — Hiểu đúng, dùng đúng

> **Tác giả:** Trần Công Minh  
> **Chủ đề:** Golang · Concurrency · Error Handling · Runtime  
> **Cấp độ:** Intermediate → Advanced  
> **Thời gian đọc:** ~20 phút

---

## Mục lục

1. [Semaphore](#phần-1-semaphore)
   - Semaphore là gì?
   - Tác dụng
   - Khi nào sử dụng?
   - Các cách implement
   - Best practice
2. [Panic](#phần-2-panic)
   - Panic là gì?
   - Khi nào xảy ra?
   - Chủ động tạo panic
   - Tác dụng của panic
   - Best practice
3. [Defer](#phần-3-defer)
   - Defer là gì?
   - Khi nào chạy?
   - Trường hợp defer KHÔNG chạy
   - Nhiều defer trong một function — thứ tự nào?
   - Server crash — defer có chạy hết không?
   - Best practice

---

# Phần 1: Semaphore

## Semaphore là gì?

**Semaphore** (đèn hiệu) là một cơ chế đồng bộ hoá dùng để **kiểm soát số lượng goroutine được phép thực thi đồng thời** một tác vụ cụ thể.

Hãy hình dung như bãi đỗ xe có giới hạn chỗ:

```
Bãi xe có 3 chỗ (semaphore = 3)

Xe 1 vào → còn 2 chỗ
Xe 2 vào → còn 1 chỗ
Xe 3 vào → còn 0 chỗ
Xe 4 đến → PHẢI ĐỢI cho đến khi có xe ra
```

Trong lập trình, "xe" là goroutine, "chỗ đỗ" là slot trong semaphore.

Go **không có built-in semaphore**, nhưng có thể implement dễ dàng bằng **buffered channel** hoặc dùng package `golang.org/x/sync/semaphore`.

---

## Tác dụng của Semaphore

| Tác dụng | Mô tả |
|---|---|
| **Giới hạn concurrency** | Không để quá nhiều goroutine chạy cùng lúc |
| **Bảo vệ tài nguyên có hạn** | DB connection pool, file handles, API rate limit |
| **Tránh OOM** | Kiểm soát memory usage khi xử lý batch lớn |
| **Backpressure** | Làm chậm producer khi consumer không kịp xử lý |
| **Rate limiting** | Giới hạn số request đến external service |

---

## Khi nào sử dụng Semaphore?

**✅ Nên dùng khi:**

- Gọi external API có rate limit (ví dụ: max 10 request/giây)
- Xử lý file upload — giới hạn số file xử lý đồng thời để tránh OOM
- Query database — giới hạn concurrent queries để tránh quá tải DB
- Crawl web — giới hạn số domain được crawl song song
- Resize ảnh — mỗi job tốn nhiều CPU, không nên chạy song song vô hạn
- Worker pool — giới hạn số worker xử lý job từ queue

**❌ Không cần dùng khi:**

- Chỉ cần mutual exclusion đơn giản → dùng `sync.Mutex`
- Số goroutine đã được kiểm soát qua worker pool
- Tác vụ quá nhẹ, overhead của semaphore không đáng

---

## Các cách implement Semaphore trong Go

### Cách 1 — Buffered Channel (phổ biến nhất)

```go
// Tạo semaphore với capacity = 3
sem := make(chan struct{}, 3)

var wg sync.WaitGroup

for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()

        sem <- struct{}{} // Acquire — lấy 1 slot (block nếu đầy)
        defer func() { <-sem }() // Release — trả lại slot khi xong

        fmt.Printf("Worker %d đang chạy\n", id)
        time.Sleep(time.Second)
    }(i)
}

wg.Wait()
// Dù có 10 goroutine nhưng chỉ có 3 goroutine chạy cùng lúc
```

**Giải thích cơ chế:**

```
sem = make(chan struct{}, 3)

sem <- struct{}{}  →  ghi vào channel
                      nếu channel đầy (3/3) → BLOCK
                      nếu còn chỗ         → tiếp tục

<-sem              →  đọc ra khỏi channel
                      giải phóng 1 slot → goroutine đang chờ được tiếp tục
```

### Cách 2 — golang.org/x/sync/semaphore (weighted semaphore)

Phù hợp khi các task có "trọng số" khác nhau (ví dụ: task nhỏ chiếm 1 slot, task lớn chiếm 3 slot):

```go
import "golang.org/x/sync/semaphore"

// Tổng tài nguyên = 10 đơn vị
sem := semaphore.NewWeighted(10)
ctx := context.Background()

// Task nhỏ — chiếm 1 đơn vị
go func() {
    if err := sem.Acquire(ctx, 1); err != nil {
        return
    }
    defer sem.Release(1)
    doSmallTask()
}()

// Task lớn (xử lý file 4K) — chiếm 4 đơn vị
go func() {
    if err := sem.Acquire(ctx, 4); err != nil {
        return
    }
    defer sem.Release(4)
    doHeavyTask()
}()
```

### Cách 3 — Semaphore với Context và Timeout

```go
func processWithSemaphore(ctx context.Context, items []Item) error {
    sem := make(chan struct{}, 5) // tối đa 5 concurrent
    var wg sync.WaitGroup
    var mu sync.Mutex
    var firstErr error

    for _, item := range items {
        wg.Add(1)
        go func(i Item) {
            defer wg.Done()

            // Acquire với context — thoát nếu timeout/cancel
            select {
            case sem <- struct{}{}:
                defer func() { <-sem }()
            case <-ctx.Done():
                mu.Lock()
                if firstErr == nil {
                    firstErr = ctx.Err()
                }
                mu.Unlock()
                return
            }

            if err := process(i); err != nil {
                mu.Lock()
                if firstErr == nil {
                    firstErr = err
                }
                mu.Unlock()
            }
        }(item)
    }

    wg.Wait()
    return firstErr
}
```

---

## Best Practice — Semaphore

**1. Luôn release trong defer để tránh deadlock:**

```go
// ❌ Nguy hiểm — nếu function panic, slot không được release
sem <- struct{}{}
doWork() // panic ở đây → slot bị giữ mãi → deadlock
<-sem

// ✅ Đúng — defer đảm bảo release dù có panic
sem <- struct{}{}
defer func() { <-sem }()
doWork()
```

**2. Kết hợp với Context để tránh goroutine leak:**

```go
// ✅ Có thể cancel khi timeout
select {
case sem <- struct{}{}:
    defer func() { <-sem }()
case <-ctx.Done():
    return ctx.Err()
}
```

**3. Chọn capacity semaphore phù hợp:**

```go
// Dựa trên số CPU core
maxWorkers := runtime.GOMAXPROCS(0) * 2
sem := make(chan struct{}, maxWorkers)

// Dựa trên giới hạn của external service
const maxConcurrentAPICall = 10
sem := make(chan struct{}, maxConcurrentAPICall)
```

**4. Đặt tên rõ ràng:**

```go
// ❌ Không rõ nghĩa
ch := make(chan struct{}, 5)

// ✅ Rõ ràng về mục đích
dbQuerySem   := make(chan struct{}, 10)
imageResizeSem := make(chan struct{}, 4)
apiCallSem   := make(chan struct{}, 20)
```

---

# Phần 2: Panic

## Panic là gì?

**Panic** là trạng thái lỗi nghiêm trọng khiến chương trình **dừng thực thi bình thường** và bắt đầu quá trình "unwind" — chạy ngược lên call stack, thực thi tất cả `defer` đã đăng ký, rồi cuối cùng **crash chương trình** (nếu không được recover).

```
Normal flow:        Panic flow:
main()              main()
  ↓                   ↓
handlerA()          handlerA()
  ↓                   ↓
handlerB()          handlerB()  ← PANIC xảy ra ở đây
  ↓                   ↓ (unwind ngược lên)
doWork()            defer trong handlerB() chạy
                    defer trong handlerA() chạy
                    defer trong main() chạy
                    → CRASH (in stack trace)
```

---

## Khi nào Panic xảy ra?

### Panic tự động từ Runtime (runtime panic)

Go runtime tự động tạo panic khi phát hiện lỗi nghiêm trọng:

```go
// 1. Index out of bounds
s := []int{1, 2, 3}
_ = s[10]               // panic: runtime error: index out of range [10] with length 3

// 2. Nil pointer dereference
var p *User
_ = p.Name              // panic: runtime error: invalid memory address or nil pointer dereference

// 3. Type assertion thất bại
var i interface{} = "hello"
n := i.(int)            // panic: interface conversion: interface {} is string, not int
// Dùng comma-ok để an toàn:
n, ok := i.(int)        // ok = false, không panic

// 4. Ghi vào nil map
var m map[string]int
m["key"] = 1            // panic: assignment to entry in nil map

// 5. Chia cho 0 (với integer)
a, b := 10, 0
_ = a / b               // panic: runtime error: integer divide by zero
// Lưu ý: float64 chia 0 không panic, trả về +Inf

// 6. Đóng channel đã đóng
ch := make(chan int)
close(ch)
close(ch)               // panic: close of closed channel

// 7. Ghi vào channel đã đóng
ch := make(chan int)
close(ch)
ch <- 1                 // panic: send on closed channel

// 8. Stack overflow — goroutine đệ quy vô hạn
func infinite() { infinite() }
// panic: runtime: goroutine stack exceeds 1000000000-byte limit
```

### Panic do concurrent map access

```go
// ❌ Đây là fatal error, không phải panic thông thường — KHÔNG thể recover
m := make(map[string]int)
go func() { m["a"] = 1 }()
go func() { m["b"] = 2 }()
// fatal error: concurrent map writes
```

---

## Chủ động tạo Panic

Có, bạn hoàn toàn có thể tự gọi `panic()`:

```go
// Panic với string message
panic("something went terribly wrong")

// Panic với error
panic(errors.New("database connection failed"))

// Panic với custom struct
type CriticalError struct {
    Code    int
    Message string
}
panic(CriticalError{Code: 500, Message: "config file missing"})

// Panic với bất kỳ interface{} nào
panic(42)
panic([]string{"error1", "error2"})
```

---

## Tác dụng của Panic

**1. Dừng ngay lập tức — không bỏ sót lỗi nghiêm trọng:**

```go
func mustGetConfig(key string) string {
    val := os.Getenv(key)
    if val == "" {
        // Không có config này → app không thể chạy đúng
        // Return "" sẽ gây lỗi âm thầm sau đó → khó debug hơn
        panic(fmt.Sprintf("required config %q is missing", key))
    }
    return val
}
```

**2. Phát hiện lập trình sai (programming error) ở early stage:**

```go
func NewCache(maxSize int) *Cache {
    if maxSize <= 0 {
        // Đây là lỗi của người gọi, không phải runtime error
        // Fail fast — tốt hơn là âm thầm tạo cache hỏng
        panic(fmt.Sprintf("maxSize must be positive, got %d", maxSize))
    }
    return &Cache{maxSize: maxSize}
}
```

**3. Kết hợp với recover để implement error handling nâng cao:**

```go
// Dùng trong HTTP middleware để bắt panic và trả về 500
func recoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic recovered: %v\n%s", err, debug.Stack())
                http.Error(w, "Internal Server Error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

**4. Báo hiệu trạng thái không thể tiếp tục:**

```go
func init() {
    if err := loadCriticalConfig(); err != nil {
        // App khởi động không được → panic ngay trong init()
        panic(fmt.Sprintf("failed to load config: %v", err))
    }
}
```

---

## Recover — Bắt Panic

`recover()` chỉ hoạt động **bên trong defer function**:

```go
func safeDiv(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered from panic: %v", r)
        }
    }()

    return a / b, nil // panic nếu b == 0
}

func main() {
    result, err := safeDiv(10, 0)
    if err != nil {
        fmt.Println("Error:", err) // Error: recovered from panic: runtime error: integer divide by zero
        return
    }
    fmt.Println(result)
}
```

**Recover chỉ bắt panic trong cùng goroutine:**

```go
// ❌ Recover KHÔNG bắt được panic từ goroutine khác
func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r) // KHÔNG chạy được
        }
    }()

    go func() {
        panic("goroutine panic") // Crash toàn bộ program
    }()

    time.Sleep(time.Second)
}

// ✅ Mỗi goroutine phải tự recover
func safeGo(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v\n%s", r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

---

## Best Practice — Panic

**1. Phân biệt rõ: Panic vs Error**

```
Dùng error (return err):               Dùng panic:
- Lỗi có thể xảy ra bình thường        - Lỗi lập trình (bug)
- File không tìm thấy                  - Nil pointer không được kiểm tra
- Network timeout                      - Index out of bounds
- Validation thất bại                  - Config bắt buộc bị thiếu khi start
- User input sai                       - Invariant bị vi phạm
```

**2. Không dùng panic để thay thế error handling thông thường:**

```go
// ❌ Sai — dùng panic cho lỗi bình thường
func readFile(path string) []byte {
    data, err := os.ReadFile(path)
    if err != nil {
        panic(err) // File không tìm thấy không nên panic
    }
    return data
}

// ✅ Đúng — return error cho caller xử lý
func readFile(path string) ([]byte, error) {
    return os.ReadFile(path)
}
```

**3. Luôn recover trong goroutine của mình nếu chạy long-running:**

```go
func startWorker(jobs <-chan Job) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("worker panic: %v\n%s", r, debug.Stack())
                // Restart worker nếu cần
                startWorker(jobs)
            }
        }()

        for job := range jobs {
            processJob(job)
        }
    }()
}
```

**4. Log đầy đủ stack trace khi recover:**

```go
defer func() {
    if r := recover(); r != nil {
        // ✅ Log cả stack trace để debug được
        log.Printf("panic: %v\nstack:\n%s", r, debug.Stack())
    }
}()
```

**5. Không recover panic nếu không biết xử lý:**

```go
// ❌ Nuốt panic mà không làm gì → bug âm thầm, rất khó debug
defer func() {
    recover() // Tệ nhất có thể làm
}()

// ✅ Chỉ recover khi thực sự biết cần làm gì tiếp theo
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v", r)
        http.Error(w, "Internal Server Error", 500) // Có hành động cụ thể
    }
}()
```

---

# Phần 3: Defer

## Defer là gì?

`defer` là từ khoá đăng ký một function call để **chạy vào lúc function chứa nó kết thúc** — dù kết thúc bình thường, return, hay do panic. Đây là cơ chế Go dùng để đảm bảo cleanup luôn được thực hiện.

```go
func readFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // ← đăng ký: "khi hàm này kết thúc, hãy close file"

    // Làm gì với file...
    data, err := io.ReadAll(f)
    if err != nil {
        return err // defer vẫn chạy ở đây
    }

    process(data)
    return nil // defer vẫn chạy ở đây
}
// f.Close() luôn được gọi dù return ở dòng nào
```

---

## Khi nào Defer chạy?

Defer chạy **ngay trước khi function return**, trong các trường hợp:

```go
func example() {
    defer fmt.Println("defer chạy")

    // Trường hợp 1: Return bình thường
    return
    // → defer chạy

    // Trường hợp 2: Hết function
}
// → defer chạy

func panicExample() {
    defer fmt.Println("defer vẫn chạy dù panic")
    panic("something wrong")
    // → defer chạy TRƯỚC KHI stack unwind
}
```

**Quan trọng: Tham số được evaluate ngay lúc defer được khai báo:**

```go
func main() {
    x := 10
    defer fmt.Println("x =", x) // x được capture = 10 NGAY LÚC NÀY

    x = 20
    fmt.Println("x hiện tại:", x) // In 20
}
// Output:
// x hiện tại: 20
// x = 10          ← x vẫn là 10, không phải 20
```

**Nhưng closure thì capture theo reference:**

```go
func main() {
    x := 10
    defer func() {
        fmt.Println("x =", x) // Closure capture biến x theo reference
    }()

    x = 20
}
// Output:
// x = 20   ← vì closure đọc x lúc chạy, không phải lúc khai báo
```

---

## Các trường hợp Defer KHÔNG chạy

### Trường hợp 1 — `os.Exit()`

```go
func main() {
    defer fmt.Println("defer này sẽ KHÔNG chạy")

    fmt.Println("exiting...")
    os.Exit(1) // Thoát ngay lập tức — KHÔNG chạy defer
}
```

> `os.Exit()` bypass toàn bộ Go runtime cleanup, kể cả defer. Đây là lý do không nên dùng `os.Exit()` trong production code trừ khi thực sự cần thiết.

### Trường hợp 2 — `syscall.Exit()` hoặc signal kill -9

```go
// SIGKILL (kill -9) — không cho phép cleanup
// Defer không chạy vì process bị kill bởi OS
```

### Trường hợp 3 — `log.Fatal()`, `log.Fatalf()`, `log.Fatalln()`

```go
func main() {
    defer fmt.Println("defer này sẽ KHÔNG chạy")
    log.Fatal("fatal error") // log.Fatal gọi os.Exit(1) bên trong
}
```

> `log.Fatal` = `log.Print` + `os.Exit(1)`. Luôn nhớ điều này!

### Trường hợp 4 — Goroutine bị killed bởi runtime (OOM, stack overflow)

```go
func infinite(s []int) []int {
    // defer không kịp chạy khi stack overflow
    defer fmt.Println("không bao giờ in")
    return infinite(append(s, 1))
}
```

### Trường hợp 5 — Defer chưa được đăng ký khi panic xảy ra

```go
func main() {
    panic("crash ngay đây")
    defer fmt.Println("KHÔNG chạy") // Dòng này chưa bao giờ được thực thi
}
```

Defer phải được **đăng ký (executed)** thì mới được chạy khi cleanup. Nếu panic xảy ra trước khi dòng `defer` được thực thi, defer đó không tồn tại.

```go
// ✅ Luôn đặt defer ngay sau khi acquire resource
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close() // ← đặt ngay đây, trước bất kỳ logic nào
```

---

## Nhiều Defer trong một function — Thứ tự LIFO

Khi có nhiều `defer`, chúng chạy theo thứ tự **LIFO (Last In, First Out)** — cái nào đăng ký sau chạy trước:

```go
func main() {
    defer fmt.Println("defer 1 — đăng ký đầu tiên, chạy cuối cùng")
    defer fmt.Println("defer 2")
    defer fmt.Println("defer 3")
    defer fmt.Println("defer 4 — đăng ký cuối cùng, chạy đầu tiên")

    fmt.Println("main logic")
}

// Output:
// main logic
// defer 4 — đăng ký cuối cùng, chạy đầu tiên
// defer 3
// defer 2
// defer 1 — đăng ký đầu tiên, chạy cuối cùng
```

**Tại sao LIFO?** Vì defer stack hoạt động giống như call stack — bạn mở resource theo thứ tự A → B → C, thì bạn phải đóng theo thứ tự C → B → A để tránh dependency issue:

```go
func connectAndQuery() error {
    db, err := connectDB()
    if err != nil { return err }
    defer db.Close()           // đóng sau cùng

    tx, err := db.Begin()
    if err != nil { return err }
    defer tx.Rollback()        // rollback trước khi đóng DB

    stmt, err := tx.Prepare(query)
    if err != nil { return err }
    defer stmt.Close()         // đóng statement trước khi rollback

    // ... logic
    return tx.Commit()
}
// Thứ tự cleanup: stmt.Close() → tx.Rollback() → db.Close()
// Đúng thứ tự dependency!
```

---

## Khi server crash — defer có chạy hết không?

Câu trả lời phụ thuộc vào **nguyên nhân crash**:

### Trường hợp 1 — Panic (runtime panic hoặc panic() thủ công)

```
✅ TẤT CẢ defer đã đăng ký đều chạy
```

```go
func handler() {
    defer cleanup1() // ← chạy
    defer cleanup2() // ← chạy
    defer cleanup3() // ← chạy

    panic("database down") // → unwind stack → tất cả defer chạy theo LIFO
}
```

Go runtime sẽ unwind toàn bộ call stack, chạy hết defer đã đăng ký trên mỗi stack frame trước khi crash.

### Trường hợp 2 — os.Exit() hoặc log.Fatal()

```
❌ KHÔNG CÓ defer nào chạy
```

```go
func main() {
    defer saveState()    // ❌ không chạy
    defer closeDB()      // ❌ không chạy
    defer flushLogs()    // ❌ không chạy

    if criticalError() {
        log.Fatal("critical!") // os.Exit(1) → bypass tất cả
    }
}
```

### Trường hợp 3 — SIGTERM (kill, systemd stop, Kubernetes pod termination)

```
✅ Defer chạy nếu bạn handle signal đúng cách
```

```go
func main() {
    defer db.Close()        // ← sẽ chạy nếu handle signal
    defer server.Shutdown() // ← sẽ chạy

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

    <-quit // Chờ signal

    // Khi nhận signal → function return → defer chạy
    fmt.Println("shutting down gracefully...")
}
```

### Trường hợp 4 — SIGKILL (kill -9)

```
❌ KHÔNG CÓ defer nào chạy — OS kill ngay lập tức
```

Không có cách nào handle SIGKILL trong code.

### Trường hợp 5 — OOM (Out of Memory) hoặc Stack Overflow

```
❌ KHÔNG ĐẢM BẢO — runtime có thể không kịp chạy defer
```

Khi Go runtime phát hiện OOM killer hoặc stack overflow, nó in stack trace và exit ngay — không đảm bảo chạy defer.

### Tổng kết

| Nguyên nhân crash | Defer có chạy không? |
|---|---|
| `panic()` / runtime panic | ✅ Tất cả defer đã đăng ký đều chạy |
| `os.Exit()` / `log.Fatal()` | ❌ Không có defer nào chạy |
| SIGTERM (có handle) | ✅ Chạy nếu signal được handle đúng |
| SIGTERM (không handle) | ❌ Không chạy |
| SIGKILL (`kill -9`) | ❌ Không chạy |
| OOM / Stack Overflow | ❌ Không đảm bảo |

---

## Tác dụng của Defer

**1. Cleanup resource — đảm bảo không bị leak:**

```go
// File
f, _ := os.Open("data.txt")
defer f.Close()

// HTTP response body
resp, _ := http.Get(url)
defer resp.Body.Close()

// Database transaction
tx, _ := db.Begin()
defer func() {
    if p := recover(); p != nil {
        tx.Rollback()
        panic(p) // re-panic sau khi rollback
    } else if err != nil {
        tx.Rollback()
    } else {
        err = tx.Commit()
    }
}()

// Mutex unlock
mu.Lock()
defer mu.Unlock()
```

**2. Ghi log thời gian thực thi:**

```go
func measureTime(name string) func() {
    start := time.Now()
    return func() {
        fmt.Printf("%s took %v\n", name, time.Since(start))
    }
}

func processLargeFile() {
    defer measureTime("processLargeFile")()
    // ↑ Dấu () thứ hai để gọi ngay hàm trả về
    // ...
}
```

**3. Modify return value (named return):**

```go
// Đây là tính năng đặc biệt ít người biết
func divide(a, b float64) (result float64, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r) // Ghi vào named return 'err'
            result = 0
        }
    }()

    result = a / b
    return // Trả về named returns
}
```

**4. Tracing và monitoring:**

```go
func (s *Service) CreateOrder(ctx context.Context, req *OrderRequest) (*Order, error) {
    span, ctx := tracer.StartSpan(ctx, "CreateOrder")
    defer span.Finish() // Luôn kết thúc span dù có lỗi hay không

    order, err := s.repo.Create(ctx, req)
    if err != nil {
        span.SetTag("error", true)
        return nil, err
    }

    return order, nil
}
```

---

## Best Practice — Defer

**1. Đặt defer ngay sau khi acquire resource:**

```go
// ✅ Đặt defer ngay sau open/lock/begin
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close() // ← ngay đây, không để xa

// ❌ Để defer xa → dễ quên, dễ gây resource leak
f, err := os.Open(path)
if err != nil { return err }
// ... 50 dòng code ...
defer f.Close() // Khó nhận ra đây đang cleanup gì
```

**2. Cẩn thận với defer trong vòng lặp — tránh resource accumulation:**

```go
// ❌ Defer trong loop — file chỉ đóng khi TOÀN BỘ function kết thúc
for _, path := range files {
    f, _ := os.Open(path)
    defer f.Close() // Tất cả files mở đến khi function return → OOM với files lớn
    process(f)
}

// ✅ Wrap trong anonymous function
for _, path := range files {
    func() {
        f, _ := os.Open(path)
        defer f.Close() // Đóng ngay sau khi anonymous function return
        process(f)
    }()
}

// ✅ Hoặc tách thành hàm riêng
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()
    return process(f)
}

for _, path := range files {
    if err := processFile(path); err != nil {
        log.Printf("error processing %s: %v", path, err)
    }
}
```

**3. Không dùng defer cho hot path có yêu cầu performance cao:**

```go
// Defer có overhead nhỏ (~10-30ns). Thường không đáng kể,
// nhưng với hàm gọi hàng triệu lần/giây thì cần cân nhắc

// Benchmark trước khi quyết định optimize
func BenchmarkWithDefer(b *testing.B) {
    var mu sync.Mutex
    for i := 0; i < b.N; i++ {
        mu.Lock()
        defer mu.Unlock() // overhead
    }
}

func BenchmarkWithoutDefer(b *testing.B) {
    var mu sync.Mutex
    for i := 0; i < b.N; i++ {
        mu.Lock()
        mu.Unlock() // không defer
    }
}
```

**4. Dùng defer để đảm bảo graceful shutdown:**

```go
func main() {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        log.Fatal(err) // Chú ý: log.Fatal ở đây là trước khi có defer
    }
    defer db.Close() // ← defer sau khi open thành công

    server := &http.Server{Addr: ":8080"}
    defer server.Shutdown(context.Background())

    // Chạy server
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        log.Printf("server error: %v", err)
    }
}
```

---

## Kết hợp cả 3: Semaphore + Panic + Defer trong thực tế

Dưới đây là ví dụ thực tế kết hợp cả 3 khái niệm trong một HTTP handler xử lý batch:

```go
// Worker pool an toàn với semaphore + defer + panic recovery
func (s *Service) ProcessBatch(ctx context.Context, items []Item) error {
    const maxConcurrent = 5
    sem := make(chan struct{}, maxConcurrent)

    var wg sync.WaitGroup
    var mu sync.Mutex
    var errs []error

    for _, item := range items {
        wg.Add(1)
        go func(i Item) {
            // Defer 1: WaitGroup done — luôn chạy
            defer wg.Done()

            // Defer 2: Recover panic — tránh crash toàn service
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("panic processing item %d: %v\n%s",
                        i.ID, r, debug.Stack())
                    mu.Lock()
                    errs = append(errs, fmt.Errorf("panic on item %d: %v", i.ID, r))
                    mu.Unlock()
                }
            }()

            // Semaphore: giới hạn 5 goroutine cùng lúc
            select {
            case sem <- struct{}{}:
                defer func() { <-sem }() // Defer 3: luôn release slot
            case <-ctx.Done():
                mu.Lock()
                errs = append(errs, ctx.Err())
                mu.Unlock()
                return
            }

            // Logic xử lý thực sự
            if err := s.processItem(ctx, i); err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("item %d: %w", i.ID, err))
                mu.Unlock()
            }
        }(item)
    }

    wg.Wait()

    if len(errs) > 0 {
        return fmt.Errorf("batch processing failed: %v", errs)
    }
    return nil
}
```

---

## Tóm tắt nhanh

| | Semaphore | Panic | Defer |
|---|---|---|---|
| **Là gì** | Giới hạn concurrency | Lỗi nghiêm trọng dừng execution | Đăng ký cleanup function |
| **Khi nào dùng** | Kiểm soát tài nguyên có hạn | Lỗi không thể phục hồi, lỗi lập trình | Mọi trường hợp cần cleanup |
| **Không chạy khi** | N/A | N/A | `os.Exit`, `log.Fatal`, SIGKILL |
| **Pattern chính** | Buffered channel | `panic()` + `recover()` trong defer | Ngay sau acquire resource |
| **Nguy hiểm khi** | Không release → deadlock | Không recover trong goroutine → crash | Defer trong loop → resource leak |

---

## Tài liệu tham khảo

- [Go Blog: Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover)
- [Go Spec: Defer statements](https://go.dev/ref/spec#Defer_statements)
- [golang.org/x/sync/semaphore](https://pkg.go.dev/golang.org/x/sync/semaphore)
- [Effective Go: Panic](https://go.dev/doc/effective_go#panic)
- [Go runtime/debug package](https://pkg.go.dev/runtime/debug)

---

*Happy coding! Nếu có câu hỏi hoặc muốn bổ sung case study, hãy tạo PR hoặc comment vào bài. 🚀*
