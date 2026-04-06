# Tổng hợp kiến thức Agile & Scrum

> Tài liệu tham khảo từ: [agilemanifesto.org](https://agilemanifesto.org) và [scrumguides.org](https://scrumguides.org) (Scrum Guide 2020)

---

## PHẦN 1 — AGILE MANIFESTO

### 1.1 Bối cảnh ra đời

Năm 2001, 17 kỹ sư phần mềm hàng đầu (gồm Kent Beck, Martin Fowler, Robert C. Martin...) họp nhau tại Utah và viết ra Agile Manifesto — một tuyên ngôn về cách phát triển phần mềm hiệu quả hơn. Đây là nền tảng tư duy cho toàn bộ các framework Agile hiện đại (Scrum, Kanban, XP...).

---

### 1.2 Bốn giá trị cốt lõi (4 Values)

| Ưu tiên hơn (trái) | Hơn là (phải) |
|---|---|
| **Cá nhân và tương tác** | Quy trình và công cụ |
| **Phần mềm chạy được** | Tài liệu đầy đủ |
| **Hợp tác với khách hàng** | Đàm phán hợp đồng |
| **Phản hồi với thay đổi** | Bám theo kế hoạch |

> ⚠️ **Lưu ý quan trọng:** Agile KHÔNG nói "bên phải vô nghĩa" — mà nói "bên trái quan trọng HƠN". Tài liệu vẫn cần, kế hoạch vẫn cần — nhưng không được để chúng cản trở điều quan trọng hơn.

---

### 1.3 Mười hai nguyên tắc (12 Principles)

#### Nhóm 1 — Tập trung vào giá trị cho khách hàng

1. **Ưu tiên cao nhất** là làm hài lòng khách hàng thông qua việc giao phần mềm có giá trị sớm và liên tục.
2. **Chào đón thay đổi yêu cầu**, kể cả muộn trong dự án — Agile biến thay đổi thành lợi thế cạnh tranh cho khách hàng.
3. **Giao phần mềm thường xuyên**, từ vài tuần đến vài tháng, ưu tiên chu kỳ ngắn hơn.

#### Nhóm 2 — Cộng tác và con người

4. **Business và developer phải làm việc cùng nhau hàng ngày** trong suốt dự án.
5. **Xây dựng dự án quanh những cá nhân có động lực** — trao cho họ môi trường, hỗ trợ họ cần, và tin tưởng họ.
6. **Giao tiếp trực tiếp** là cách hiệu quả nhất để truyền đạt thông tin trong và với team.

#### Nhóm 3 — Chất lượng kỹ thuật

7. **Phần mềm chạy được** là thước đo chính của tiến độ — không phải tài liệu hay slide.
8. **Phát triển bền vững** — sponsor, developer, và user phải có thể duy trì tốc độ ổn định vô thời hạn (không sprint burnout).
9. **Liên tục chú trọng kỹ thuật xuất sắc** và thiết kế tốt để tăng tính agile.

#### Nhóm 4 — Tổ chức và cải tiến

10. **Đơn giản** — nghệ thuật tối đa hóa lượng việc không cần làm — là điều thiết yếu.
11. **Kiến trúc, yêu cầu, và thiết kế tốt nhất** xuất phát từ các team tự tổ chức (self-organizing).
12. **Định kỳ nhìn lại** để team phản chiếu cách làm việc hiệu quả hơn, rồi điều chỉnh hành vi.

---

### 1.4 Điểm cần lưu ý khi phỏng vấn về Agile

```
❌ Sai lầm phổ biến:
- "Agile nghĩa là không cần tài liệu"
- "Agile là không có kế hoạch"
- "Agile chỉ dùng cho phần mềm"

✅ Cách nói đúng:
- "Agile ưu tiên phần mềm chạy được hơn tài liệu dày"
- "Agile phản hồi thay đổi linh hoạt hơn bám cứng vào kế hoạch ban đầu"
- "Agile hiện được áp dụng rộng rãi ngoài phần mềm"
```

---

## PHẦN 2 — SCRUM (Scrum Guide 2020)

### 2.1 Scrum là gì?

> Scrum là một **framework nhẹ** giúp con người, team và tổ chức tạo ra giá trị thông qua các giải pháp thích ứng cho các vấn đề phức tạp.

**Đặc điểm quan trọng:**
- Scrum **purposefully incomplete** — chỉ định nghĩa phần cốt lõi, phần còn lại do team tự quyết.
- Scrum là **framework**, không phải methodology — không có instruction chi tiết từng bước.
- Scrum **immutable** — dùng một phần không phải là Scrum.

---

### 2.2 Ba trụ cột (3 Pillars — Empiricism)

```
Transparency (Minh bạch)
    └─► Mọi người đều thấy được công việc và tiến độ

Inspection (Kiểm tra)
    └─► Thường xuyên kiểm tra artifacts và tiến độ

Adaptation (Thích nghi)
    └─► Điều chỉnh khi phát hiện vấn đề
```

---

### 2.3 Năm giá trị (5 Values)

| Giá trị | Ý nghĩa thực tế |
|---|---|
| **Commitment** | Cam kết đạt Sprint Goal, không phải cam kết hoàn thành toàn bộ backlog |
| **Focus** | Tập trung vào Sprint Goal, tránh bị kéo ra ngoài |
| **Openness** | Cởi mở về công việc và thách thức |
| **Respect** | Tôn trọng nhau như những người có năng lực |
| **Courage** | Dám làm điều đúng, dám nêu vấn đề khó |

---

### 2.4 Scrum Team

Scrum chỉ có **1 team duy nhất**, không có "sub-team" hay phân chia. Team gồm 3 accountability:

#### Product Owner (PO)
- Chịu trách nhiệm tối đa hóa giá trị sản phẩm.
- Quản lý **Product Backlog**: tạo, sắp xếp ưu tiên, đảm bảo minh bạch.
- Là **1 người**, không phải committee.
- Cả tổ chức phải tôn trọng quyết định của PO.

#### Scrum Master (SM)
- Chịu trách nhiệm cho hiệu quả của Scrum Team.
- Là **true leader** phục vụ team và tổ chức.
- Giúp mọi người hiểu Scrum theory và practice.
- Remove blockers, facilitate events, coach team về self-management.

#### Developers
- Chịu trách nhiệm tạo ra **Increment** có thể dùng được mỗi Sprint.
- Tự tạo Sprint Backlog, tự estimate, tự adapt kế hoạch mỗi ngày.
- Tuân thủ Definition of Done.

> ⚠️ **Scrum 2020:** Không còn "Development Team" riêng biệt — tất cả gọi là **Developers** để tránh tư duy "us vs them" giữa PO và dev.

---

### 2.5 Scrum Events (5 Events)

#### Sprint
- Container cho tất cả events còn lại.
- Thời gian: **tối đa 1 tháng**, thực tế thường 2 tuần.
- Không được thay đổi Sprint Goal khi Sprint đang chạy.
- Chỉ **Product Owner** mới có quyền cancel Sprint (hiếm xảy ra).

#### Sprint Planning
- **Ai:** Toàn bộ Scrum Team.
- **Khi nào:** Đầu mỗi Sprint.
- **Thời gian:** Tối đa 8 giờ cho Sprint 1 tháng (tỷ lệ theo độ dài Sprint).
- **3 câu hỏi cần trả lời:**
  - **Why:** Sprint Goal là gì? (tại sao Sprint này có giá trị)
  - **What:** Chọn items nào từ Product Backlog?
  - **How:** Kế hoạch thực hiện như thế nào?

#### Daily Scrum
- **Ai:** Developers (SM và PO có thể tham dự nhưng không bắt buộc).
- **Khi nào:** Hàng ngày, cùng giờ, cùng địa điểm.
- **Thời gian:** Tối đa **15 phút**.
- **Mục đích:** Inspect tiến độ toward Sprint Goal, adapt Sprint Backlog nếu cần.
- **Scrum 2020:** Bỏ 3 câu hỏi cố định — team tự chọn format miễn là đạt mục đích.

> ⚠️ Daily Scrum KHÔNG phải status report cho manager — đây là buổi planning 15 phút của Developers.

#### Sprint Review
- **Ai:** Scrum Team + stakeholders.
- **Khi nào:** Cuối Sprint.
- **Thời gian:** Tối đa 4 giờ cho Sprint 1 tháng.
- **Mục đích:** Inspect Increment, thu thập feedback, adapt Product Backlog.
- Là **working session**, không phải buổi demo một chiều.

#### Sprint Retrospective
- **Ai:** Scrum Team.
- **Khi nào:** Sau Sprint Review, trước Sprint Planning tiếp theo.
- **Thời gian:** Tối đa 3 giờ cho Sprint 1 tháng.
- **Mục đích:** Nhìn lại cách làm việc (process, tools, relationships), tìm cải tiến.
- Phải có **action items cụ thể** — không chỉ nói rồi quên.

```
Framework Retrospective phổ biến (4Ls):
├── Liked    — Điều gì làm tốt?
├── Learned  — Điều gì học được?
├── Lacked   — Điều gì còn thiếu?
└── Longed For — Điều gì mong muốn cải thiện?
```

---

### 2.6 Scrum Artifacts (3 Artifacts + 3 Commitments)

| Artifact | Commitment | Mô tả |
|---|---|---|
| **Product Backlog** | Product Goal | Danh sách toàn bộ công việc cần làm cho sản phẩm, sắp xếp theo ưu tiên |
| **Sprint Backlog** | Sprint Goal | Tập con của Product Backlog được chọn cho Sprint + kế hoạch thực hiện |
| **Increment** | Definition of Done | Kết quả cụ thể, có thể dùng được sau mỗi Sprint |

#### Product Goal
- Mục tiêu dài hạn của sản phẩm.
- Mỗi Sprint phải đưa sản phẩm đến gần Product Goal hơn.
- PO chịu trách nhiệm.

#### Sprint Goal
- Mục tiêu duy nhất của Sprint — lý do tại sao Sprint này có giá trị.
- Được tạo ra trong Sprint Planning.
- Cho phép flexibility trong implementation nhưng Sprint Goal không đổi.

#### Definition of Done (DoD)
- Tiêu chí để xác định Increment đã "xong" thật sự.
- Nếu tổ chức có DoD chuẩn → team phải tuân theo tối thiểu.
- Nếu không → team tự định nghĩa.
- Mọi Scrum Team trong cùng 1 product phải dùng chung DoD.

---

### 2.7 Những điểm hay bị hiểu sai

```
❌ "Story Points = số giờ làm việc"
✅ Story Points đo độ phức tạp tương đối, không phải thời gian tuyệt đối

❌ "Daily Standup phải trả lời 3 câu hỏi cố định"
✅ Scrum 2020 đã bỏ 3 câu hỏi — format linh hoạt, miễn đạt mục đích 15 phút

❌ "Sprint Review = buổi demo cho sếp xem"
✅ Sprint Review là working session hai chiều với stakeholders để adapt Product Backlog

❌ "Scrum Master = Project Manager"
✅ Scrum Master là servant leader, không assign task, không manage timeline

❌ "Velocity là KPI để đánh giá team"
✅ Velocity chỉ là công cụ planning nội bộ, không so sánh giữa các team

❌ "Dùng một phần Scrum là được"
✅ Scrum immutable — dùng thiếu một phần thì kết quả không phải Scrum
```

---

## PHẦN 3 — ÁP DỤNG THỰC TẾ (cho Backend Engineer)

### 3.1 Vai trò thường gặp của Dev trong Scrum

```
Sprint Planning:
├── Estimate Story Points cho từng task
├── Break Story thành technical tasks
└── Cam kết Sprint Goal (không phải toàn bộ backlog)

Daily Scrum:
├── Cập nhật tiến độ toward Sprint Goal
├── Raise blocker sớm
└── Tự điều chỉnh kế hoạch ngày

Sprint Review:
├── Demo tính năng đã hoàn thành
└── Nhận feedback từ stakeholder

Retrospective:
├── Propose cải tiến technical process
└── Thực hiện action items từ retro trước
```

### 3.2 Jira Workflow thực tế

```
Product Backlog
    └─► Epic (tính năng lớn, vài Sprint)
            └─► Story (giá trị cho user, 1 Sprint)
                    └─► Task (công việc kỹ thuật, vài giờ đến vài ngày)
                            └─► Sub-task (nếu cần chia nhỏ hơn)

Status flow thường dùng:
To Do → In Progress → In Review → Done

Definition of Done ví dụ:
✅ Code reviewed và approved
✅ Unit test coverage ≥ 80%
✅ Integration test pass
✅ Deployed lên staging
✅ AC (Acceptance Criteria) verified
```

### 3.3 Câu trả lời STAR cho phỏng vấn

**Câu hỏi:** *"Bạn đã làm việc theo Agile/Scrum như thế nào?"*

```
Situation: Ở TekNix, team 5 người chạy Sprint 2 tuần.

Task: Tôi là Backend Lead, cần đảm bảo
      technical tasks được estimate đúng
      và team deliver đúng Sprint Goal.

Action:
- Facilitate Sprint Planning, break Epic thành Story
- Chạy Daily Standup 15 phút mỗi sáng
- Raise blocker sớm với PO khi scope không rõ
- Đề xuất scope reduction khi Sprint bị risk trễ

Result: Deliver đúng hạn, stakeholder hài lòng,
        team velocity ổn định qua các Sprint.
```

---

## PHẦN 4 — TÓM TẮT NHANH (Quick Reference)

### Agile Manifesto — 4 Values
1. Individuals & interactions > Processes & tools
2. Working software > Comprehensive documentation
3. Customer collaboration > Contract negotiation
4. Responding to change > Following a plan

### Scrum — 3 Pillars
Transparency → Inspection → Adaptation

### Scrum — 5 Events
Sprint → Sprint Planning → Daily Scrum → Sprint Review → Sprint Retrospective

### Scrum — 3 Artifacts + Commitments
Product Backlog (Product Goal) → Sprint Backlog (Sprint Goal) → Increment (Definition of Done)

### Scrum — 3 Accountabilities
Product Owner | Scrum Master | Developers

---

> 📚 **Nguồn tham khảo:**
> - [Agile Manifesto](https://agilemanifesto.org)
> - [12 Agile Principles](https://agilemanifesto.org/principles.html)
> - [Scrum Guide 2020](https://scrumguides.org/scrum-guide.html)
