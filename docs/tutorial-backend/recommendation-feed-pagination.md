---
sidebar_position: 17
title: Cơ Chế Load Data Trong Hệ Thống Recommendation Video
description: Cơ Chế Load Data Trong Hệ Thống Recommendation Video
---

# Cơ Chế Load Data Trong Hệ Thống Recommendation Video: Khi User Lướt Hết Danh Sách

> **Vấn đề thực tế**: Document mô tả luồng `User → Backend → AI Service → video IDs → FE`, nhưng **điều gì xảy ra khi user lướt hết batch 20 video đó?** Bài viết này giải thích cơ chế hoàn chỉnh mà các hệ thống như TikTok, YouTube Shorts áp dụng.

---

## Vấn Đề: Document Nói Gì, Thực Tế Thiếu Gì?

Luồng cơ bản trong document:

```
User → Backend → AI Service → [video_id_1...video_id_20] → FE hiển thị
```

Luồng này mô tả đúng **lần gọi đầu tiên**, nhưng bỏ qua hoàn toàn câu hỏi quan trọng hơn:

- User lướt hết 20 video → gọi API lại? AI có trả video trùng không?
- Làm sao đảm bảo **không có màn hình loading** giữa chừng khi user đang xem?
- AI có phải xử lý real-time mỗi lần user scroll không?

---

## Kiến Trúc Hoàn Chỉnh: Pre-fetch Pool + Sliding Window

Thực tế, hệ thống recommendation không hoạt động theo kiểu **"gọi AI → lấy → hiển thị → hết thì gọi lại"**. Thay vào đó, AI **generate sẵn một pool lớn** và backend serve dần từ pool đó.

### Sơ Đồ Tổng Quan

```
┌─────────────────────────────────────────────────────┐
│                      REDIS                          │
│  feed_pool:{user_id} = [id1, id2, ..., id200]       │
│  TTL: 1 giờ                                         │
└───────────────────┬─────────────────────────────────┘
                    │ Pop 20 IDs
                    ▼
┌─────────────────────────────────────────────────────┐
│                    BACKEND                          │
│  1. Pop 20 IDs từ pool                              │
│  2. Nếu pool < 30 items → trigger AI regenerate     │
│  3. Fetch metadata từ PostgreSQL                    │
│  4. Trả response cho FE                             │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│                  FRONTEND                           │
│  - Hiển thị video hiện tại                         │
│  - Khi còn 3-5 video → gọi API lấy batch tiếp     │
│  - Append vào queue (user không thấy loading)       │
└─────────────────────────────────────────────────────┘
```

---

## Ba Chiến Lược Xử Lý Pagination

### 1. Pre-generate Pool Lớn (Khuyến Nghị cho TikTok-style)

AI generate sẵn 200 video IDs và lưu vào Redis. Backend chỉ việc pop ra từng batch.

**Ưu điểm:**
- Không gọi AI theo real-time → latency thấp
- User không bao giờ thấy loading
- AI có thể chạy ở background, tối ưu hơn

**Nhược điểm:**
- Pool có thể "stale" nếu user preferences thay đổi nhanh
- Cần quản lý memory Redis cẩn thận

**Implementation:**

```python
# Khi user mở app lần đầu hoặc pool hết
async def initialize_feed_pool(user_id: str):
    # Lấy thông tin user để filter theo language/country
    user_profile = await get_user_profile(user_id)  # language, region từ PostgreSQL
    
    # Gọi AI generate 200 video IDs một lần
    # AI Service sẽ query video_metadata (ClickHouse) để filter/boost
    # videos phù hợp với language & country của user
    video_ids = await ai_service.recommend(
        user_id=user_id,
        n=200,
        exclude_ids=[],
        preferred_language=user_profile.get("language", "vi"),
        preferred_country=user_profile.get("region", "VN")
    )
    
    # Lưu vào Redis dạng List
    redis_key = f"feed_pool:{user_id}"
    await redis.delete(redis_key)
    await redis.rpush(redis_key, *video_ids)
    await redis.expire(redis_key, 3600)  # TTL 1 giờ

# Mỗi khi FE gọi /feed
async def get_feed_batch(user_id: str, limit: int = 20):
    redis_key = f"feed_pool:{user_id}"
    
    # Lấy số lượng còn lại trong pool
    pool_size = await redis.llen(redis_key)
    
    # Nếu pool < 30 → trigger refill bất đồng bộ (không block)
    if pool_size < 30:
        asyncio.create_task(refill_pool(user_id))
    
    # Nếu pool hoàn toàn rỗng → fallback
    if pool_size == 0:
        return await get_trending_fallback(limit)
    
    # Pop `limit` IDs từ đầu list
    video_ids = []
    for _ in range(min(limit, pool_size)):
        video_id = await redis.lpop(redis_key)
        if video_id:
            video_ids.append(video_id.decode())
    
    # Fetch metadata từ PostgreSQL
    videos = await fetch_video_metadata(video_ids)
    
    return {"feed": videos, "remaining_pool": pool_size - len(video_ids)}
```

