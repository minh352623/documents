# Hệ Thống Recommendation cho Video

## Tổng quan

Hệ thống recommendation được thiết kế để gợi ý video phù hợp cho người dùng dựa trên hành vi xem và các thông tin liên quan. Hệ thống sử dụng kiến trúc hiện đại với AI/ML, xử lý real-time events, và tối ưu hóa cho khả năng mở rộng (scalability).

## Database Schema Tổng quan

Hệ thống sử dụng 4 bảng chính:

| Bảng | Database | Mục đích | Các trường chính |
|------|----------|----------|------------------|
| **playback_events** | ClickHouse | Ghi lại mọi thông tin chi tiết từ video playback: bắt đầu, dừng, tua, like, share, comment, scroll... | `event_id`, `user_id`, `video_id`, `session_id`, `event_type`, `position_index`, `impression_timestamp`, `scroll_speed_ms`, `device_type`, `network_type`, `geo_location`, `time_of_day`, `day_of_week` |
| **watch_sessions** | ClickHouse | Tổng hợp từ playback_events thành các phiên xem hoàn chỉnh với metrics chi tiết | `session_id`, `user_id`, `video_id`, `started_at`, `ended_at`, `total_watch_time_ms`, `is_finished`, `video_duration_ms`, `effective_watch_time_ms`, `num_pauses`, `num_resumes`, `num_replays`, `scrolled_in`, `scrolled_out`, `exit_reason`, `watch_time_ratio`, `is_valid_view` |
| **users** | PostgreSQL | Lưu thông tin người dùng và preferences | `user_id`, `created_at`, `age`, `gender`, `language`, `interested_categories`, `avg_daily_watch_time_ms`, `device_type`, `preferred_creators`, `engagement_score`, `region` |
| **videos** | PostgreSQL | Metadata của videos | `video_id`, `creator_id`, `upload_time`, `duration_ms`, `category`, `tags`, `language`, `sound_id`, `thumbnail_url`, `is_trending`, `peertube_uuid` |

**Lý do chọn database**:
- **ClickHouse** cho events & sessions: Dữ liệu rất lớn, cần tốc độ ghi cao, độ nén tốt, query analytics nhanh
- **PostgreSQL** cho users & videos: Dữ liệu nhỏ-vừa, ít thay đổi, cần ACID compliance và tính ổn định

## Kiến trúc tổng thể

![Recommendation System Architecture](/mermaid-drawing.png)


## Các thành phần chính

### 1. Data Collection Flow (Thu thập dữ liệu)

#### 1.1. User Events Tracking

**Mục đích**: Theo dõi các hành vi người dùng khi tương tác với video.

**Events được thu thập**:
- `view_start`: Bắt đầu xem video
- `view_end`: Kết thúc xem video
- `scroll_pass`: User lướt qua video (impression)
- `like`: Thích video
- `comment`: Bình luận video
- `share`: Chia sẻ video
- `follow_creator`: Theo dõi creator
- `save`: Lưu video
- `report`: Báo cáo video

**Cấu trúc Event**:
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user_123",
  "video_id": "video_456",
  "session_id": "session_789",
  "event_type": "view_start",
  "position_index": 5,
  "impression_timestamp": "2026-01-20T10:30:45.123Z",
  "scroll_speed_ms": 850.5,
  "device_type": "ios",
  "network_type": "wifi",
  "geo_location": "Ho Chi Minh City, Vietnam",
  "time_of_day": 10,
  "day_of_week": 1
}
```

#### 1.2. API Gateway / Backend

**Vai trò**:
- Nhận events từ client (web app, mobile app)
- Validate dữ liệu đầu vào
- Gửi events đến message broker (async)
- Trả response nhanh cho client

**API Endpoints**:
```
POST /api/v1/events/track
POST /api/v1/recommendations/feed
GET /api/v1/recommendations/similar/{video_id}
```

**Implementation Example**:
```python
@app.post("/api/v1/events/track")
async def track_event(event: EventSchema):
    # Validate event
    validated_event = validate_event(event)
    
    # Send to Kafka asynchronously
    await kafka_producer.send(
        topic="video-events",
        value=validated_event.dict()
    )
    
    return {"status": "success", "event_id": validated_event.event_id}
```

#### 1.3. Message Broker (Kafka/RabbitMQ)

**Mục đích**: 
- Decoupling giữa API và storage layer
- Buffer cho high-throughput events
- Đảm bảo không mất dữ liệu với durability

**Configuration Kafka**:
```yaml
topics:
  - name: video-events
    partitions: 10
    replication_factor: 3
    retention_ms: 604800000  # 7 days
    
  - name: video-sessions
    partitions: 5
    replication_factor: 3
