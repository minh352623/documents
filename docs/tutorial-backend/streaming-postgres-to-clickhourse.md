---
sidebar_position: 9
title: Streaming Postgres To Click Hourse
description: Streaming Postgres To Click Hourse
---

## Kiến trúc Streaming

Mục tiêu: chuyển dữ liệu thay đổi (CDC) từ Postgres sang ClickHouse Cloud theo thời gian gần thực, đồng thời vẫn giữ hệ thống ghi (OLTP) đơn giản và đáng tin cậy.

Thành phần:
1. **Backend Service**: Ghi dữ liệu vào Postgres (chuẩn `INSERT/UPDATE/DELETE`).
2. **Postgres**: Lưu dữ liệu và ghi thay đổi vào Write-Ahead Log (WAL).
3. **Debezium**: Đọc thay đổi từ WAL qua logical replication (CDC) và đẩy sự kiện sang Kafka.
4. **Kafka**: Buffer các sự kiện CDC dưới dạng JSON (partitioning, retention, replay).
5. **ClickHouse Bridge**: Tiêu thụ sự kiện từ Kafka và `INSERT` vào ClickHouse Cloud (chuyển đổi schema/format nếu cần).
6. **Next.js Dashboard**: Truy vấn ClickHouse Cloud để hiển thị báo cáo/analytics real-time cho người dùng.

Đặc điểm chính:
- **Decoupling**: Ghi vào Postgres tách biệt với phân tích real-time trên ClickHouse.
- **Độ tin cậy**: Kafka đảm bảo durably log, Debezium đảm bảo không bỏ lỡ thay đổi.
- **Khả năng mở rộng**: Consumer nhóm/partition để scale theo lưu lượng.
- **Tối ưu đọc**: ClickHouse tối ưu cho truy vấn phân tích (OLAP) tốc độ cao.

## Graph Flow

```
┌──────────────────┐      SQL INSERT       ┌───────────────┐
│  Backend Service │ ───────────────────▶ │   Postgres    │
└──────────────────┘                       │  (WAL/CDC)    │
                                           └──────┬────────┘
                                                  │ WAL changes
                                           ┌──────▼────────┐
                                           │   Debezium    │  (logical replication)
                                           └──────┬────────┘
                                                  │ CDC events (JSON)
                                           ┌──────▼────────┐
                                           │    Kafka      │  (buffer, replay)
                                           └──────┬────────┘
                                                  │ consume
                                           ┌──────▼──────────────┐
                                           │ ClickHouse Bridge   │  (transform + insert)
                                           └──────┬──────────────┘
                                                  │ batches
                                           ┌──────▼──────────────┐
                                           │  ClickHouse Cloud   │  (OLAP)
                                           └──────┬──────────────┘
                                                  │ queries
                                           ┌──────▼──────────────┐
                                           │  Next.js Dashboard  │  (analytics)
                                           └─────────────────────┘
```

Gợi ý triển khai `ClickHouse Bridge`:
- Dùng **Kafka Connect** với ClickHouse sink connector, hoặc dịch vụ tùy chỉnh (Node.js/Golang) tiêu thụ Kafka rồi `INSERT` vào ClickHouse qua HTTP/Native.
- Chọn format phù hợp: `JSONEachRow`, `CSV`, hoặc insert batch qua `VALUES` để tối ưu throughput.
- Thiết kế idempotency (dedupe) bằng khóa tự nhiên hoặc `ReplacingMergeTree`/`CollapsingMergeTree`.

## Khi nào nên sử dụng kiến trúc này

- **Analytics gần real-time**: cần dashboard cập nhật nhanh từ dữ liệu giao dịch.
- **Tách OLTP/OLAP (CQRS)**: viết (Command) vào Postgres; đọc (Query) phục vụ phân tích trên ClickHouse.
- **Mở rộng đọc**: truy vấn nặng không ảnh hưởng đến hệ thống ghi.
- **Lịch sử sự kiện & replay**: Kafka giữ lại sự kiện để xử lý lại khi cần.
- **Data platform**: làm nguồn đổ dữ liệu cho BI, ML pipelines.

Không nên dùng khi:
- Lưu lượng nhỏ, yêu cầu real-time cực thấp, một DB là đủ (tránh phức tạp không cần thiết).
- Không có nhu cầu phân tích tổng hợp phức tạp, latency đọc từ Postgres chấp nhận được.
- Đội ngũ chưa sẵn sàng vận hành Kafka/Debezium/ClickHouse (ưu tiên đơn giản hóa).

Khi phù hợp với **CQRS trong Microservice**:
- Viết (Command) diễn ra trong service nghiệp vụ, commit vào Postgres.
- Đọc (Query) từ view materialized trên ClickHouse để trả về báo cáo nhanh.
- Cập nhật view đọc diễn ra bất đồng bộ qua CDC (Debezium → Kafka → Bridge → ClickHouse).
- Giảm coupling: service ghi và service đọc có thể scale độc lập.

Lưu ý vận hành:
- **Schema Evolution**: dùng Avro/Schema Registry để quản lý schema CDC; mapping rõ ràng sang bảng ClickHouse.
- **Ordering & Exactly-Once**: cần đảm bảo thứ tự trong từng key/partition; thiết kế idempotent để tránh trùng lặp khi retry.
- **Backpressure & Batching**: chèn batch có kiểm soát để tối ưu throughput và latency.
- **Monitoring**: theo dõi lag Debezium/Kafka, error rate của Bridge, thời gian trễ end-to-end.
- **Data Quality**: kiểm tra tính toàn vẹn, field optional, chuyển đổi kiểu (timestamp/timezone), nullability.
- **Failure Handling**: dead-letter topic/queue cho bản ghi lỗi; cơ chế replay an toàn.

## Tóm tắt lợi ích

- Tối ưu trải nghiệm ghi và đọc: Postgres phục vụ giao dịch; ClickHouse phục vụ truy vấn phân tích.
- Tăng độ tin cậy và khả năng mở rộng nhờ Kafka làm lớp đệm.
- Dễ kiểm soát tiến trình dữ liệu và rollback/replay khi xảy ra sự cố.

## Tài nguyên tham khảo
- Debezium: https://debezium.io/
- Kafka Connect: https://kafka.apache.org/documentation/#connect
- ClickHouse Cloud: https://clickhouse.com/
- Example: https://github.com/minh352623/postgres-to-clickhouse.git
