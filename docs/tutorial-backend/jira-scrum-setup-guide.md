# Hướng dẫn tạo Scrum Project trên Jira (từng bước)

> Mục tiêu: Tự chạy Sprint 2 tuần để cải thiện backend skills Q2/2026

---

## BƯỚC 1 — Tạo tài khoản & Project

### 1.1 Tạo tài khoản
1. Truy cập [atlassian.com](https://atlassian.com)
2. Chọn **"Try Jira for free"**
3. Đăng ký bằng email (free plan đủ dùng cho cá nhân)

### 1.2 Tạo Scrum Project
1. Vào Jira Dashboard → Click **"Create project"**
2. Chọn template: **"Scrum"** (không phải Kanban)
3. Chọn project type: **"Team-managed"** (đơn giản hơn, phù hợp cá nhân)
4. Đặt tên: `Backend Skills Q2/2026`
5. Project key: `BSQ2` (tự động hoặc tự nhập)
6. Click **"Create project"**

---

## BƯỚC 2 — Tạo Epic

Epic là tính năng/mục tiêu lớn, bao gồm nhiều Story bên trong.

### Cách tạo Epic
1. Vào **Backlog** (menu bên trái)
2. Click **"Epic"** ở panel bên trái → **"Create epic"**
3. Điền thông tin:

```
Epic Name : Cải thiện backend skills Q2/2026
Summary   : Nâng cao kỹ năng để chuẩn bị apply Senior Golang Engineer
Start Date: 07/04/2026
Due Date  : 30/06/2026
Color     : Chọn màu để dễ phân biệt (ví dụ: xanh dương)
```

4. Click **"Save"**

---

## BƯỚC 3 — Tạo Stories

Story = một mục tiêu nhỏ có giá trị cụ thể. Mỗi Story nằm trong một Epic.

### Cách tạo Story
1. Trong **Backlog** → Click **"+ Create issue"**
2. Chọn type: **"Story"**

---

### Story 1: Học Kubernetes cơ bản

```
Summary     : Học Kubernetes cơ bản
Epic Link   : Cải thiện backend skills Q2/2026
Description :
  Là một Backend Engineer làm việc với Docker/microservices,
  tôi muốn hiểu Kubernetes để có thể deploy và manage
  containerized services ở môi trường production.

Acceptance Criteria:
  - [ ] Hiểu được Pod, Deployment, Service, Ingress
  - [ ] Tự deploy được 1 Golang service lên local K8s (minikube)
  - [ ] Biết cách scale, rolling update, rollback
  - [ ] Viết được 1 bài blog/note tóm tắt

Story Points: 8
Priority    : High
```

**Tasks bên trong Story 1:**

| Task | Story Points | Ghi chú |
|---|---|---|
| Cài minikube + kubectl | 1 | Setup môi trường local |
| Đọc/xem K8s concepts (Pod, Deployment, Service) | 2 | Dùng docs.kubernetes.io hoặc YouTube |
| Deploy Golang app đơn giản lên minikube | 2 | Dùng project có sẵn |
| Thực hành scale + rolling update | 2 | kubectl scale, kubectl rollout |
| Viết note tổng hợp | 1 | Lưu vào blog hoặc Confluence |

---

### Story 2: Làm quen PostHog integration

```
Summary     : Tích hợp PostHog vào Golang backend
Epic Link   : Cải thiện backend skills Q2/2026
Description :
  Là một Backend Engineer, tôi muốn biết cách tích hợp
  PostHog vào hệ thống Golang để track business events
  và hiểu user behavior trong production.

Acceptance Criteria:
  - [ ] Setup PostHog Cloud account (free tier)
  - [ ] Tích hợp posthog-go SDK vào 1 project Golang có sẵn
  - [ ] Track được ít nhất 3 business events
  - [ ] Xem được event trên PostHog dashboard

Story Points: 5
Priority    : Medium
```

**Tasks bên trong Story 2:**

| Task | Story Points | Ghi chú |
|---|---|---|
| Tạo PostHog account + lấy API key | 1 | app.posthog.com |
| Cài posthog-go SDK vào project | 1 | go get github.com/posthog/posthog-go |
| Implement track 3 events (login, action, error) | 2 | Theo hướng dẫn đã có |
| Verify events trên dashboard | 1 | Kiểm tra Live Events tab |

---

### Story 3: Ôn luyện interview Grab

```
Summary     : Chuẩn bị interview Senior Golang Engineer tại Grab
Epic Link   : Cải thiện backend skills Q2/2026
Description :
  Là một ứng viên đang apply vị trí Backend Engineer tại Grab,
  tôi muốn chuẩn bị kỹ cả technical lẫn behavioral để
  tự tin trong buổi phỏng vấn.

Acceptance Criteria:
  - [ ] Nắm vững ít nhất 10 câu hỏi Golang technical
  - [ ] Chuẩn bị 5 câu STAR cho behavioral questions
  - [ ] Mock interview ít nhất 1 lần
  - [ ] Review lại CV, align với JD Grab

Story Points: 5
Priority    : High
```

**Tasks bên trong Story 3:**

| Task | Story Points | Ghi chú |
|---|---|---|
| Ôn Golang concurrency (goroutine, channel, mutex) | 2 | Điểm hay hỏi nhất |
| Ôn distributed systems (CAP, consistency, caching) | 1 | Hệ thống Grab scale lớn |
| Viết 5 câu STAR (leadership, conflict, failure...) | 1 | Dựa trên kinh nghiệm TekNix |
| Mock interview tự record hoặc với bạn | 1 | Luyện nói tiếng Anh |

---

## BƯỚC 4 — Thiết lập Story Points

Jira dùng **Fibonacci scale**: 1, 2, 3, 5, 8, 13, 21

```
1 SP  = Vài giờ, rõ ràng, không có rủi ro
2 SP  = Nửa ngày, khá rõ
3 SP  = 1 ngày, có một chút phức tạp
5 SP  = 2-3 ngày, độ phức tạp trung bình
8 SP  = 4-5 ngày, phức tạp, có rủi ro
13 SP = Cần break nhỏ hơn
```

> ⚠️ Story Points đo **độ phức tạp**, không phải số giờ tuyệt đối.

### Tổng Story Points plan

| Story | SP | Sprint dự kiến |
|---|---|---|
| Học Kubernetes cơ bản | 8 | Sprint 1 + 2 |
| PostHog integration | 5 | Sprint 1 |
| Ôn luyện interview Grab | 5 | Sprint 1 + 2 |
| **Tổng** | **18 SP** | **2 Sprints** |

---

## BƯỚC 5 — Tạo và chạy Sprint

### 5.1 Tạo Sprint 1
1. Trong **Backlog** → Click **"Create Sprint"** (góc phải trên)
2. Hover vào Sprint → Click **"..."** → **"Edit Sprint"**
3. Điền:

```
Sprint Name : Sprint 1 — Foundation
Sprint Goal : Hoàn thành PostHog integration và bắt đầu K8s basics
Start Date  : 07/04/2026
End Date    : 20/04/2026
```

### 5.2 Kéo Issues vào Sprint
1. Trong Backlog, drag các Stories/Tasks vào **Sprint 1**
2. Sprint 1 nên chứa:
   - Story: PostHog integration (5 SP) — toàn bộ
   - Story: Ôn luyện interview (2-3 tasks đầu tiên)
   - Story: K8s cơ bản (3 tasks đầu tiên)

### 5.3 Bắt đầu Sprint
1. Click **"Start Sprint"**
2. Jira sẽ hỏi confirm duration → Click **"Start"**
3. Board sẽ chuyển sang **Active Sprint view**

---

## BƯỚC 6 — Làm việc trong Sprint

### 6.1 Board view hàng ngày
Vào **Board** (menu trái) để thấy 3 cột:

```
To Do | In Progress | Done
```

Mỗi ngày:
- Kéo task từ **To Do** → **In Progress** khi bắt đầu
- Kéo sang **Done** khi hoàn thành
- **Chỉ để 1-2 task In Progress cùng lúc** (tránh multitasking)

### 6.2 Daily Standup cá nhân (5 phút mỗi sáng)
Viết vào Jira comment hoặc notepad:

```
📅 Ngày: [date]

✅ Hôm qua làm gì?
→ ...

🔨 Hôm nay làm gì?
→ ...

🚧 Có blocker nào không?
→ ...
```

### 6.3 Cập nhật Log Work (tùy chọn)
Vào từng task → **"Log work"** → điền số giờ thực tế.
Giúp so sánh estimate vs actual sau này.

---

## BƯỚC 7 — Sprint Review (cuối Sprint)

Sau 2 tuần, trước khi close Sprint:

### Checklist Sprint Review cá nhân

```
□ Mở từng Story đã hoàn thành
□ Kiểm tra Acceptance Criteria — đã đạt chưa?
□ Demo cho bản thân (hoặc bạn bè): chạy K8s, show PostHog dashboard
□ Note lại những gì đã học được thực sự
□ Những task chưa xong → move sang Sprint 2
```

### Xem Burndown Chart
1. **Reports** (menu trái) → **Burndown Chart**
2. Nếu đường thực tế (actual) nằm trên đường lý tưởng → đang chậm
3. Nếu nằm dưới → đang nhanh hơn plan

---

## BƯỚC 8 — Sprint Retrospective (sau Review)

Tự trả lời 4 câu hỏi, viết vào Confluence hoặc Notion:

```
🟢 Liked — Điều gì làm tốt trong Sprint này?
   Ví dụ: "Hoàn thành PostHog integration đúng hạn"

📚 Learned — Điều gì học được ngoài kế hoạch?
   Ví dụ: "Hiểu thêm về PostHog autocapture vs manual tracking"

🔴 Lacked — Điều gì còn thiếu hoặc làm chưa tốt?
   Ví dụ: "K8s tasks bị underestimate, thực tế phức tạp hơn"

💡 Longed For — Điều gì muốn cải thiện Sprint sau?
   Ví dụ: "Break K8s tasks nhỏ hơn, thêm buffer time"
```

### Action Items cho Sprint 2
- [ ] Estimate K8s tasks lại (thêm 1-2 SP)
- [ ] Đặt thời gian cố định mỗi ngày (ví dụ: 8-9pm)
- [ ] Thêm task: viết note sau mỗi buổi học

---

## BƯỚC 9 — Tạo Sprint 2

Lặp lại Bước 5 với:

```
Sprint Name : Sprint 2 — Interview Ready
Sprint Goal : Hoàn thành K8s deployment + sẵn sàng cho Grab interview
Start Date  : 21/04/2026
End Date    : 04/05/2026
```

Kéo vào Sprint 2:
- Các tasks chưa xong từ Sprint 1
- Phần còn lại của K8s Story
- Phần còn lại của Interview Story
- Task mới nếu có (ví dụ: viết blog tổng hợp)

---

## PHẦN PHỤ — Tips sử dụng Jira hiệu quả

### Shortcuts hữu ích
```
C          → Tạo issue nhanh
/          → Tìm kiếm
G + B      → Đến Backlog
G + A      → Đến Active Sprint (Board)
```

### Labels nên dùng
```
learning   → Task liên quan đến học tập
interview  → Task liên quan đến phỏng vấn
blocker    → Task bị block cần giải quyết ngay
```

### Confluence — Viết TDD/Note song song
Mỗi Story nên có 1 page Confluence tương ứng:
```
[BSQ2] Kubernetes Learning Notes
[BSQ2] PostHog Integration Design
[BSQ2] Grab Interview Prep
```

---

## TỔNG KẾT — Lịch Sprint Q2/2026

| Sprint | Thời gian | Goal | SP |
|---|---|---|---|
| Sprint 1 | 07/04 – 20/04 | PostHog xong + K8s bắt đầu | 9 |
| Sprint 2 | 21/04 – 04/05 | K8s xong + Interview ready | 9 |
| Sprint 3 | 05/05 – 18/05 | Buffer + Deep dive weak areas | TBD |

> 🎯 **Mục tiêu cuối Q2:** Có thể tự tin nói "Tôi đã làm việc theo Agile/Scrum" với kinh nghiệm thực tế tự vận hành, không chỉ lý thuyết.
