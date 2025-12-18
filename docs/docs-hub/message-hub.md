---
sidebar_position: 1
title: Message Hub
---

# TÀI LIỆU YÊU CẦU TÍCH HỢP API (HUB MESSAGE) - CẬP NHẬT DTO

| Thông tin | Nội dung |
| :--- | :--- |
| **Ngày cập nhật** | 18/12/2025 |
| **Phiên bản** | 1.1 (Cập nhật Model Response) |
| **Ghi chú** | Cấu trúc JSON trả về tuân thủ chặt chẽ theo `json tag` của Golang Struct |

---

## 1. CHI TIẾT CÁC API VÀ MẪU PHẢN HỒI (RESPONSE SAMPLES)

Quy định chung: API trả về bọc trong object chuẩn:
```json
{
    "code": 200,
    "success": true
    "message": "Success",
    "data": <Chi tiết bên dưới>
}
```

### 2.1. Lấy thông tin chi tiết người dùng
*   **Endpoint:** `GET /internal/users/{id}`
*   **Model tương ứng:** `UserDto`

**Response mẫu:**
```json
{
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "email": "nguyenvana@example.com",
    "first_name": "A",
    "last_name": "Nguyen Van",
    "code": "STU001",
    "dob": "1999-01-15T00:00:00Z",
    "phone": "0987654321",
    "wallet_address": "0x123abc...",
    "role_id": "role-uuid-001",
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-02T12:00:00Z",
    "gender": "male",
    "avatar": "https://example.com/avatar/user1.png",
    "class_slug": "software-eng-k15",// optional
    "cohort_slug": "k15-2024",// optional
    "cohort": { // optional
      "id": "cohort-uuid",
      "name": "Khóa 15"
      // ...các trường của CohortDto
    },
    "class": { // optional
      "id": "class-uuid",
      "name": "Lớp Kỹ thuật phần mềm"
      // ...các trường của ClassDto
    },
    "role": {
      "id": "role-uuid-001",
      "name": "Sinh viên",
      "slug": "student",
      "logo": "https://example.com/icons/student.png",
      "description": "Tài khoản sinh viên chính quy",
      "created_at": "2023-01-01T10:00:00Z"
    }
  }
}
```

---

### 2.2. Lấy danh sách người dùng theo danh sách ID
*   **Endpoint:** `POST /internal/users/ids`
*   **Model tương ứng:** `[]UserDto`

**Response mẫu:**
```json
{
  "data": [
    {
      "id": "user-uuid-1",
      "email": "user1@test.com",
      "first_name": "User",
      "last_name": "One",
      "role": { "name": "Admin", "slug": "admin", "logo": "..." },
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "avatar": "https://avatar.url",
      "wallet_address": ""
      // ... (Các trường khác tương tự như UserDto ở mục 2.1)
    },
    {
      "id": "user-uuid-2",
      "email": "user2@test.com",
      "first_name": "User",
      "last_name": "Two",
      "role": { "name": "User", "slug": "user", "logo": "..." },
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "avatar": "",
      "wallet_address": ""
    }
  ]
}
```

---

### 2.3. Lấy thông tin Role theo Slug
*   **Endpoint:** `GET /internal/roles/slug/{slug}`
*   **Model tương ứng:** `RoleDto`

**Response mẫu:**
```json
{
  "data": {
    "id": "role-uuid-123",
    "name": "Quản trị viên",
    "slug": "admin",
    "logo": "https://cdn.example.com/roles/admin.png",
    "description": "Quyền cao nhất trong hệ thống",
    "created_at": "2023-05-20T08:30:00Z"
  }
}
```

---

### 2.4. Lấy danh sách Role liên hệ (Contact Roles)
*   **Endpoint:** `GET /internal/roles`
*   **Model tương ứng:** `[]RoleDto`

**Response mẫu:**
```json
{
  "data": [
    {
      "id": "role-uuid-1",
      "name": "Bộ phận Hỗ trợ",
      "slug": "support",
      "logo": "https://cdn.example.com/roles/support.png",
      "description": "Giải đáp thắc mắc người dùng",
      "created_at": "2023-05-20T08:30:00Z"
    },
    {
      "id": "role-uuid-2",
      "name": "Bộ phận Kỹ thuật",
      "slug": "technical",
      "logo": "https://cdn.example.com/roles/tech.png",
      "description": null,
      "created_at": "2023-06-01T09:00:00Z"
    }
  ]
}
```

---

### 2.5. Lấy cấu hình bộ lọc người dùng (Combo Filter)
*   **Endpoint:** `GET /internal/users/combo-filter`
*   **Model tương ứng:** `[]GetUserComboFilterResponse`

**Response mẫu:**
```json
{
  "data": [
    {
      "attribute": {
        "label": "Giới tính",
        "value": "gender",
        "type": "select"
      },
      "conditions": [
        { "label": "Là", "value": "eq" },
        { "label": "Khác", "value": "ne" }
      ],
      "data": [
        { "label": "Nam", "value": "male" },
        { "label": "Nữ", "value": "female" }
      ]
    },
    {
      "attribute": {
        "label": "Tên",
        "value": "first_name",
        "type": "text"
      },
      "conditions": [
        { "label": "Chứa", "value": "ilike" }
      ],
      "data": []
    }
  ]
}
```

---

### 2.6. Tìm kiếm người dùng (Filter & Pagination)
*   **Endpoint:** `POST /internal/users/combo-filter`
*   **Model tương ứng:** `UsersPaginationResponse`

**Response mẫu:**
*Lưu ý: API trả về bao gồm thông tin phân trang (`pagination`) và danh sách người dùng (`users`).*

```json
{
  "data": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalPages": 5,
      "totalRecords": 95
    },
    "users": [
      {
        "id": "user-uuid-abc",
        "email": "student_a@school.edu",
        "first_name": "An",
        "last_name": "Nguyen",
        "code": "STD0001",
        "role_id": "role-uuid-student",
        "role": {
            "id": "role-uuid-student",
            "name": "Học viên",
            "slug": "student",
            "logo": "...",
            "description": null,
            "created_at": "..."
        },
        "created_at": "2024-02-15T10:00:00Z",
        "updated_at": "2024-02-15T10:00:00Z",
        "avatar": "https://...",
        "wallet_address": "0x...",
        "gender": "male",
        "class_slug": "class-a",
        "cohort_slug": "cohort-1"
        // ... các trường UserDto khác
      }
      // ... thêm các user khác
    ]
  }
}
```

---

### 2.7. Lấy danh sách ID để gửi thông báo
*   **Endpoint:** `POST /internal/notifications/user-ids`
*   **Model tương ứng:** `[]uuid.UUID` (Mảng chuỗi UUID)

**Response mẫu:**
```json
{
  "data": [
    "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
    "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
  ]
}
```