---

### 2. Cursor-based Pagination (Cân Bằng Giữa Đơn Giản và Hiệu Quả)

Backend lưu **session state** trong Redis: tracking những video đã serve cho user trong session hiện tại.

**Cách hoạt động:**

```
Request 1: cursor=null    → serve [video_1 ... video_20],  trả về cursor="session_abc_20"
Request 2: cursor="session_abc_20" → serve [video_21...video_40], trả về cursor="session_abc_40"
Request 3: cursor="session_abc_40" → serve [video_41...video_60], ...
```

**Implementation:**

```python
import hashlib
import json

async def get_feed_with_cursor(user_id: str, cursor: str = None, limit: int = 20):
    session_key = f"session:{user_id}"
    
    # Lấy danh sách video đã serve trong session này
    if cursor:
        served_ids_raw = await redis.get(session_key)
        served_ids = json.loads(served_ids_raw) if served_ids_raw else []
    else:
        served_ids = []
    
    # Gọi AI, truyền served_ids để loại trừ
    new_video_ids = await ai_service.recommend(
        user_id=user_id,
        n=limit,
        exclude_ids=served_ids  # ← AI không trả lại video đã xem
    )
    
    # Cập nhật session state
    updated_served = served_ids + new_video_ids
    await redis.setex(session_key, 1800, json.dumps(updated_served))  # TTL 30 phút
    
    # Generate cursor mới
    new_cursor = hashlib.md5(f"{user_id}:{len(updated_served)}".encode()).hexdigest()
    
    videos = await fetch_video_metadata(new_video_ids)
    
    return {
        "feed": videos,
        "next_cursor": new_cursor,
        "total_served": len(updated_served)
    }
```

**API Contract với FE:**

```json
// Request
GET /api/v1/recommendations/feed?user_id=user_123&cursor=abc123&limit=20

// Response
{
  "feed": [...],
  "next_cursor": "def456",  // FE gửi cái này trong request tiếp theo
  "total_served": 40
}
```

---

### 3. FE Tự Quản Lý `seen_ids` (Đơn Giản Nhất)

FE giữ danh sách `seen_video_ids` và gửi lên mỗi lần gọi API.

**Phù hợp khi:** Hệ thống nhỏ, không cần tối ưu quá nhiều.

**Nhược điểm:** Payload tăng dần theo thời gian xem trong session. Sau 1 giờ xem, request có thể kèm theo 300-400 IDs.

```python
# FE gửi lên
POST /api/v1/recommendations/feed
{
  "user_id": "user_123",
  "limit": 20,
  "seen_video_ids": ["id1", "id2", ..., "id200"]  // tăng dần
}

# Backend đơn giản
async def get_feed(user_id: str, limit: int, seen_video_ids: list):
    recommendations = await ai_service.recommend(
        user_id=user_id,
        n=limit,
        exclude_ids=seen_video_ids
    )
    return {"feed": await fetch_video_metadata(recommendations)}
```

---

## Cơ Chế Pre-fetch Phía FE

Quan trọng không kém: **FE không được đợi đến khi hết video mới gọi API**. Thay vào đó, FE phải gọi trước khi user thấy màn hình loading.

```typescript
// React Native / Next.js example
const PREFETCH_THRESHOLD = 5; // Còn 5 video thì gọi API

class FeedManager {
  private queue: Video[] = [];
  private isFetching = false;
  private cursor: string | null = null;

  async getNextVideo(): Promise<Video> {
    const video = this.queue.shift();
    
    // Còn ít video trong queue → fetch thêm ở background
    if (this.queue.length < PREFETCH_THRESHOLD && !this.isFetching) {
      this.prefetchNextBatch(); // không await → không block
    }
    
    return video!;
  }

  private async prefetchNextBatch() {
    this.isFetching = true;
    
    const response = await fetch(`/api/v1/recommendations/feed?cursor=${this.cursor}`);
    const data = await response.json();
    
    this.queue.push(...data.feed);
    this.cursor = data.next_cursor;
    this.isFetching = false;
  }
}
```

