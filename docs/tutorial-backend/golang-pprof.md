# Golang pprof — Hướng dẫn toàn diện để Debug Performance cho Team

> **Tác giả:** Trần Công Minh  
> **Chủ đề:** Golang · Performance · Profiling · Debugging  
> **Cấp độ:** Intermediate → Advanced  
> **Thời gian đọc:** ~15 phút

---

## Mục lục

1. [pprof là gì và tại sao cần dùng?](#1-pprof-là-gì-và-tại-sao-cần-dùng)
2. [Các loại Profile](#2-các-loại-profile)
3. [Setup pprof trong project](#3-setup-pprof-trong-project)
4. [CPU Profiling — Tìm điểm ngốn CPU](#4-cpu-profiling--tìm-điểm-ngốn-cpu)
5. [Memory Profiling — Debug memory leak](#5-memory-profiling--debug-memory-leak)
6. [Goroutine Profiling — Phát hiện goroutine leak](#6-goroutine-profiling--phát-hiện-goroutine-leak)
7. [Block & Mutex Profiling — Tìm điểm tắc nghẽn concurrency](#7-block--mutex-profiling--tìm-điểm-tắc-nghẽn-concurrency)
8. [Flame Graph — Visualize dễ nhìn hơn](#8-flame-graph--visualize-dễ-nhìn-hơn)
9. [Dùng pprof trong môi trường Production](#9-dùng-pprof-trong-môi-trường-production)
10. [Quick Reference — Cheatsheet](#10-quick-reference--cheatsheet)

---

## 1. pprof là gì và tại sao cần dùng?

Bạn đã bao giờ gặp tình huống như này chưa?

- Service đang chạy bình thường, bỗng nhiên **RAM tăng không ngừng** đến vài GB
- API response time đột ngột **chậm gấp 3 lần** trong giờ cao điểm
- Số lượng goroutine **tăng dần theo giờ** và không giảm

Log không giúp được gì. Metric chỉ nói *có chuyện gì đó sai*, không nói *tại sao*. Đây là lúc bạn cần **pprof**.

**pprof** là công cụ profiling được tích hợp sẵn trong Go runtime. Nó thu thập và trực quan hoá dữ liệu về hiệu năng của ứng dụng đang chạy, giúp bạn trả lời chính xác các câu hỏi:

- Function nào đang **ngốn nhiều CPU nhất**?
- Bộ nhớ bị **phân bổ ở đâu** và có bị leak không?
- Goroutine nào đang **bị block** và tại sao?
- Lock nào đang **gây ra contention**?

> 💡 **Nguyên tắc vàng:** *"Đừng bao giờ optimize mà không profile trước."* — Intuition về performance thường sai. pprof cho bạn dữ liệu thực tế.

---

## 2. Các loại Profile

Go cung cấp 6 loại profile chính:

| Profile | Endpoint | Dùng để |
|---|---|---|
| **CPU** | `/debug/pprof/profile` | Tìm function ngốn CPU |
| **Heap** | `/debug/pprof/heap` | Debug memory leak, tìm điểm allocate nhiều |
| **Goroutine** | `/debug/pprof/goroutine` | Phát hiện goroutine leak |
| **Block** | `/debug/pprof/block` | Goroutine đang block ở đâu |
| **Mutex** | `/debug/pprof/mutex` | Lock contention |
| **Allocs** | `/debug/pprof/allocs` | Toàn bộ lịch sử memory allocation |

---

## 3. Setup pprof trong project

### 3.1 Cách 1 — HTTP Server (phổ biến nhất, dùng cho web service)

Chỉ cần một dòng import:

```go
package main

import (
    "net/http"
    _ "net/http/pprof" // ← import blank identifier, tự đăng ký handler
    "log"
)

func main() {
    // Chạy pprof server riêng biệt trên port 6060
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    // ... phần còn lại của ứng dụng
}
```

> ⚠️ **Lưu ý bảo mật:** Chỉ bind vào `localhost`, không expose ra public internet. Endpoint này tiết lộ thông tin nội bộ của ứng dụng.

Sau khi chạy, truy cập `http://localhost:6060/debug/pprof/` để xem dashboard.

### 3.2 Cách 2 — Custom Mux (dùng khi project có custom router)

```go
package main

import (
    "net/http"
    "net/http/pprof"
    "log"
)

func main() {
    mux := http.NewServeMux()

    // Đăng ký pprof endpoints thủ công
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

    // Endpoint của ứng dụng
    mux.HandleFunc("/api/v1/users", handleUsers)

    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

### 3.3 Cách 3 — Standalone program (CLI tool, batch job)

Dùng `runtime/pprof` để ghi profile ra file:

```go
package main

import (
    "os"
    "runtime/pprof"
    "log"
)

func main() {
    // Bắt đầu CPU profile
    cpuFile, err := os.Create("cpu.prof")
    if err != nil {
        log.Fatal(err)
    }
    defer cpuFile.Close()

    pprof.StartCPUProfile(cpuFile)
    defer pprof.StopCPUProfile()

    // Chạy logic của chương trình
    doHeavyWork()

    // Ghi Memory profile
    memFile, err := os.Create("mem.prof")
    if err != nil {
        log.Fatal(err)
    }
    defer memFile.Close()

    pprof.WriteHeapProfile(memFile)
}
```

---

## 4. CPU Profiling — Tìm điểm ngốn CPU

CPU profiling hoạt động bằng cách **tạm dừng chương trình ~100 lần/giây** để ghi lại stack trace. Function xuất hiện nhiều lần = đang chạy nhiều thời gian.

### Thu thập CPU profile

```bash
# Thu thập 30 giây (default)
go tool pprof http://localhost:6060/debug/pprof/profile

# Chỉ định số giây cụ thể
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=60

# Lưu ra file để phân tích sau
curl http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.prof
go tool pprof cpu.prof
```

### Phân tích trong interactive mode

Sau khi chạy `go tool pprof`, bạn sẽ vào chế độ interactive:

```
(pprof) top10
Showing nodes accounting for 6.83s, 87.41% of 7.81s total
      flat  flat%   sum%        cum   cum%
     3.20s 40.97% 40.97%      3.20s 40.97%  main.processData
     1.50s 19.21% 60.18%      1.50s 19.21%  runtime.mallocgc
     0.80s 10.24% 70.42%      4.00s 51.22%  main.parseJSON
     ...
```

**Giải thích các cột:**

| Cột | Ý nghĩa |
|---|---|
| `flat` | Thời gian function tự thực thi (không tính function con) |
| `flat%` | % thời gian flat so với tổng |
| `sum%` | Tổng cộng dồn |
| `cum` | Thời gian bao gồm cả function con |
| `cum%` | % thời gian cum |

```bash
# Xem source code của function nghi ngờ
(pprof) list main.processData

# Xem call graph dạng web
(pprof) web

# Xem dạng text chi tiết hơn
(pprof) top10 -cum
```

### Ví dụ thực tế — Phát hiện và fix CPU hotspot

```go
// ❌ Code có vấn đề — string concatenation trong loop
func buildReport(items []Item) string {
    result := ""
    for _, item := range items {
        result += fmt.Sprintf("ID: %d, Name: %s\n", item.ID, item.Name)
        // Mỗi lần += tạo một string mới → O(n²) allocations
    }
    return result
}
```

pprof sẽ chỉ cho bạn thấy `runtime.mallocgc` chiếm phần lớn CPU → dấu hiệu của excessive allocation.

```go
// ✅ Fix — dùng strings.Builder
func buildReport(items []Item) string {
    var sb strings.Builder
    sb.Grow(len(items) * 50) // Pre-allocate ước tính
    for _, item := range items {
        fmt.Fprintf(&sb, "ID: %d, Name: %s\n", item.ID, item.Name)
    }
    return sb.String()
}
```

---

## 5. Memory Profiling — Debug memory leak

### Thu thập heap profile

```bash
# Snapshot heap tại thời điểm hiện tại
go tool pprof http://localhost:6060/debug/pprof/heap

# Lưu ra file
curl http://localhost:6060/debug/pprof/heap > heap.prof
go tool pprof heap.prof
```

### Hai metric quan trọng trong heap profile

```bash
# inuse_space — bộ nhớ ĐANG được dùng (quan trọng nhất để tìm leak)
go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap

# alloc_space — TỔNG bộ nhớ đã allocate từ trước đến nay (tìm allocation hotspot)
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
```

> 🔑 **Quy tắc phân biệt:**
> - `inuse_space` tăng liên tục theo thời gian → **Memory leak**
> - `alloc_space` cao nhưng `inuse_space` ổn định → **GC pressure** (allocate nhiều nhưng được dọn)

### So sánh hai snapshot để tìm leak

Kỹ thuật mạnh nhất để phát hiện memory leak:

```bash
# Snapshot lúc bình thường
curl localhost:6060/debug/pprof/heap > heap_normal.prof

# Đợi 10 phút (hoặc sau khi xử lý nhiều request)
curl localhost:6060/debug/pprof/heap > heap_after.prof

# So sánh — chỉ hiện những gì TĂNG thêm
go tool pprof -base heap_normal.prof heap_after.prof
(pprof) top10 -inuse_space
```

### Ví dụ thực tế — Memory leak với goroutine

```go
// ❌ Goroutine leak → memory leak
func handleRequest(w http.ResponseWriter, r *http.Request) {
    ch := make(chan Result)

    go func() {
        result := doSlowWork() // Nếu request bị cancel, goroutine này vẫn chạy mãi
        ch <- result
    }()

    select {
    case result := <-ch:
        json.NewEncoder(w).Encode(result)
    case <-time.After(5 * time.Second):
        http.Error(w, "timeout", 504)
        // goroutine doSlowWork vẫn đang chạy và giữ memory!
    }
}
```

```go
// ✅ Fix — dùng context để cancel
func handleRequest(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel() // Đảm bảo goroutine được cancel

    ch := make(chan Result, 1) // buffered channel để goroutine không bị block

    go func() {
        result := doSlowWorkWithContext(ctx)
        select {
        case ch <- result:
        case <-ctx.Done(): // Thoát nếu đã timeout
        }
    }()

    select {
    case result := <-ch:
        json.NewEncoder(w).Encode(result)
    case <-ctx.Done():
        http.Error(w, "timeout", 504)
    }
}
```

---

## 6. Goroutine Profiling — Phát hiện goroutine leak

Goroutine leak xảy ra khi goroutine được tạo ra nhưng không bao giờ kết thúc. Mỗi goroutine chiếm ~2KB–8KB RAM → hàng nghìn goroutine leaked = hàng GB RAM mất.

### Thu thập goroutine profile

```bash
# Xem tất cả goroutine hiện tại
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Xem dạng text đầy đủ stack trace
curl http://localhost:6060/debug/pprof/goroutine?debug=2

# Theo dõi số lượng goroutine theo thời gian
watch -n5 'curl -s localhost:6060/debug/pprof/goroutine | head -5'
```

### Dấu hiệu nhận biết goroutine leak

```bash
# Nếu số này tăng đều theo thời gian → có leak
(pprof) top
Showing nodes accounting for 1523, 100% of 1523 total
      flat  flat%   sum%        cum   cum%
      1200 78.79% 78.79%       1200 78.79%  main.handleRequest.func1
       323 21.21%  100%        323 21.21%  net/http.(*connReader).Read
```

1200 goroutine đang stuck tại `handleRequest.func1` là dấu hiệu rõ ràng của leak.

### Ví dụ thực tế — Goroutine leak phổ biến

```go
// ❌ Goroutine leak — channel không có buffer, không ai đọc
func processItems(items []Item) {
    ch := make(chan Result) // unbuffered channel

    for _, item := range items {
        go func(i Item) {
            result := process(i)
            ch <- result // Block mãi nếu không ai đọc!
        }(item)
    }

    // Nếu function return sớm (panic, timeout...) → goroutines block mãi
    firstResult := <-ch
    useResult(firstResult)
    // Các goroutine còn lại bị leak!
}
```

```go
// ✅ Fix — WaitGroup + buffered channel + context
func processItems(ctx context.Context, items []Item) []Result {
    ch := make(chan Result, len(items)) // buffered = không block
    var wg sync.WaitGroup

    for _, item := range items {
        wg.Add(1)
        go func(i Item) {
            defer wg.Done()
            select {
            case <-ctx.Done():
                return // Thoát nếu context bị cancel
            default:
                ch <- process(i)
            }
        }(item)
    }

    // Đóng channel sau khi tất cả goroutine xong
    go func() {
        wg.Wait()
        close(ch)
    }()

    var results []Result
    for result := range ch {
        results = append(results, result)
    }
    return results
}
```

---

## 7. Block & Mutex Profiling — Tìm điểm tắc nghẽn concurrency

### Bật Block và Mutex profiling

Hai loại này phải được bật thủ công vì có overhead:

```go
import "runtime"

func main() {
    // Block profiling — theo dõi goroutine bị block trên channel/sync
    runtime.SetBlockProfileRate(1) // 1 = ghi lại mọi sự kiện block

    // Mutex profiling — theo dõi lock contention
    runtime.SetMutexProfileFraction(1) // 1 = ghi lại mọi mutex event

    // ... rest of app
}
```

> ⚠️ Chỉ bật trong môi trường debug/staging. Trong production dùng giá trị cao hơn (ví dụ: `100`) để giảm overhead.

### Thu thập và phân tích

```bash
# Block profile
go tool pprof http://localhost:6060/debug/pprof/block

# Mutex profile
go tool pprof http://localhost:6060/debug/pprof/mutex

# Trong interactive mode
(pprof) top10
(pprof) list main.handleDB
```

### Ví dụ thực tế — Mutex contention

```go
// ❌ Global mutex gây contention
var (
    mu    sync.Mutex
    cache = make(map[string]Data)
)

func getFromCache(key string) (Data, bool) {
    mu.Lock()         // Toàn bộ app phải chờ lock này
    defer mu.Unlock()
    data, ok := cache[key]
    return data, ok
}

func setCache(key string, data Data) {
    mu.Lock()
    defer mu.Unlock()
    cache[key] = data
}
```

```go
// ✅ Fix — dùng sync.RWMutex để read concurrently
var (
    mu    sync.RWMutex
    cache = make(map[string]Data)
)

func getFromCache(key string) (Data, bool) {
    mu.RLock()         // Nhiều goroutine có thể read đồng thời
    defer mu.RUnlock()
    data, ok := cache[key]
    return data, ok
}

func setCache(key string, data Data) {
    mu.Lock()          // Chỉ write mới exclusive lock
    defer mu.Unlock()
    cache[key] = data
}

// ✅ Fix tốt hơn nữa — dùng sync.Map cho concurrent map
var cache sync.Map

func getFromCache(key string) (Data, bool) {
    val, ok := cache.Load(key)
    if !ok {
        return Data{}, false
    }
    return val.(Data), true
}
```

---

## 8. Flame Graph — Visualize dễ nhìn hơn

Flame graph là cách trực quan nhất để đọc profile. Trục ngang = thời gian (rộng hơn = chậm hơn), trục dọc = call stack.

### Mở flame graph trực tiếp trên browser

```bash
# Tự động mở browser với flame graph (Go 1.11+)
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/profile?seconds=30
```

Truy cập `http://localhost:8081` → chọn **View → Flame Graph**.

### Cách đọc flame graph

```
┌──────────────────────────────────────────────┐  ← main()
│         ┌──────────────────┐   ┌────────┐    │
│         │  handleRequest() │   │ init() │    │  ← caller
│         ├──────────────────┤   └────────┘    │
│         │  ┌─────┐ ┌─────┐│                  │
│         │  │  DB │ │JSON ││                  │  ← callee
│         │  │query│ │parse││                  │
│         │  └─────┘ └─────┘│                  │
└──────────────────────────────────────────────┘

Thanh càng RỘNG = function đó chiếm càng nhiều thời gian
Thanh ở ĐÁY CÙNG = root (thường là main hoặc goroutine entry)
Thanh ở ĐỈNH = leaf function — đây là điểm hot cần optimize
```

### Cài đặt Graphviz để xem call graph (tùy chọn)

```bash
# Ubuntu/Debian
sudo apt install graphviz

# macOS
brew install graphviz

# Sau đó trong pprof
(pprof) web        # Mở call graph trên browser
(pprof) pdf        # Xuất ra file PDF
```

---

## 9. Dùng pprof trong môi trường Production

### Bảo mật endpoint pprof

```go
package main

import (
    "net"
    "net/http"
    _ "net/http/pprof"
    "strings"
    "log"
)

// Middleware chỉ cho phép từ internal network
func internalOnly(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ip, _, err := net.SplitHostPort(r.RemoteAddr)
        if err != nil || !isInternalIP(ip) {
            http.Error(w, "Forbidden", http.StatusForbidden)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func isInternalIP(ip string) bool {
    internalRanges := []string{"127.", "10.", "192.168.", "172.16."}
    for _, prefix := range internalRanges {
        if strings.HasPrefix(ip, prefix) {
            return true
        }
    }
    return false
}

func main() {
    // Server nội bộ cho pprof — chỉ bind localhost
    go func() {
        mux := http.NewServeMux()
        mux.Handle("/debug/pprof/", internalOnly(http.DefaultServeMux))
        log.Fatal(http.ListenAndServe("127.0.0.1:6060", mux))
    }()

    // Server public của app
    http.ListenAndServe(":8080", appHandler())
}
```

### Remote profiling qua kubectl port-forward (Kubernetes)

```bash
# Port-forward đến pod
kubectl port-forward pod/my-service-abc123 6060:6060 -n production

# Profile từ máy local → kết nối đến pod production
go tool pprof -http=:8081 http://localhost:6060/debug/pprof/heap

# Thu thập CPU 30 giây từ pod đang chạy
curl http://localhost:6060/debug/pprof/profile?seconds=30 > prod_cpu.prof
```

### Workflow chuẩn khi debug production issue

```bash
# Bước 1: Xác nhận triệu chứng
curl localhost:6060/debug/pprof/goroutine | head -5  # Đếm goroutine
curl localhost:6060/debug/pprof/heap | head -5        # Kiểm tra heap

# Bước 2: Thu thập snapshot
curl localhost:6060/debug/pprof/heap > heap_t1.prof
# Đợi 5-10 phút...
curl localhost:6060/debug/pprof/heap > heap_t2.prof

# Bước 3: So sánh
go tool pprof -base heap_t1.prof heap_t2.prof

# Bước 4: Drill down vào function nghi ngờ
(pprof) top10 -inuse_space
(pprof) list mypackage.SuspiciousFunction
(pprof) web  # Xem call graph
```

---

## 10. Quick Reference — Cheatsheet

### Các lệnh curl thu thập profile

```bash
# CPU — thu thập 30 giây
curl http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.prof

# Heap — snapshot bộ nhớ hiện tại
curl http://localhost:6060/debug/pprof/heap > heap.prof

# Goroutine — tất cả goroutine đang chạy
curl http://localhost:6060/debug/pprof/goroutine > goroutine.prof

# Block — goroutine đang bị block
curl http://localhost:6060/debug/pprof/block > block.prof

# Mutex — lock contention
curl http://localhost:6060/debug/pprof/mutex > mutex.prof

# Allocs — tất cả lịch sử allocations
curl http://localhost:6060/debug/pprof/allocs > allocs.prof
```

### Các lệnh phân tích profile

```bash
# Mở interactive mode
go tool pprof <file.prof>

# Mở trực tiếp bằng web UI (tiện nhất)
go tool pprof -http=:8081 <file.prof>

# So sánh 2 profile (tìm sự khác biệt)
go tool pprof -base before.prof after.prof
```

### Các lệnh trong interactive mode

```bash
(pprof) top10                  # Top 10 function tốn tài nguyên nhất
(pprof) top10 -cum             # Sắp xếp theo cumulative time
(pprof) top10 -inuse_space     # Sắp xếp theo bộ nhớ đang dùng
(pprof) top10 -alloc_space     # Sắp xếp theo tổng bộ nhớ đã allocate
(pprof) list <function_name>   # Xem source code với annotation
(pprof) web                    # Mở call graph trên browser
(pprof) pdf                    # Xuất call graph ra PDF
(pprof) help                   # Xem tất cả lệnh
```

### Bảng chẩn đoán nhanh

| Triệu chứng | Profile cần dùng | Metric cần xem |
|---|---|---|
| CPU cao bất thường | `profile` | `flat%` cao ở function nào |
| RAM tăng liên tục | `heap` | `inuse_space` tăng theo thời gian |
| RAM cao nhưng ổn định | `heap` | `alloc_space` — GC pressure |
| Goroutine tăng mãi | `goroutine` | Stack trace của goroutine bị leak |
| Latency cao dù CPU thấp | `block` | Goroutine đang block ở đâu |
| Throughput thấp dù logic đơn giản | `mutex` | Lock contention |

---

## Kết luận

pprof là một trong những công cụ mạnh nhất trong hệ sinh thái Go — và may mắn là nó được tích hợp sẵn, không cần cài thêm gì. Workflow cơ bản luôn là:

```
Quan sát triệu chứng
        ↓
Chọn đúng loại profile
        ↓
Thu thập dữ liệu (snapshot hoặc real-time)
        ↓
Phân tích với go tool pprof
        ↓
Tìm root cause → Fix → Đo lại để verify
```

Hãy đưa pprof vào thói quen làm việc của team: **profile định kỳ trước khi release**, đặc biệt sau khi có thay đổi lớn về logic hoặc data volume. Một vấn đề được phát hiện trong staging luôn rẻ hơn nhiều so với khi nó xảy ra trong production.

---

## Tài liệu tham khảo

- [Official Go Blog: Profiling Go Programs](https://go.dev/blog/pprof)
- [Go Diagnostics Documentation](https://go.dev/doc/diagnostics)
- [runtime/pprof package](https://pkg.go.dev/runtime/pprof)
- [net/http/pprof package](https://pkg.go.dev/net/http/pprof)
- [google/pprof on GitHub](https://github.com/google/pprof)

---

*Nếu bài viết này hữu ích, hãy share cho teammate của bạn! Có câu hỏi gì thêm hãy để lại comment. 🚀*
