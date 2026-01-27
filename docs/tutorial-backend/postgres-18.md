---
sidebar_position: 15
title: PostgreSQL 18
description: PostgreSQL 18
---

# PostgreSQL 18 và Bước Ngoặt "RETURNING": Tạm Biệt Triggers, Đón Đầu Kỷ Nguyên Dữ Liệu Minh Bạch

Trong thế giới phát triển ứng dụng hiện đại, việc theo dõi sự thay đổi của dữ liệu không chỉ là một tính năng "thêm cho vui" mà là yêu cầu cốt lõi. Hãy tưởng tượng bạn đang điều hành một hệ thống quản lý kho hàng: khi giá của một sản phẩm thay đổi, bạn không chỉ cần lưu giá mới mà còn phải biết giá trị cũ là bao nhiêu để ghi nhật ký (audit log) hoặc kích hoạt các logic nghiệp vụ liên quan.

Trước đây, các nhà phát triển **PostgreSQL** thường rơi vào "mê cung" của sự phức tạp: hoặc phải thực hiện thêm một câu lệnh `SELECT` trước khi `UPDATE` (làm tăng độ trễ do tốn thêm round trip), hoặc phải viết các **Trigger** cồng kềnh với logic ẩn khó bảo trì. **PostgreSQL 18** đã xuất hiện như một *"kẻ thay đổi cuộc chơi"*, biến mệnh đề `RETURNING` thành một công cụ vạn năng, giúp chúng ta lập trình database sạch sẽ và hiệu quả hơn bao giờ hết.

## 1. Khả năng truy cập song song OLD và NEW: Dấu chấm hết cho các Workaround

Sự cải tiến đáng mong chờ nhất trong **PostgreSQL 18** chính là khả năng truy cập đồng thời cả trạng thái cũ (`OLD`) và trạng thái mới (`NEW`) của dữ liệu ngay trong cùng một câu lệnh DML (`INSERT`, `UPDATE`, `DELETE`).

Trong các phiên bản trước (PostgreSQL 17 trở về trước), mệnh đề `RETURNING` khá "hẹp hòi": `UPDATE` chỉ trả về giá trị sau khi sửa, còn `DELETE` chỉ trả về giá trị trước khi xóa. Để so sánh sự khác biệt, giới chuyên gia thường phải dùng các giải pháp tình thế (workarounds) thiếu ổn định như kiểm tra các cột hệ thống (ví dụ: `xmax`) hoặc chấp nhận hy sinh hiệu suất để chạy nhiều truy vấn.

Với sự đóng góp của các chuyên gia như **Dean Rasheed**, **Jian He** và **Jeff Davis**, PostgreSQL 18 cho phép bạn lấy cả hai trạng thái một cách tường minh. Thậm chí, bạn có thể đổi tên alias để tránh xung đột với tên cột hiện tại hoặc để phù hợp với quy chuẩn đặt tên của dự án.

> Chuyên gia **Ahsan Hadi** nhận định: *"Cải tiến này thay đổi căn bản cách bạn thu thập dữ liệu trong quá trình thao tác DML, giúp đơn giản hóa kiến trúc ứng dụng và cải thiện khả năng theo dõi dữ liệu."*

### Ví dụ về cú pháp nâng cao

```sql
UPDATE accounts 
SET balance = balance - 50 
WHERE account_id = 123 
RETURNING WITH (OLD AS previous, NEW AS current) 
    previous.balance AS old_val, 
    current.balance AS new_val;
```

Việc loại bỏ các truy vấn bổ sung giúp giảm số lượng giao tiếp mạng (round trips), biến các thao tác trở nên *"atomic"* (nguyên tử) và mã nguồn trở nên thanh thoát hơn.

## 2. MERGE RETURNING - "Mắt thần" xuyên thấu các tác vụ Upsert

Lệnh `MERGE` là một hành trình dài của PostgreSQL: được giới thiệu từ bản 15, thêm hỗ trợ `RETURNING` cơ bản ở bản 17, và giờ đây đạt đến độ chín muồi ở bản 18. Trước đây, `MERGE` thường bị xem là một "hộp đen" vì bạn khó có thể biết chính xác hành động nào (`INSERT`, `UPDATE` hay `DELETE`) đã được thực thi trên từng dòng dữ liệu.

**PostgreSQL 18** giải quyết triệt để vấn đề này bằng cách kết hợp `RETURNING` với hàm `merge_action()`. Hàm này sẽ trả về chính xác loại thao tác vừa thực hiện, giúp lập trình viên có cái nhìn toàn cảnh (*complete picture*) về quá trình đồng bộ dữ liệu.

### Tầm quan trọng của minh bạch hóa

