# HƯỚNG DẪN SỬ DỤNG GOROUTINE HIỆU QUẢ & TỐI ƯU

Trong lập trình Go concurrent, việc quản lý goroutine sao cho hiệu quả, tránh rò rỉ tài nguyên (leak) và xử lý lỗi chuẩn xác là rất quan trọng. Bài viết này sẽ hướng dẫn bạn cách sử dụng `errgroup` để xử lý cancellation, timeout và giới hạn số lượng goroutine một cách tối ưu.

## 1. Xử lý Cancellation và Timeout trong errgroup

`errgroup` không tự động ngắt mã nguồn của bạn. Nó cung cấp tín hiệu hủy (Cancellation Signal) thông qua context. Để xử lý Timeout hay Cancel hiệu quả, bạn cần tuân thủ 2 bước:

**Bước 1: Khởi tạo với Timeout**
Bạn bọc context cha bằng một timeout trước khi đưa vào errgroup.

**Bước 2: Lắng nghe tín hiệu trong Task**
Các hàm bên trong `g.Go` phải lắng nghe `ctx.Done()` hoặc truyền `ctx` vào các hàm I/O (như SQL, NoSQL, HTTP Request).

### Mẫu code chuẩn

```go
func complexTask(ctx context.Context) error {
	// 1. Thiết lập Timeout cho toàn bộ nhóm task là 2 giây
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	// 2. errgroup.WithContext sẽ trả về một gCtx bị đóng khi:
	// - Có 1 task bị lỗi (err != nil)
	// - Hoặc ctx cha bị timeout/cancel
	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		// Giả lập một task tốn thời gian
		select {
		case <-time.After(5 * time.Second): // Task này tốn 5s
			fmt.Println("Task hoàn thành")
			return nil
		case <-gCtx.Done(): // Task này sẽ dừng sau 2s vì timeout
			fmt.Println("Task bị hủy do timeout hoặc lỗi từ task khác")
			return gCtx.Err()
		}
	})

	return g.Wait()
}
```

### Mẫu 1: Gom dữ liệu từ nhiều nguồn (Parallel Data Fetching)

Đây là trường hợp bạn cần gọi nhiều Service hoặc Database cùng lúc để trả về một kết quả tổng hợp (ví dụ: Trang chi tiết sản phẩm cần: Thông tin sản phẩm + Review + Kho hàng).

**Đặc điểm:** Chỉ cần 1 nguồn dữ liệu quan trọng bị lỗi, ta hủy luôn các query khác để trả về lỗi ngay lập tức.

```go
func (s *ProductService) GetProductDetail(ctx context.Context, id string) (*ProductDetail, error) {
	// 1. Thiết lập timeout cho toàn bộ quá trình gom dữ liệu
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	g, gCtx := errgroup.WithContext(ctx)

	var (
		product model.Product
		reviews []model.Review
		stock   int
	)

	// Task 1: Lấy thông tin sản phẩm (Bắt buộc)
	g.Go(func() error {
		return s.repo.GetProduct(gCtx, id, &product)
	})

	// Task 2: Lấy danh sách review
	g.Go(func() error {
		return s.repo.GetReviews(gCtx, id, &reviews)
	})

	// Task 3: Check tồn kho
	g.Go(func() error {
		return s.repo.GetStock(gCtx, id, &stock)
	})

	// 2. Chờ kết quả. Nếu Task 1 lỗi, Task 2 và 3 sẽ được báo tín hiệu cancel qua gCtx
	if err := g.Wait(); err != nil {
		return nil, fmt.Errorf("failed to fetch product detail: %w", err)
	}

	return &ProductDetail{
		Product: product,
		Reviews: reviews,
		Stock:   stock,
	}, nil
}
```

### Mẫu 2: Xử lý danh sách lớn với giới hạn số luồng (Batch Processing with SetLimit)

Khi bạn cần xử lý 1000 item (ví dụ: Gửi thông báo cho 1000 user), bạn không nên mở 1000 goroutine cùng lúc vì sẽ làm sập Connection Pool của Database hoặc quá tải RAM.

**Đặc điểm:** Sử dụng `SetLimit` (Go 1.20+) để kiểm soát tài nguyên hệ thống.

```go
func (s *NotifyService) SendBulkNotifications(ctx context.Context, userIDs []string) error {
	g, gCtx := errgroup.WithContext(ctx)
	
	// Giới hạn tối đa 20 worker chạy song song
	g.SetLimit(20) 

	for _, id := range userIDs {
		userID := id // Cố định biến loop để tránh bug logic
		
		g.Go(func() error {
			// g.Go sẽ chặn (block) nếu đã đạt giới hạn 20 luồng
			// cho đến khi có 1 luồng khác hoàn thành.
			return s.notifier.Send(gCtx, userID)
		})
	}

	return g.Wait()
}
```

## 2. So sánh toàn diện: sync.WaitGroup vs Channel vs errgroup

Đây là bảng so sánh để team chúng ta dùng làm tiêu chuẩn chọn lựa:

| Đặc điểm | sync.WaitGroup | Channel (kết hợp select) | errgroup |
|---|---|---|---|
| **Mục đích chính** | Đợi một nhóm tác vụ hoàn thành. | Giao tiếp và điều phối luồng dữ liệu. | Quản lý nhóm tác vụ I/O, gom lỗi và hủy task. |
| **Xử lý Error** | Không. Phải tự dùng biến ngoài + Mutex (dễ gây Race Condition). | Có. Phải tạo channel riêng để nhận lỗi (dễ gây boilerplate code). | **Có (Sẵn có)**. Trả về lỗi đầu tiên gặp phải. |
| **Xử lý Timeout/Cancel** | Không. Phải bọc thủ công rất phức tạp. | **Mạnh nhất**. Dùng select lắng nghe nhiều channel cùng lúc. | **Tốt**. Tích hợp sẵn cơ chế đóng context khi có lỗi. |
| **Giới hạn số luồng (Limit)** | Không. | Có. Dùng semaphore (buffered channel). | **Có**. Go 1.20+ hỗ trợ `g.SetLimit(n)`. |
| **Độ phức tạp code** | Thấp nhất (Simple). | Cao (Dễ bị Deadlock, Goroutine leak). | Trung bình (Clean & Safe). |
| **Trường hợp sử dụng** | Task chạy ngầm đơn giản, không quan tâm lỗi (vd: ghi log song song). | Khi cần streaming dữ liệu hoặc điều phối luồng cực kỳ phức tạp. | **Hầu hết các tác vụ Backend** (API call, Database query song song). |
