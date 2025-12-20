---
sidebar_position: 10
title: Optimize CPU
description: Optimize CPU
---
# Tối ưu hóa hiệu năng: Chiến lược sử dụng Local Cache vs Redis

## 1. Tổng quan & Bối cảnh
Trong quá trình Stress Test với **2000 CCU** trong **20 phút** với hơn **1 triệu request**, chúng tôi nhận thấy sự chênh lệch lớn về mức tiêu thụ CPU giữa hai cách triển khai cache:
*   **Cách cũ (11 CPU):** Áp dụng tư duy xử lý của Redis vào Local Cache.
*   **Cách mới (8.2 CPU):** Tận dụng đúng sức mạnh của Local Cache.

Sự khác biệt đến từ bản chất lưu trữ dữ liệu giữa hai loại cache này.

## 2. Nguyên nhân gốc rễ (Root Cause)

### Vấn đề: "Cạm bẫy" tư duy Redis
Trước đây, hệ thống sử dụng **Redis** làm bộ nhớ đệm chính. Do Redis là một server độc lập (Remote Cache), dữ liệu muốn gửi qua mạng (Network I/O) bắt buộc phải được **Tuần tự hóa (Serialize)** thành chuỗi (String/Bytes) thông qua `json.Marshal`.

**Luồng xử lý cũ với Redis (Bắt buộc):**
> `Object` -> `json.Marshal` -> `Lưu Redis` -> `Lấy từ Redis` -> `json.Unmarshal` -> `Object`

Khi chuyển sang sử dụng **Local Cache** (lưu trữ ngay trên RAM của ứng dụng), lập trình viên đã vô tình giữ lại bước `Marshal/Unmarshal` này, dẫn đến việc xử lý thừa thãi.

**Luồng xử lý sai trên Local Cache (Cách 1 - 11 CPU):**
> `Lấy Object từ Cache` -> `json.Marshal` (Thừa) -> `json.Unmarshal` (Thừa) -> `Object`

### Giải pháp: Type Assertion
Local Cache lưu trữ trực tiếp con trỏ/giá trị của biến (`interface{}`). Do đó, ta có thể lấy và sử dụng ngay lập tức thông qua cơ chế ép kiểu (Type Assertion) mà không cần chuyển đổi định dạng.

**Luồng xử lý đúng trên Local Cache (Cách 2 - 8.2 CPU):**
> `Lấy Object từ Cache` -> `Type Assertion` -> `Object`

## 3. So sánh hiệu năng & Kỹ thuật

| Đặc tính | Redis (Remote Cache) | Local Cache (In-Memory) |
| :--- | :--- | :--- |
| **Nơi lưu trữ** | Server riêng biệt | RAM của chính ứng dụng |
| **Dạng dữ liệu** | Bytes / String | Object (Struct, Map, Interface...) |
| **Cơ chế lưu** | `json.Marshal` (Tốn CPU) | Lưu tham chiếu/giá trị gốc (Tức thì) |
| **Cơ chế lấy** | `json.Unmarshal` (Tốn CPU) | `Type Assertion` (O(1) - Rất nhanh) |
| **Độ trễ** | Network Latency | Nanoseconds |

## 4. Chi tiết triển khai

### ❌ Cách tiếp cận sai (Tư duy Redis áp dụng cho Local Cache)
Đoạn code này lãng phí CPU để biến một Object (đang dùng được) thành JSON, rồi lại parse JSON đó ngược lại.

```go
// Giả lập tư duy cũ: Coi Local Cache như Redis trả về Bytes
if result, ok := redis.LocalCacheService().Get(ctx, cacheKey); ok && isCache {
    // SAI LẦM:
    // result trong Local Cache vốn đã là Object (dataList)
    // Nhưng ta lại đi Marshal nó ra bytes
    byteResult, err := json.Marshal(result) // Tốn CPU, Tốn GC
    if err != nil {
        return http.StatusInternalServerError, nil, err
    }
    
    // Rồi lại Unmarshal ngược lại
    if data, err := utils.ConvertTo[[]map[string]interface{}](byteResult); err == nil {
        return http.StatusOK, data, nil
    }
}
```

### ✅ Cách tiếp cận đúng (Native Local Cache)
Khi lưu vào Local Cache, ta đã lưu nguyên văn Object:
```go
// Lúc lưu:
redis.LocalCacheService().SetWithTTL(ctx, cacheKey, dataList, ...)
```
Nên lúc lấy ra, chỉ cần ép kiểu:
```go
// Lúc lấy:
if result, ok := redis.LocalCacheService().Get(ctx, cacheKey); ok && isCache {
    // ĐÚNG:
    // Ép kiểu trực tiếp. Không tốn CPU xử lý chuỗi.
    // Zero Allocation.
    return http.StatusOK, result.([]map[string]interface{}), nil
}
```

## 5. Các sai lầm thường gặp khi dùng Cache (Common Pitfalls)
#### 1.Over-Serialization (Tuần tự hóa thừa):
* **Lỗi:** Luôn dùng json.Marshal cho mọi loại cache bất kể là Local hay Remote.
* **Hậu quả:** Tăng độ trễ (Latency) và CPU không cần thiết.
#### 2. Lưu sai kiểu dữ liệu vào Local Cache:
* **Lỗi:** Lưu chuỗi JSON (string) vào Local Cache thay vì lưu Struct/Map.
* **Hậu quả:** Khi lấy ra vẫn phải tốn công Unmarshal. Hãy tận dụng RAM để lưu Object đã xử lý sẵn.
#### 3. Không đồng bộ kiểu dữ liệu (Type Safety):
* **Lỗi:** Lưu vào là *Struct nhưng lúc lấy ra lại assert sang Struct (hoặc ngược lại), gây panic hoặc lỗi runtime.
* **Khắc phục:** Cần quy định rõ kiểu dữ liệu đầu ra của từng Key cache.
## 6. Kết luận
* **Khi chuyển đổi từ Redis sang Local Cache, bắt buộc phải loại bỏ các bước Marshal/Unmarshal.**
* **Việc loại bỏ các bước này giúp giảm ~25% CPU (từ 11 xuống 8.2 cores) tại mức tải 2000 CCU do giảm tải áp lực cho Garbage Collector (GC).**