Khi thực hiện **Upsert** (cập nhật nếu có, chèn nếu chưa), việc biết được một dòng dữ liệu là "mới hoàn toàn" hay "vừa được cập nhật từ giá trị X sang Y" là cực kỳ quan trọng để đảm bảo tính toàn vẹn của logic nghiệp vụ và báo cáo.

Với PostgreSQL 18, bạn không còn phải đoán mò. Sự kết hợp giữa `merge_action()` và các alias `old`/`new` cho phép bạn xác định ngay lập tức liệu một bản ghi có thực sự thay đổi giá trị hay chỉ được "cập nhật hình thức" (giá trị cũ và mới giống hệt nhau).

## 3. Xây dựng Audit Trail nguyên tử không cần Trigger

Ứng dụng thực tiễn mạnh mẽ nhất của các alias `OLD` và `NEW` chính là khả năng xây dựng hệ thống nhật ký thay đổi (**Audit Trail**) mà hoàn toàn không cần đến **Trigger**.

Việc duy trì Trigger thường dẫn đến tình trạng "logic ẩn", khiến các nhà phát triển mới rất khó debug và gây ra gánh nặng hiệu suất đáng kể. PostgreSQL 18 cho phép chúng ta thực hiện việc ghi nhật ký một cách nguyên tử (**atomic operation**) thông qua **Common Table Expressions (CTE)**.

### Quy trình thực hiện tinh gọn

1.  **Thực thi**: Sử dụng một CTE để chạy lệnh `MERGE` hoặc `UPDATE`.
2.  **So sánh**: Ngay trong mệnh đề `RETURNING`, sử dụng toán tử `IS DISTINCT FROM` để kiểm tra thay đổi thực sự.
    ```sql
    old.price IS DISTINCT FROM new.price
    ```
3.  **Đóng gói**: Dùng `jsonb_build_object` để gom các giá trị cũ và mới vào định dạng JSONB.
4.  **Ghi nhật ký**: Dùng kết quả từ CTE đó để thực hiện một lệnh `INSERT` trực tiếp vào bảng audit.

Toàn bộ quy trình này diễn ra trong một **giao dịch duy nhất**. Điều này đảm bảo rằng nếu cập nhật dữ liệu thất bại thì nhật ký cũng không được ghi, và ngược lại, loại bỏ hoàn toàn rủi ro sai lệch dữ liệu giữa bảng chính và bảng audit.

### Case Study 1: Theo dõi lịch sử giá sản phẩm (E-commerce)

Trong thương mại điện tử, việc lưu lại lịch sử thay đổi giá là bắt buộc để phân tích dữ liệu. Chúng ta chỉ muốn ghi log nếu giá thực sự thay đổi.

**Bảng dữ liệu:**

```sql
CREATE TABLE products (id int PRIMARY KEY, name text, price numeric);
CREATE TABLE price_log (product_id int, old_price numeric, new_price numeric, changed_at timestamptz);
```

**Câu lệnh PostgreSQL 18:**

```sql
WITH updated_data AS (
    UPDATE products 
    SET price = 150.00 
    WHERE id = 101
    -- Sử dụng OLD và NEW để lấy trạng thái trước và sau khi update
    RETURNING OLD.price AS price_cu, NEW.price AS price_moi, id
)
INSERT INTO price_log (product_id, old_price, new_price, changed_at)
SELECT id, price_cu, price_moi, now()
FROM updated_data
WHERE price_cu IS DISTINCT FROM price_moi; -- Chỉ ghi log nếu giá cũ khác giá mới
```

### Case Study 2: Quản lý kho hàng với lệnh MERGE (Supply Chain)

Lệnh `MERGE` cho phép vừa Update vừa Insert (Upsert). Việc ghi log cho `MERGE` trước đây cực kỳ phức tạp vì Trigger không biết dòng đó vừa được Insert hay Update.

**Bảng dữ liệu:**

```sql
CREATE TABLE inventory (sku text PRIMARY KEY, quantity int);
CREATE TABLE inventory_audit (sku text, action text, change_detail jsonb);
```

**Câu lệnh PostgreSQL 18:**

```sql
WITH merge_op AS (
    MERGE INTO inventory i
    USING (VALUES ('LAPTOP-01', 50)) AS s(sku, qty)
    ON i.sku = s.sku
    WHEN MATCHED THEN 
        UPDATE SET quantity = i.quantity + s.qty
    WHEN NOT MATCHED THEN 
        INSERT (sku, quantity) VALUES (s.sku, s.qty)
    -- Lấy hành động (INSERT/UPDATE) và giá trị cũ/mới
    RETURNING OLD.quantity AS q_old, NEW.quantity AS q_new, i.sku, MERGE_ACTION() AS act
)
INSERT INTO inventory_audit (sku, action, change_detail)
SELECT 
    sku, 
    act, 
    jsonb_build_object('from', q_old, 'to', q_new)
FROM merge_op;
```