```

### 2. Storage Layer (Lưu trữ dữ liệu)

#### 2.1. ClickHouse: Playback Events

**Mục đích**: Lưu trữ raw events với hiệu suất cao cho analytics.

**Đặc điểm dữ liệu**: 
- Dữ liệu rất lớn (high volume)
- Cần tốc độ ghi cao (high write throughput)
- Yêu cầu nén dữ liệu tốt (compression)
- Query phân tích nhanh
- **Khuyến nghị: ClickHouse**

**Schema**:
```sql
CREATE TABLE playback_events (
    event_id UUID,
    user_id String,
    video_id String,
    session_id String,
    event_type Enum8(
        'view_start' = 1,
        'view_end' = 2,
        'scroll_pass' = 3,
        'like' = 4,
        'comment' = 5,
        'share' = 6,
        'follow_creator' = 7,
        'save' = 8,
        'report' = 9
    ),
    position_index Int32 COMMENT 'Thứ tự xuất hiện trong feed',
    impression_timestamp DateTime64(3) COMMENT 'Thời điểm video được hiển thị',
    scroll_speed_ms Float32 COMMENT 'Tốc độ lướt giữa các video (milliseconds)',
    device_type Enum8('ios' = 1, 'android' = 2, 'web' = 3),
    network_type Enum8('wifi' = 1, '4g' = 2, '5g' = 3, 'other' = 4),
    geo_location String COMMENT 'Vị trí coarse (city/country)',
    time_of_day Int8 COMMENT 'Giờ trong ngày: 0-23',
    day_of_week Int8 COMMENT 'Thứ trong tuần: 1-7 (1=Monday)',
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(impression_timestamp)
ORDER BY (user_id, impression_timestamp, event_type)
SETTINGS index_granularity = 8192;
```

**Consumer Implementation**:
```python
from kafka import KafkaConsumer
from clickhouse_driver import Client

consumer = KafkaConsumer(
    'video-events',
    bootstrap_servers=['localhost:9092'],
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

ch_client = Client('localhost')

for message in consumer:
    event = message.value
    ch_client.execute(
        'INSERT INTO playback_events VALUES',
        [event]
    )
```

#### 2.2. ClickHouse: Watch Sessions

**Mục đích**: Aggregate events thành sessions để phân tích hành vi xem video của người dùng.

**Đặc điểm dữ liệu**:
- Được tổng hợp từ playback_events
- Dữ liệu vẫn khá lớn
- Đặc thù tương tự playback_events
- **Khuyến nghị: ClickHouse**

**Cách tổng hợp**: Sử dụng cronjob hoặc materialized view để aggregate từ playback_events

**Schema**:
```sql
CREATE TABLE watch_sessions (
    session_id String COMMENT 'Khóa chính session',
    user_id String COMMENT 'User ID',
    video_id String COMMENT 'Video ID',
    started_at DateTime COMMENT 'Bắt đầu xem',
    ended_at DateTime COMMENT 'Kết thúc xem',
    total_watch_time_ms Int32 COMMENT 'Tổng thời gian xem thực sự (milliseconds)',
    is_finished Boolean COMMENT 'Xem hết chưa (>= 90%)',
    video_duration_ms Int32 COMMENT 'Tổng thời lượng video (milliseconds)',
    effective_watch_time_ms Int32 COMMENT 'Thời gian xem hiệu quả (bỏ pause, seek backwards)',
    num_pauses Int16 COMMENT 'Số lần pause',
    num_resumes Int16 COMMENT 'Số lần resume',
    num_replays Int16 COMMENT 'Số vòng lặp/xem lại',
    scrolled_in Boolean COMMENT 'User scroll đến video',
    scrolled_out Boolean COMMENT 'User scroll khỏi video',
    exit_reason Enum8(
        'scroll' = 1,
        'end_video' = 2,
        'close_app' = 3,
        'click_other' = 4
    ) COMMENT 'Lý do thoát',
    watch_time_ratio Float32 COMMENT 'total_watch_time_ms / video_duration_ms',
    is_valid_view Boolean COMMENT 'True nếu watch_time > 300ms',
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(started_at)
ORDER BY (user_id, started_at)
SETTINGS index_granularity = 8192;
```

**Materialized View** (Real-time aggregation):
```sql
CREATE MATERIALIZED VIEW watch_sessions_mv TO watch_sessions AS
SELECT
    session_id,
    user_id,
    video_id,
    min(impression_timestamp) as started_at,
    max(impression_timestamp) as ended_at,
    -- Calculate total watch time (milliseconds between start and end)
    dateDiff('millisecond', min(impression_timestamp), max(impression_timestamp)) as total_watch_time_ms,
    -- Check if finished (would need video duration from videos table - simplified here)
    0 as is_finished,  -- Set via cronjob with JOIN to videos table
    0 as video_duration_ms,  -- Set via cronjob with JOIN to videos table
    dateDiff('millisecond', min(impression_timestamp), max(impression_timestamp)) as effective_watch_time_ms,
    -- Count pause events (would need additional event types)
    0 as num_pauses,
    0 as num_resumes,
    0 as num_replays,
    -- Check scroll events
    countIf(event_type = 'scroll_pass') > 0 as scrolled_in,
    countIf(event_type = 'scroll_pass') > 0 as scrolled_out,
    -- Determine exit reason from last event
    if(
        argMax(event_type, impression_timestamp) = 'view_end', 'end_video',
        if(argMax(event_type, impression_timestamp) = 'scroll_pass', 'scroll', 'close_app')
    ) as exit_reason,
    0.0 as watch_time_ratio,  -- Set via cronjob with video duration
    dateDiff('millisecond', min(impression_timestamp), max(impression_timestamp)) > 300 as is_valid_view,
    now() as created_at
FROM playback_events
WHERE event_type IN ('view_start', 'view_end', 'scroll_pass')
GROUP BY session_id, user_id, video_id;
```

**Lưu ý**: Materialized view chỉ tính toán các metrics cơ bản. Để có các metrics chính xác như `is_finished`, `watch_time_ratio`, cần sử dụng cronjob để JOIN với bảng `videos` lấy `video_duration_ms`.

**Cronjob Alternative** (Khuyến nghị cho logic phức tạp):
```python
# Run every 5 minutes
import psycopg2
from clickhouse_driver import Client
from datetime import datetime, timedelta

# Database connections
ch_client = Client('clickhouse-host')
pg_conn = psycopg2.connect("dbname=recommendation user=admin password=xxx host=postgres-host")
pg_cursor = pg_conn.cursor()

def get_video_duration(video_id):
    """Lấy duration từ PostgreSQL videos table"""
    pg_cursor.execute(
        "SELECT duration_ms FROM videos WHERE video_id = %s",
        (video_id,)
    )
    result = pg_cursor.fetchone()
    return result[0] if result else 60000  # Default 60 seconds

def aggregate_sessions():
    """
    Aggregate playback events thành watch sessions với đầy đủ metrics
    """
    print(f"[{datetime.now()}] Starting session aggregation...")
    
    # Query để lấy sessions cần xử lý
    query = """
    SELECT
        session_id,
        user_id,
        video_id,
        groupArray(event_type) as events,
        min(impression_timestamp) as started_at,
        max(impression_timestamp) as ended_at,
        countIf(event_type = 'scroll_pass') as scroll_count,
        argMax(event_type, impression_timestamp) as last_event
    FROM playback_events
    WHERE impression_timestamp >= now() - INTERVAL 5 MINUTE
    GROUP BY session_id, user_id, video_id
    HAVING countIf(event_type IN ('view_start', 'view_end')) > 0
    """
    
    sessions_data = ch_client.execute(query)
    
    watch_sessions = []
    for session in sessions_data:
        session_id, user_id, video_id, events, started_at, ended_at, scroll_count, last_event = session
        
        # Get video duration
        video_duration_ms = get_video_duration(video_id)
        
        # Calculate watch time
        total_watch_time_ms = int((ended_at - started_at).total_seconds() * 1000)
        
        # Calculate effective watch time (simplified - same as total for now)
        effective_watch_time_ms = total_watch_time_ms
        
        # Calculate watch time ratio
        watch_time_ratio = total_watch_time_ms / video_duration_ms if video_duration_ms > 0 else 0
        
        # Check if finished (>= 90%)
        is_finished = watch_time_ratio >= 0.9
        
        # Determine exit reason
        exit_reason = 'close_app'  # Default
        if last_event == 'view_end':
            exit_reason = 'end_video'
        elif last_event == 'scroll_pass':
            exit_reason = 'scroll'
        
        # Count interactions (simplified - would need more event types)
        num_pauses = events.count('pause') if 'pause' in str(events) else 0
        num_resumes = events.count('resume') if 'resume' in str(events) else 0
        num_replays = events.count('replay') if 'replay' in str(events) else 0
        
        # Scroll flags
        scrolled_in = scroll_count > 0
        scrolled_out = scroll_count > 0
        
        # Valid view check
        is_valid_view = total_watch_time_ms > 300
        
        watch_sessions.append((
            session_id,
            user_id,
            video_id,
            started_at,
            ended_at,
            total_watch_time_ms,
            is_finished,
            video_duration_ms,
            effective_watch_time_ms,
            num_pauses,
            num_resumes,
            num_replays,
            scrolled_in,
            scrolled_out,
            exit_reason,
            watch_time_ratio,
            is_valid_view,
            datetime.now()
        ))
    
    # Bulk insert vào watch_sessions
    if watch_sessions:
        ch_client.execute(
            'INSERT INTO watch_sessions VALUES',
            watch_sessions
        )
        print(f"Inserted {len(watch_sessions)} watch sessions")
    else:
        print("No sessions to insert")

# Schedule chạy mỗi 5 phút
if __name__ == "__main__":
    import schedule
    import time
    
    schedule.every(5).minutes.do(aggregate_sessions)
    
    while True:
        schedule.run_pending()
        time.sleep(60)
```

#### 2.3. PostgreSQL: Users & Videos Metadata

**Mục đích**: Lưu trữ metadata về users và videos.

**Đặc điểm dữ liệu**:
- Dữ liệu nhỏ đến vừa
- Ít thay đổi (relatively stable)
- Cần sự ổn định và ACID compliance
- **Khuyến nghị: PostgreSQL hoặc MySQL**

**Schema**:
```sql
-- Users Table
CREATE TABLE users (
    user_id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Ngày đăng ký',
    age INTEGER COMMENT 'Tuổi (nếu có)',
    gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'unknown')) DEFAULT 'unknown',
    language VARCHAR(10) COMMENT 'Ngôn ngữ chính (vi, en, etc.)',
    interested_categories TEXT[] COMMENT 'Danh mục yêu thích',
    avg_daily_watch_time_ms INTEGER DEFAULT 0 COMMENT 'Thói quen xem trung bình mỗi ngày',
    device_type VARCHAR(50) COMMENT 'Thiết bị chính',
    preferred_creators TEXT[] COMMENT 'Creator theo dõi',
    engagement_score FLOAT DEFAULT 0 COMMENT 'Điểm hoạt động tổng hợp',
    region VARCHAR(100) COMMENT 'Khu vực/Quốc gia',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_region ON users(region);
CREATE INDEX idx_users_language ON users(language);
CREATE INDEX idx_users_engagement ON users(engagement_score DESC);
CREATE INDEX idx_users_interested_categories ON users USING GIN(interested_categories);

COMMENT ON COLUMN users.engagement_score IS 'Công thức: score = 1*(watch_time_ratio > 0.7) + 0.3*like + 0.4*share + 0.4*comment';

-- Videos Table
CREATE TABLE videos (
    video_id VARCHAR(255) PRIMARY KEY,
    creator_id VARCHAR(255) NOT NULL COMMENT 'ID của người tạo video',
    upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian upload',
    duration_ms INTEGER NOT NULL COMMENT 'Thời lượng video (milliseconds)',
    category VARCHAR(100) COMMENT 'Danh mục: lifestyle, music, education, etc.',
    tags TEXT[] COMMENT 'Hashtags',
    language VARCHAR(10) COMMENT 'Ngôn ngữ nói trong video',
    sound_id VARCHAR(255) COMMENT 'ID của nhạc nền',
    thumbnail_url TEXT COMMENT 'URL thumbnail',
    is_trending BOOLEAN DEFAULT FALSE COMMENT 'Video đang trending',
    peertube_uuid VARCHAR(255) COMMENT 'Link to PeerTube',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_videos_creator ON videos(creator_id);
CREATE INDEX idx_videos_category ON videos(category);
CREATE INDEX idx_videos_upload_time ON videos(upload_time DESC);
CREATE INDEX idx_videos_tags ON videos USING GIN(tags);
CREATE INDEX idx_videos_trending ON videos(is_trending) WHERE is_trending = TRUE;
CREATE INDEX idx_videos_language ON videos(language);
CREATE INDEX idx_videos_sound ON videos(sound_id);
```

**Cập nhật Engagement Score cho Users**:

Engagement score được tính dựa trên công thức: 
```
score = 1 * (watch_time_ratio > 0.7) + 0.3 * like + 0.4 * share + 0.4 * comment
```

```python
def calculate_user_engagement_score(user_id: str) -> float:
    """
    Tính engagement score cho user dựa trên hành vi trong 30 ngày gần nhất
    """
    # Get user's watch sessions and interactions
    query = """
    SELECT
        ws.session_id,
        ws.watch_time_ratio,
        countIf(pe.event_type = 'like') as likes,
        countIf(pe.event_type = 'share') as shares,
        countIf(pe.event_type = 'comment') as comments
    FROM watch_sessions ws
    LEFT JOIN playback_events pe ON ws.session_id = pe.session_id
    WHERE ws.user_id = '{user_id}'
    AND ws.started_at >= now() - INTERVAL 30 DAY
    GROUP BY ws.session_id, ws.watch_time_ratio
    """
    
    sessions = ch_client.execute(query.format(user_id=user_id))
    
    if not sessions:
        return 0.0
    
    total_score = 0
    for session in sessions:
        session_id, watch_time_ratio, likes, shares, comments = session
        
        # Calculate score for this session
        score = (
            (1.0 if watch_time_ratio > 0.7 else 0.0) +
            (0.3 * likes) +
            (0.4 * shares) +
            (0.4 * comments)
        )
        total_score += score
    
    # Average score across all sessions
    avg_score = total_score / len(sessions)
    
    return round(avg_score, 2)

def update_user_engagement_scores():
    """
    Cronjob để update engagement scores cho tất cả users (chạy hàng ngày)
    """
    # Get all active users (có hoạt động trong 30 ngày qua)
    active_users = ch_client.execute("""
        SELECT DISTINCT user_id
        FROM watch_sessions
        WHERE started_at >= now() - INTERVAL 30 DAY
    """)
    
    for user_row in active_users:
        user_id = user_row[0]
        engagement_score = calculate_user_engagement_score(user_id)
        
        # Update PostgreSQL
        pg_cursor.execute(
            "UPDATE users SET engagement_score = %s, updated_at = NOW() WHERE user_id = %s",
            (engagement_score, user_id)
        )
    
    pg_conn.commit()
    print(f"Updated engagement scores for {len(active_users)} users")
```

### 3. AI Recommendation System

#### 3.1. Feature Engineering

**Mục đích**: Tạo features từ dữ liệu thô để training model.

**User Features**:
```python
def extract_user_features(user_id: str) -> dict:
    # From ClickHouse watch_sessions - recent behavior
    user_history = ch_client.execute(f"""
        SELECT
            count() as total_sessions,
            avg(watch_time_ratio) as avg_completion_ratio,
            sum(total_watch_time_ms) as total_watch_time_ms,
            countDistinct(video_id) as unique_videos,
            groupArray(video_id) as watched_videos,
            countIf(is_finished = true) as finished_videos,
            countIf(is_valid_view = true) as valid_views,
            avg(effective_watch_time_ms) as avg_effective_watch_time
        FROM watch_sessions
        WHERE user_id = '{user_id}'
        AND started_at >= now() - INTERVAL 30 DAY
    """)
    
    # From PostgreSQL users - profile data
    user_profile = db.query(f"""
        SELECT 
            created_at, age, gender, language, 
            interested_categories, avg_daily_watch_time_ms,
            device_type, preferred_creators, engagement_score, region
        FROM users
        WHERE user_id = '{user_id}'
    """)
    
    if not user_profile:
        return None
    
    profile = user_profile[0]
    history = user_history[0] if user_history else [0] * 8
    
    return {
        "user_id": user_id,
        # Behavioral features
        "total_sessions": history[0],
        "avg_completion_ratio": history[1],
        "total_watch_time_ms": history[2],
        "unique_videos_watched": history[3],
        "watched_video_ids": history[4],
        "finished_videos_count": history[5],
        "valid_views_count": history[6],
        "avg_effective_watch_time_ms": history[7],
        # Profile features
        "account_age_days": (datetime.now() - profile[0]).days if profile[0] else 0,
        "age": profile[1],
        "gender": profile[2],
        "language": profile[3],
        "interested_categories": profile[4],
        "avg_daily_watch_time_ms": profile[5],
        "device_type": profile[6],
        "preferred_creators": profile[7],
        "engagement_score": profile[8],
        "region": profile[9]
    }
```

**Video Features**:
```python
def extract_video_features(video_id: str) -> dict:
    # From PostgreSQL videos - metadata
    video_meta = db.query(f"""
        SELECT 
            creator_id, upload_time, duration_ms, category, tags,
            language, sound_id, thumbnail_url, is_trending
        FROM videos
        WHERE video_id = '{video_id}'
    """)
    
    if not video_meta:
        return None
    
    meta = video_meta[0]
    
    # From ClickHouse - engagement metrics
    engagement = ch_client.execute(f"""
        SELECT
            avg(watch_time_ratio) as avg_completion_ratio,
            count() as total_sessions,
            countDistinct(user_id) as unique_viewers,
            countIf(is_finished = true) as finished_count,
            countIf(is_valid_view = true) as valid_view_count,
            avg(total_watch_time_ms) as avg_watch_time_ms,
            countIf(scrolled_in = true) as scroll_in_count,
            countIf(exit_reason = 'end_video') as completed_sessions,
            countIf(exit_reason = 'scroll') as scrolled_away_count
        FROM watch_sessions
        WHERE video_id = '{video_id}'
        AND started_at >= now() - INTERVAL 30 DAY
    """)
    
    eng = engagement[0] if engagement else [0] * 9
    
    # Get interaction counts from playback_events
    interactions = ch_client.execute(f"""
        SELECT
            countIf(event_type = 'like') as like_count,
            countIf(event_type = 'share') as share_count,
            countIf(event_type = 'comment') as comment_count,
            countIf(event_type = 'save') as save_count
        FROM playback_events
        WHERE video_id = '{video_id}'
        AND impression_timestamp >= now() - INTERVAL 30 DAY
    """)
    
    inter = interactions[0] if interactions else [0] * 4
    
    return {
        "video_id": video_id,
        # Metadata features
        "creator_id": meta[0],
        "upload_time": meta[1],
        "duration_ms": meta[2],
        "category": meta[3],
        "tags": meta[4],
        "language": meta[5],
        "sound_id": meta[6],
        "is_trending": meta[8],
        # Engagement features
        "avg_completion_ratio": eng[0],
        "total_sessions": eng[1],
        "unique_viewers": eng[2],
        "finished_count": eng[3],
        "valid_view_count": eng[4],
        "avg_watch_time_ms": eng[5],
        "scroll_in_count": eng[6],
        "completed_sessions": eng[7],
        "scrolled_away_count": eng[8],
        # Interaction features
        "like_count": inter[0],
        "share_count": inter[1],
        "comment_count": inter[2],
        "save_count": inter[3],
        # Calculated metrics
        "retention_rate": eng[7] / eng[1] if eng[1] > 0 else 0,
        "engagement_rate": (inter[0] + inter[1] + inter[2]) / eng[1] if eng[1] > 0 else 0
    }
```

**Feature Store**:
```python
# Store features for fast access
import redis

redis_client = redis.Redis(host='localhost', port=6379)

def store_user_features(user_id: str, features: dict):
    redis_client.setex(
        f"user_features:{user_id}",
        3600,  # TTL 1 hour
        json.dumps(features)
    )

def get_user_features(user_id: str) -> dict:
    cached = redis_client.get(f"user_features:{user_id}")
    if cached:
        return json.loads(cached)
    
    features = extract_user_features(user_id)
    store_user_features(user_id, features)
    return features
```

#### 3.2. Model Training

**Mục đích**: Train AI model để dự đoán videos phù hợp với user.

**Approaches**:

**A. Collaborative Filtering (Matrix Factorization)**:
```python
from surprise import SVD, Dataset, Reader
import pandas as pd

# Prepare training data
def prepare_training_data():
    query = """
    SELECT user_id, video_id, completion_rate * 5 as rating
    FROM watch_sessions
    WHERE session_start >= now() - INTERVAL 90 DAY
    AND completion_rate > 0.1
    """
    df = ch_client.query_dataframe(query)
    return df

# Train model
df = prepare_training_data()
reader = Reader(rating_scale=(0, 5))
data = Dataset.load_from_df(df[['user_id', 'video_id', 'rating']], reader)

trainset = data.build_full_trainset()
model = SVD(n_factors=100, n_epochs=20, lr_all=0.005, reg_all=0.02)
model.fit(trainset)

# Save model
import joblib
joblib.dump(model, 'models/svd_model.pkl')
```

**B. Deep Learning (Two-Tower Neural Network)**:
```python
import tensorflow as tf
from tensorflow.keras import layers

def create_two_tower_model(user_vocab_size, video_vocab_size, embedding_dim=64):
    # User Tower
    user_input = layers.Input(shape=(1,), name='user_id')
    user_embedding = layers.Embedding(user_vocab_size, embedding_dim)(user_input)
    user_features = layers.Flatten()(user_embedding)
    user_dense = layers.Dense(128, activation='relu')(user_features)
    user_tower = layers.Dense(64, activation='relu', name='user_tower')(user_dense)
    
    # Video Tower
    video_input = layers.Input(shape=(1,), name='video_id')
    video_embedding = layers.Embedding(video_vocab_size, embedding_dim)(video_input)
    video_features = layers.Flatten()(video_embedding)
    video_dense = layers.Dense(128, activation='relu')(video_features)
    video_tower = layers.Dense(64, activation='relu', name='video_tower')(video_dense)
    
    # Dot product for similarity
    output = layers.Dot(axes=1, normalize=True)([user_tower, video_tower])
    
    model = tf.keras.Model(inputs=[user_input, video_input], outputs=output)
    model.compile(optimizer='adam', loss='mse', metrics=['mae'])
    
    return model

# Training
model = create_two_tower_model(num_users, num_videos)
model.fit(
    [train_user_ids, train_video_ids],
    train_ratings,
    epochs=10,
    batch_size=256,
    validation_split=0.2
)

model.save('models/two_tower_model.h5')
```

**Training Pipeline**:
```python
# Schedule daily retraining
import schedule

def retrain_model():
    print("Starting model retraining...")
    
    # 1. Extract latest data
    training_data = prepare_training_data()
    
    # 2. Train model
    model = train_recommendation_model(training_data)
    
    # 3. Evaluate model
    metrics = evaluate_model(model, validation_data)
    print(f"Model metrics: {metrics}")
    
    # 4. Deploy if performance is good
    if metrics['precision@10'] > 0.3:
        deploy_model(model)
        print("Model deployed successfully")
    else:
        print("Model performance below threshold, keeping old model")

# Run daily at 2 AM
schedule.every().day.at("02:00").do(retrain_model)
```

#### 3.3. Inference Engine

**Mục đích**: Serve predictions real-time cho user requests.

**Implementation**:
```python
from fastapi import FastAPI
import joblib
import numpy as np

app = FastAPI()

# Load model
model = joblib.load('models/svd_model.pkl')

# In-memory video catalog for fast lookup
video_catalog = load_video_catalog()  # All video IDs

@app.post("/api/v1/inference/recommend")
async def get_recommendations(user_id: str, n: int = 10):
    # Get user's watched videos
    watched_videos = get_watched_videos(user_id)
    
    # Get candidate videos (not watched yet)
    candidate_videos = [
        v for v in video_catalog 
        if v not in watched_videos
    ]
    
    # Predict scores for all candidates
    predictions = []
    for video_id in candidate_videos:
        pred = model.predict(user_id, video_id)
        predictions.append({
            "video_id": video_id,
            "score": pred.est
        })
    
    # Sort by score and return top N
    recommendations = sorted(
        predictions, 
        key=lambda x: x['score'], 
        reverse=True
    )[:n]
    
    return {
        "user_id": user_id,
        "recommendations": [r['video_id'] for r in recommendations],
        "scores": [r['score'] for r in recommendations]
    }

# For Deep Learning model
@app.post("/api/v1/inference/recommend-dl")
async def get_recommendations_dl(user_id: str, n: int = 10):
    import tensorflow as tf
    
    # Load DL model
    model = tf.keras.models.load_model('models/two_tower_model.h5')
    
    # Prepare input
    user_ids = np.array([user_id_to_index[user_id]] * len(candidate_videos))
    video_ids = np.array([video_id_to_index[v] for v in candidate_videos])
    
    # Predict
    scores = model.predict([user_ids, video_ids])
    
    # Get top N
    top_indices = np.argsort(scores.flatten())[-n:][::-1]
    recommended_videos = [candidate_videos[i] for i in top_indices]
    
    return {
        "user_id": user_id,
        "recommendations": recommended_videos,
        "scores": [float(scores[i]) for i in top_indices]
    }
```

**Caching Strategy**:
```python
import redis

redis_client = redis.Redis(host='localhost', port=6379)

@app.post("/api/v1/inference/recommend-cached")
async def get_recommendations_cached(user_id: str, n: int = 10):
    # Check cache first
    cache_key = f"recs:{user_id}:{n}"
    cached = redis_client.get(cache_key)
    
    if cached:
        return json.loads(cached)
    
    # Generate recommendations
    recommendations = await get_recommendations(user_id, n)
    
    # Cache for 10 minutes
    redis_client.setex(cache_key, 600, json.dumps(recommendations))
    
    return recommendations
```

### 4. Serving Flow (Phục vụ người dùng)

#### 4.1. Get Feed API

**Endpoint**: `GET /api/v1/recommendations/feed`

**Flow**:
1. User request feed từ app
2. API Gateway gọi Inference Engine
3. Inference Engine trả về list video IDs
4. API Gateway fetch metadata từ PostgreSQL
5. Trả về complete feed cho user

**Implementation**:
```python
from fastapi import FastAPI, Depends
import httpx

app = FastAPI()

@app.get("/api/v1/recommendations/feed")
async def get_feed(
    user_id: str,
    limit: int = 20,
    offset: int = 0
):
    # 1. Get recommendations from Inference Engine
    async with httpx.AsyncClient() as client:
        inference_response = await client.post(
            "http://inference-engine:8000/api/v1/inference/recommend",
            json={"user_id": user_id, "n": limit}
        )
        recommended_video_ids = inference_response.json()['recommendations']
    
    # 2. Fetch video metadata from PostgreSQL
    videos = db.query(f"""
        SELECT video_id, title, description, duration, 
               category, tags, view_count, like_count, peertube_uuid
        FROM videos
        WHERE video_id IN ({','.join([f"'{v}'" for v in recommended_video_ids])})
    """)
    
    # 3. Format response
    feed = []
    for video in videos:
        feed.append({
            "video_id": video[0],
            "title": video[1],
            "description": video[2],
            "duration": video[3],
            "category": video[4],
            "tags": video[5],
            "view_count": video[6],
            "like_count": video[7],
            "stream_url": f"https://peertube.example.com/videos/{video[8]}",
            "thumbnail_url": f"https://peertube.example.com/static/thumbnails/{video[8]}.jpg"
        })
    
    return {
        "user_id": user_id,
        "feed": feed,
        "total": len(feed),
        "offset": offset,
        "limit": limit
    }
```

#### 4.2. Similar Videos API

**Endpoint**: `GET /api/v1/recommendations/similar/{video_id}`

**Implementation**:
```python
@app.get("/api/v1/recommendations/similar/{video_id}")
async def get_similar_videos(video_id: str, limit: int = 10):
    # Get video features
    video_features = extract_video_features(video_id)
    
    # Find similar videos based on:
    # - Same category
    # - Similar tags
    # - Similar duration
    similar_videos = db.query(f"""
        SELECT v.video_id, v.title, v.category, v.tags, v.duration,
               -- Calculate similarity score
               (
                   CASE WHEN v.category = '{video_features['category']}' THEN 10 ELSE 0 END +
                   (SELECT COUNT(*) FROM unnest(v.tags) t WHERE t = ANY(ARRAY{video_features['tags']})) * 5 +
                   (10 - ABS(v.duration - {video_features['duration']}) / 60)
               ) as similarity_score
        FROM videos v
        WHERE v.video_id != '{video_id}'
        ORDER BY similarity_score DESC
        LIMIT {limit}
    """)
    
    return {
        "source_video_id": video_id,
        "similar_videos": [
            {
                "video_id": v[0],
                "title": v[1],
                "category": v[2],
                "tags": v[3],
                "duration": v[4],
                "similarity_score": v[5]
            }
            for v in similar_videos
        ]
    }
```

### 5. PeerTube Integration

#### 5.1. Video Upload Flow

**PeerTube** là platform hosting videos. Integration với recommendation system:

```python
import requests

PEERTUBE_API = "https://peertube.example.com/api/v1"
PEERTUBE_TOKEN = "your_peertube_token"

def upload_video_to_peertube(video_file, metadata):
    # Upload to PeerTube
    response = requests.post(
        f"{PEERTUBE_API}/videos/upload",
        headers={"Authorization": f"Bearer {PEERTUBE_TOKEN}"},
        files={"videofile": video_file},
        data={
            "name": metadata['title'],
            "description": metadata['description'],
            "category": metadata['category'],
            "tags": metadata['tags']
        }
    )
    
    peertube_uuid = response.json()['video']['uuid']
    
    # Save to PostgreSQL
    db.execute(f"""
        INSERT INTO videos (video_id, title, description, duration, 
                          category, tags, peertube_uuid)
        VALUES ('{generate_video_id()}', '{metadata['title']}', 
                '{metadata['description']}', {metadata['duration']},
                '{metadata['category']}', ARRAY{metadata['tags']}, 
                '{peertube_uuid}')
    """)
    
    return peertube_uuid
```

#### 5.2. Streaming Integration

```python
@app.get("/api/v1/videos/{video_id}/stream")
async def get_video_stream(video_id: str):
    # Get PeerTube UUID from PostgreSQL
    video = db.query(f"""
        SELECT peertube_uuid FROM videos WHERE video_id = '{video_id}'
    """)
    
    peertube_uuid = video[0][0]
    
    # Return PeerTube streaming URL
    return {
        "video_id": video_id,
        "stream_url": f"{PEERTUBE_API}/videos/{peertube_uuid}/streaming",
        "hls_url": f"{PEERTUBE_API}/videos/{peertube_uuid}/master.m3u8",
        "formats": [
            {"quality": "1080p", "url": f"{PEERTUBE_API}/videos/{peertube_uuid}/1080.mp4"},
            {"quality": "720p", "url": f"{PEERTUBE_API}/videos/{peertube_uuid}/720.mp4"},
            {"quality": "480p", "url": f"{PEERTUBE_API}/videos/{peertube_uuid}/480.mp4"}
        ]
    }
```

## Deployment & Scalability

### Docker Compose Setup

```yaml
version: '3.8'

services:
  # API Gateway
  api-gateway:
    image: recommendation-api:latest
    ports:
      - "8000:8000"
    environment:
      - KAFKA_BOOTSTRAP_SERVERS=kafka:9092
      - POSTGRES_HOST=postgres
      - CLICKHOUSE_HOST=clickhouse
      - INFERENCE_ENGINE_URL=http://inference-engine:8000
    depends_on:
      - kafka
      - postgres
      - clickhouse
  
  # Kafka
  kafka:
    image: confluentinc/cp-kafka:latest
    ports:
      - "9092:9092"
    environment:
      - KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
      - KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
  
  zookeeper:
    image: confluentinc/cp-zookeeper:latest
    environment:
      - ZOOKEEPER_CLIENT_PORT=2181
  
  # ClickHouse
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "8123:8123"
      - "9000:9000"
    volumes:
      - clickhouse-data:/var/lib/clickhouse
  
  # PostgreSQL
  postgres:
    image: postgres:15
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=recommendation
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres-data:/var/lib/postgresql/data
  
  # Event Consumer
  event-consumer:
    image: recommendation-consumer:latest
    environment:
      - KAFKA_BOOTSTRAP_SERVERS=kafka:9092
      - CLICKHOUSE_HOST=clickhouse
    depends_on:
      - kafka
      - clickhouse
  
  # Inference Engine
  inference-engine:
    image: recommendation-inference:latest
    ports:
      - "8001:8000"
    environment:
      - MODEL_PATH=/models/svd_model.pkl
      - REDIS_HOST=redis
    volumes:
      - ./models:/models
    depends_on:
      - redis
  
  # Redis (for caching)
  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  clickhouse-data:
  postgres-data:
```

### Kubernetes Deployment

```yaml
# api-gateway-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: recommendation-api:latest
        ports:
        - containerPort: 8000
        env:
        - name: KAFKA_BOOTSTRAP_SERVERS
          value: "kafka-service:9092"
        - name: POSTGRES_HOST
          value: "postgres-service"
        - name: CLICKHOUSE_HOST
          value: "clickhouse-service"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: api-gateway-service
spec:
  selector:
    app: api-gateway
  ports:
  - port: 80
    targetPort: 8000
  type: LoadBalancer
```

### Monitoring & Alerting

```python
# metrics.py
from prometheus_client import Counter, Histogram, Gauge
import time

# Metrics
event_counter = Counter('events_processed_total', 'Total events processed')
recommendation_latency = Histogram('recommendation_latency_seconds', 'Recommendation latency')
active_users = Gauge('active_users', 'Number of active users')

# Usage in API
@app.post("/api/v1/events/track")
async def track_event(event: EventSchema):
    event_counter.inc()  # Increment counter
    
    # Process event
    await kafka_producer.send("video-events", value=event.dict())
    
    return {"status": "success"}

@app.get("/api/v1/recommendations/feed")
async def get_feed(user_id: str):
    start_time = time.time()
    
    # Get recommendations
    recommendations = await get_recommendations(user_id)
    
    # Record latency
    recommendation_latency.observe(time.time() - start_time)
    
    return recommendations
```

### Performance Optimization

#### 1. Database Indexing
```sql
-- ClickHouse
CREATE INDEX idx_user_timestamp ON playback_events (user_id, timestamp) TYPE minmax;
CREATE INDEX idx_video_timestamp ON playback_events (video_id, timestamp) TYPE minmax;

-- PostgreSQL
CREATE INDEX idx_videos_category_views ON videos(category, view_count DESC);
CREATE INDEX idx_videos_created ON videos(created_at DESC);
```

#### 2. Caching Strategy
```python
# Multi-level caching
class RecommendationCache:
    def __init__(self):
        self.redis_client = redis.Redis()
        self.local_cache = {}  # In-memory cache
    
    def get_recommendations(self, user_id: str):
        # L1: Local cache (fastest)
        if user_id in self.local_cache:
            return self.local_cache[user_id]
        
        # L2: Redis cache
        cached = self.redis_client.get(f"recs:{user_id}")
        if cached:
            recommendations = json.loads(cached)
            self.local_cache[user_id] = recommendations
            return recommendations
        
        # L3: Generate new recommendations
        recommendations = generate_recommendations(user_id)
        
        # Store in both caches
        self.redis_client.setex(f"recs:{user_id}", 600, json.dumps(recommendations))
        self.local_cache[user_id] = recommendations
        
        return recommendations
```

#### 3. Batch Processing
```python
# Process events in batches for better throughput
async def batch_process_events(batch_size=1000):
    events_batch = []
    
    async for message in kafka_consumer:
        events_batch.append(message.value)
        
        if len(events_batch) >= batch_size:
            # Batch insert to ClickHouse
            ch_client.execute(
                'INSERT INTO playback_events VALUES',
                events_batch
            )
            events_batch = []
```

## Testing

### Unit Tests
```python
import pytest

def test_feature_extraction():
    user_features = extract_user_features("user_123")
    
    assert "user_id" in user_features
    assert "total_sessions" in user_features
    assert user_features["total_sessions"] >= 0

def test_recommendation_generation():
    recommendations = get_recommendations("user_123", n=10)
    
    assert len(recommendations["recommendations"]) <= 10
    assert all(isinstance(v, str) for v in recommendations["recommendations"])
```

### Integration Tests
```python
@pytest.mark.asyncio
async def test_full_recommendation_flow():
    # 1. Track event
    event = {
        "event_type": "video_view",
        "user_id": "test_user",
        "video_id": "test_video"
    }
    response = await track_event(event)
    assert response["status"] == "success"
    
    # 2. Wait for processing
    await asyncio.sleep(5)
    
    # 3. Get recommendations
    recommendations = await get_feed("test_user")
    assert len(recommendations["feed"]) > 0
```

## Best Practices

### 1. Data Quality
- Validate all incoming events
- Remove duplicate events
- Handle missing data gracefully
- Monitor data freshness

### 2. Model Performance
- A/B test new models before full deployment
- Track metrics: Precision@K, Recall@K, NDCG
- Retrain regularly (daily/weekly)
- Monitor for model drift

### 3. System Reliability
- Implement circuit breakers for external services
- Use retry logic with exponential backoff
- Set up health checks for all services
- Monitor error rates and latency

### 4. Security
- Authenticate all API requests
- Encrypt sensitive data
- Rate limit API endpoints
- Sanitize user inputs

## Tóm tắt Implementation

### Luồng dữ liệu chính

1. **Event Collection**: User tương tác → API Gateway → Kafka → ClickHouse (playback_events)
2. **Session Aggregation**: Cronjob/Materialized View → ClickHouse (watch_sessions)
3. **Feature Engineering**: ClickHouse + PostgreSQL → Feature vectors
4. **Model Training**: Features → AI Model (SVD/Deep Learning)
5. **Serving**: User request → Inference Engine → Recommended videos → API → User

### Key Metrics cần theo dõi

**Event Metrics**:
- Events per second (EPS)
- Event processing latency
- Kafka consumer lag

**Session Metrics**:
- Average watch_time_ratio
- Valid view rate (>300ms)
- Completion rate (is_finished)
- Exit reason distribution

**Recommendation Metrics**:
- Precision@K (K=10, 20)
- Recall@K
- Click-through rate (CTR)
- Average watch time on recommended videos
- User engagement score trends

**System Metrics**:
- API response time
- Inference latency
- Database query performance
- Cache hit rate

### Database Size Estimations

**Giả định**: 1 triệu users, mỗi user xem 20 videos/ngày

**playback_events** (ClickHouse):
- Events/ngày: 1M users × 20 videos × 5 events/video = 100M events
- Size/event: ~200 bytes
- Storage/ngày: ~20 GB (raw), ~2-5 GB (compressed với ClickHouse)
- Storage/năm: ~700 GB - 1.8 TB

**watch_sessions** (ClickHouse):
- Sessions/ngày: 1M × 20 = 20M sessions
- Size/session: ~150 bytes
- Storage/ngày: ~3 GB (raw), ~500 MB (compressed)
- Storage/năm: ~180 GB

**users** (PostgreSQL):
- Records: 1M users
- Size/user: ~500 bytes
- Total: ~500 MB

**videos** (PostgreSQL):
- Records: Giả sử 100K videos
- Size/video: ~1 KB
- Total: ~100 MB

### Optimization Tips

1. **ClickHouse Partitioning**: Partition theo tháng cho dễ quản lý và drop old data
2. **Index Optimization**: Tạo proper indexes cho các query thường dùng
3. **Caching**: Cache recommendations trong Redis (TTL 5-10 phút)
4. **Batch Processing**: Process events theo batch thay vì từng event
5. **Model Update Frequency**: Retrain model hàng ngày/tuần tùy vào data volume

## Tài liệu tham khảo

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [TensorFlow Recommenders](https://www.tensorflow.org/recommenders)
- [PeerTube API](https://docs.joinpeertube.org/api-rest-reference.html)

---

**Phiên bản**: 1.0.0  
**Ngày cập nhật**: 2026-01-20  
**Tác giả**: Development Team