---

## Xử Lý Fallback Khi Pool Cạn Kiệt

Dù hiếm gặp (user xem liên tục nhiều giờ), vẫn cần có fallback:

```python
async def get_trending_fallback(
    limit: int, 
    user_language: str = "vi", 
    user_country: str = "VN"
):
    """
    Fallback khi pool AI hết: trả về trending videos.
    Sử dụng video_metadata trên ClickHouse để filter theo language/country,
    sau đó cross-check với PostgreSQL cho trending status.
    """
    # Bước 1: Lấy video IDs phù hợp language/country từ ClickHouse video_metadata
    filtered_video_ids = await ch_client.execute("""
        SELECT video_id 
        FROM video_metadata
        WHERE language = %(lang)s OR country = %(country)s
    """, {"lang": user_language, "country": user_country})
    
    filtered_ids = [row[0] for row in filtered_video_ids]
    
    if not filtered_ids:
        # Nếu không có kết quả → fallback toàn bộ trending
        filtered_ids = None
    
    # Bước 2: Lấy trending videos từ PostgreSQL, filter theo video IDs
    if filtered_ids:
        trending = await db.query("""
            SELECT video_id FROM videos
            WHERE is_trending = TRUE
            AND video_id = ANY($1)
            ORDER BY upload_time DESC
            LIMIT $2
        """, filtered_ids, limit * 3)
    else:
        trending = await db.query("""
            SELECT video_id FROM videos
            WHERE is_trending = TRUE
            ORDER BY upload_time DESC
            LIMIT $1
        """, limit * 3)
    
    # Shuffle để không boring
    import random
    random.shuffle(trending)
    
    return trending[:limit]
```

> **Ghi chú**: Bảng `video_metadata` trên ClickHouse chứa `video_id`, `language`, `country` — cho phép filter nhanh theo vùng/ngôn ngữ trước khi query PostgreSQL. Xem chi tiết schema tại [Hệ Thống Recommendation cho Video — Section 2.3](./recommendation#23-clickhouse-video-metadata).

---

## Tổng Hợp: Chọn Chiến Lược Nào?

| Tiêu chí | Pool (Redis) | Cursor-based | FE seen_ids |
|---|---|---|---|
| **Latency** | ⚡ Thấp nhất | 🔶 Trung bình | 🔶 Trung bình |
| **Độ tươi mới** | 🔶 Có thể stale | ✅ Tốt | ✅ Tốt |
| **Complexity** | 🔶 Trung bình | 🔶 Trung bình | ✅ Đơn giản |
| **Scale** | ✅ Tốt | ✅ Tốt | ❌ Payload lớn |
| **Phù hợp** | TikTok-style | Feed thông thường | MVP / nhỏ |

**Khuyến nghị cho hệ thống trong document:**
- Dùng **Pool + Cursor kết hợp**: Pool lưu 200 IDs trong Redis, cursor tracking đã serve đến đâu trong pool đó.
- FE pre-fetch khi còn 5 video.
- Fallback về trending nếu pool hết và AI chưa kịp refill.

---

## Kết Luận

Document gốc mô tả đúng luồng cơ bản nhưng bỏ qua phần quan trọng nhất trong trải nghiệm người dùng. Sự khác biệt giữa một hệ thống recommendation "ổn" và "tốt" nằm ở:

1. **AI không gọi real-time theo từng request** → generate pool trước
2. **Backend serve từ pool** → latency thấp, không phụ thuộc AI mỗi lần
3. **FE pre-fetch sớm** → user không bao giờ thấy loading
4. **Luôn có fallback** → hệ thống không bao giờ trả về màn hình trống

Đây là lý do tại sao TikTok có thể serve video gần như ngay lập tức dù feed được cá nhân hóa cho từng người dùng.

---

*Bài viết này là phần mở rộng cho document [Hệ Thống Recommendation cho Video](https://documents-inky.vercel.app/docs/tutorial-backend/recommendation), tập trung vào cơ chế pagination và infinite scroll mà document gốc chưa đề cập.*
