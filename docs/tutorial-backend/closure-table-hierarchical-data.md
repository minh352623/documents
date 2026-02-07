# Tối ưu hóa Lưu trữ Dữ liệu Phân cấp trong RDBMS: Tại sao nên dùng Closure Table?

Trong kiến trúc hệ thống quy mô lớn, việc biểu diễn các cấu trúc cây (hierarchical data) trên một mô hình quan hệ (RDBMS) vốn mang bản chất "phẳng" là một thách thức lớn về mặt thiết kế. Lựa chọn sai mô hình dữ liệu không đơn thuần là vấn đề về thẩm mỹ code, mà là rủi ro về hiệu năng hệ thống.

Bài viết này sẽ phân tích các đánh đổi kỹ thuật (trade-offs) giữa các phương pháp phổ biến và đi sâu vào **Closure Table** - giải pháp hiện đại cho khả năng mở rộng.

---

## 1. Tổng quan về thách thức của dữ liệu phân cấp

Các hệ quản trị SQL truyền thống không có khái niệm nội tại về "độ sâu" (depth) hay "nhánh" (branch). Khi dữ liệu tăng trưởng, các truy vấn đệ quy không được tối ưu có thể dẫn đến tình trạng chiếm dụng CPU cực cao và độ trễ phản hồi (latency) tăng theo cấp số nhân.

### Ma trận So sánh các phương pháp

| Tiêu chí | Adjacency List | Nested Sets | Closure Tables |
| :--- | :--- | :--- | :--- |
| **Truy vấn con trực tiếp** | O(1) | O(n) | O(1) (với depth=1) |
| **Truy vấn toàn bộ cây con** | O(log n) (Recursive CTE) | O(1) (Range query) | O(1) (Indexed lookup) |
| **Thêm nút mới (Insert)** | O(1) | O(n) (Nặng - Cần Table Lock) | O(log n) |
| **Xóa nút (Delete)** | O(1) | O(n) | O(log n) |
| **Tốc độ Đọc** | Chậm (đệ quy) | Rất nhanh | Rất nhanh |
| **Độ phức tạp mã nguồn** | Thấp | Rất cao | Trung bình |

---

## 2. Tại sao cần Closure Table?

Thông thường, chúng ta hay bắt đầu với **Adjacency List** (Danh sách kề) – nơi mỗi dòng chỉ lưu ID của cha nó (`parent_id`). Phương pháp này rất tốt cho các cấu trúc đơn giản, ít cấp. Tuy nhiên, khi cây dữ liệu trở nên sâu (ví dụ: danh mục sản phẩm Amazon), Adjacency List trở thành trở ngại vì chi phí truy vấn đệ quy (Recursive CTE) cực kỳ tốn kém.

**Closure Table** giải quyết điều này bằng cách ghi nhớ *tất cả* các con đường nối giữa mọi cặp nút trong hệ thống, giúp biến mọi mối quan hệ đệ quy thành các phép JOIN đơn giản và tức thì.

---

## 3. Nguyên lý hoạt động: "Phẳng hóa" Cây Dữ liệu

Closure Table không chỉ nhớ "ai là cha của tôi", mà nó ghi nhớ mọi lộ trình: từ ông cố đến cháu nội, từ cha đến con, và cả mối quan hệ tự thân.

**Ví dụ:**
```text
1 (Điện tử)
├── 2 (Máy tính)
│   └── 4 (Laptop)
└── 5 (Máy tính bảng)
```

Thay vì chỉ lưu `4 -> 2`, Closure Table sẽ lưu trữ 3 thành phần cốt lõi:
*   **Ancestor (Tổ tiên):** ID của nút ở cấp cao hơn.
*   **Descendant (Hậu duệ):** ID của nút ở cấp thấp hơn.
*   **Depth (Khoảng cách):** Số bước di chuyển giữa hai nút (ví dụ: Điện tử đến Laptop là 2).

---

## 4. Thiết lập Cấu trúc Bảng (Schema Design)

Chúng ta tách biệt dữ liệu thực tế và cấu trúc quan hệ thành hai bảng để tối ưu hóa.

### Bước 1: Tạo bảng dữ liệu chính (nodes)
```sql
CREATE TABLE nodes (
    id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);
```

### Bước 2: Tạo bảng quan hệ (closure_table)
```sql
CREATE TABLE closure_table (
    ancestor INT NOT NULL,
    descendant INT NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY (ancestor, descendant),
    FOREIGN KEY (ancestor) REFERENCES nodes(id),
    FOREIGN KEY (descendant) REFERENCES nodes(id)
);
```

---

## 5. Thao tác Dữ liệu Thực tế

### Tìm tất cả con cháu của một nút (id = 1)
```sql
SELECT n.id, n.name, ct.depth
FROM nodes n 
JOIN closure_table ct ON n.id = ct.descendant 
WHERE ct.ancestor = 1 AND ct.depth > 0;
```

### Tìm đường dẫn ngược về gốc (Breadcrumbs)
```sql
SELECT n.id, n.name 
FROM nodes n 
JOIN closure_table ct ON n.id = ct.ancestor 
WHERE ct.descendant = 4 AND ct.depth > 0
ORDER BY ct.depth DESC;
```

### Thêm một nút mới (id = 5 là con của id = 1)
Sử dụng một câu lệnh `UNION ALL` hiệu quả để sao chép quan hệ từ cha:
```sql
-- 1. Thêm vào bảng nodes
INSERT INTO nodes (id, name) VALUES (5, 'Máy tính bảng');

-- 2. Cập nhật quan hệ trong closure_table
INSERT INTO closure_table (ancestor, descendant, depth)
SELECT ancestor, 5, depth + 1
FROM closure_table
WHERE descendant = 1 
UNION ALL
SELECT 5, 5, 0;      -- Thêm quan hệ tự thân
```

---

## 6. Đánh giá và Khuyến nghị

> [!IMPORTANT]
> Closure Table đánh đổi không gian lưu trữ lấy tốc độ. Việc tốn thêm dung lượng để đổi lấy tốc độ phản hồi O(1) là một sự đầu tư xứng đáng cho hệ thống lớn.

### Lời khuyên (The Hybrid Approach)
Trong các hệ thống Enterprise, bạn không nhất thiết phải chọn một. Kiến trúc sư giỏi thường:
1.  Sử dụng **Adjacency List** làm "Source of Truth" để đảm bảo tốc độ ghi và tính toàn vẹn.
2.  Duy trì một **Closure Table** như một "Materialized View" để phục vụ các truy vấn đọc/lọc phức tạp.

### Câu hỏi tự kiểm tra (Qualification Questionnaire)
1.  Hệ quản trị có hỗ trợ Recursive CTE không? Nếu không, hãy chọn Closure Tables.
2.  Tần suất ghi so với đọc? Nếu ghi liên tục và cây nông, Adjacency List có thể tốt hơn.
3.  Cần lọc theo "tất cả cấp con" thường xuyên không? Nếu có, Closure Tables là tối ưu nhất.

---

**Key Takeaways:**
*   **Adjacency List:** Tối ưu cho tốc độ ghi, phù hợp cho bình luận hoặc cây nông.
*   **Nested Sets:** Nhanh khi đọc nhưng rủi ro Table Locking rất cao khi ghi.
*   **Closure Tables:** Cân bằng nhất, lọc phân cực nhanh, phù hợp cho quy mô lớn.