> **Giải thích:** Nếu là `INSERT`, `q_old` sẽ là `NULL`. Nếu là `UPDATE`, bạn có cả hai giá trị để so sánh.

### Case Study 3: Giám sát thay đổi thông tin nhạy cảm (User Profile)

Khi người dùng cập nhật hồ sơ, bạn cần biết chính xác họ đã đổi "Email" hay "Số điện thoại" để phục vụ bảo mật. Việc dùng `JSONB` giúp cấu trúc log linh hoạt.

**Bảng dữ liệu:**

```sql
CREATE TABLE users (id int PRIMARY KEY, email text, phone text, status text);
CREATE TABLE security_audit (user_id int, changed_fields jsonb, executed_by text);
```

**Câu lệnh PostgreSQL 18:**

```sql
WITH updated_user AS (
    UPDATE users 
    SET phone = '0901234567', status = 'verified'
    WHERE id = 500
    RETURNING OLD, NEW -- Trả về toàn bộ bản ghi cũ và mới
)
INSERT INTO security_audit (user_id, changed_fields, executed_by)
SELECT 
    id,
    -- Đóng gói các thay đổi vào JSONB
    jsonb_build_object(
        'old_data', to_jsonb(OLD),
        'new_data', to_jsonb(NEW),
        'diff', jsonb_strip_nulls(jsonb_build_object(
            'phone', CASE WHEN OLD.phone IS DISTINCT FROM NEW.phone THEN NEW.phone ELSE NULL END,
            'status', CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status ELSE NULL END
        ))
    ),
    'Admin_System'
FROM updated_user;
```

### Tại sao các ví dụ này lại "xịn" hơn cách cũ?

1.  **Tính nguyên tử (Atomicity):** Trong cả 3 ví dụ, nếu câu lệnh `INSERT` vào bảng audit bị lỗi (ví dụ: đầy ổ cứng, sai kiểu dữ liệu), toàn bộ lệnh `UPDATE` hoặc `MERGE` phía trên sẽ bị Rollback. Bạn không bao giờ rơi vào tình trạng: *Đã đổi giá sản phẩm nhưng không tìm thấy log*.
2.  **Hiệu suất:** Bạn chỉ thực hiện 1 lần quét bảng. Với Trigger, Postgres phải khởi tạo ngữ cảnh hàm (Function context), thực hiện kiểm tra điều kiện và chạy code PL/pgSQL riêng biệt, tốn tài nguyên hơn nhiều.
3.  **Tường minh (Visibility):** Nhìn vào đoạn code SQL, bạn thấy ngay luồng dữ liệu đi từ bảng chính sang bảng log. Bạn không cần phải mở cây thư mục "Triggers" trong Database để tìm xem có logic ẩn nào đang chạy ngầm hay không.

> **Lưu ý:** PostgreSQL 18 hiện tại vẫn đang trong quá trình phát triển các tính năng hoàn thiện, bạn nên kiểm tra kỹ tài liệu chính thức (Release Notes) để cập nhật cú pháp chuẩn nhất khi phiên bản ổn định ra mắt.

## Tầm nhìn tương lai & Kết luận

**PostgreSQL 18** không chỉ đơn thuần bổ sung tính năng; nó đang tái định nghĩa cách chúng ta tương tác với dữ liệu thay đổi. Việc giảm độ trễ thông qua việc cắt giảm các truy vấn thừa và loại bỏ sự phụ thuộc vào Trigger sẽ giúp các ứng dụng trở nên nhanh hơn và dễ bảo trì hơn.

Trong tương lai, cộng đồng đang hướng tới những bước tiến xa hơn như:

*   **Hỗ trợ hàm tập hợp (Aggregate support)**: Cho phép tính toán trực tiếp trên các kết quả trả về từ `RETURNING`.
*   **Cross-table returns**: Khả năng trả về dữ liệu từ các bảng liên quan trong cùng một thao tác.

> **Câu hỏi suy ngẫm:** *Liệu dự án tiếp theo của bạn đã sẵn sàng để loại bỏ những hàm Trigger phức tạp và chuyển sang sử dụng sức mạnh nguyên tử của PostgreSQL 18 chưa? Đây chắc chắn là thời điểm vàng để nâng cấp kiến trúc database của bạn.*

## Nguồn tham khảo

*   [PostgreSQL 18 RETURNING Enhancements: A Game Changer for Modern Applications](https://www.pgedge.com/blog/postgresql-18-returning-enhancements-a-game-changer-for-modern-applications)
*   [Ví dụ minh họa (GitHub)](https://github.com/minh352623/example-posstgres-18)



