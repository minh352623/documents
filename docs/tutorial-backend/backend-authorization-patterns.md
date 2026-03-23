# Phân quyền trong Backend System
> Từ đơn giản đến nâng cao — cách implement và khi nào dùng gì

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Level 1 — Simple Role Check](#2-level-1--simple-role-check)
3. [Level 2 — RBAC (Role-Based Access Control)](#3-level-2--rbac-role-based-access-control)
4. [Level 3 — ABAC (Attribute-Based Access Control)](#4-level-3--abac-attribute-based-access-control)
5. [Level 4 — ReBAC (Relationship-Based Access Control)](#5-level-4--rebac-relationship-based-access-control)
6. [Level 5 — PBAC (Policy-Based Access Control)](#6-level-5--pbac-policy-based-access-control)
7. [JWT & Token-based Auth](#7-jwt--token-based-auth)
8. [API Key & Scope](#8-api-key--scope)
9. [Row-Level Security](#9-row-level-security)
10. [Multi-tenant Authorization](#10-multi-tenant-authorization)
11. [So sánh & Khi nào dùng gì](#11-so-sánh--khi-nào-dùng-gì)

---

## 1. Tổng quan

Phân quyền (Authorization) trả lời câu hỏi: **"User này có được làm việc X không?"**

Khác với Authentication (Xác thực) trả lời: *"User này là ai?"*

```
Authentication → "Tôi là Minh, có token hợp lệ"
Authorization  → "Minh có được xóa hợp đồng này không?"
```

### Các chiều phân quyền

```
Who    → Ai đang làm (user, role, group)
What   → Làm gì (read, write, delete, approve)
Where  → Tài nguyên nào (contract #123, order #456)
When   → Lúc nào (giờ hành chính, ngày thường)
How    → Điều kiện gì (chỉ data của mình, chỉ branch mình)
```

---

## 2. Level 1 — Simple Role Check

### Khái niệm

Đơn giản nhất. User có một role, mỗi endpoint check role đó.

### Khi nào dùng

- Hệ thống nhỏ, ít loại user
- Startup giai đoạn đầu
- Internal tool, admin panel đơn giản
- Team nhỏ, ít thời gian

### Implement — Golang

```go
// Chỉ lưu role đơn giản trong JWT
type Claims struct {
    UserID string `json:"user_id"`
    Role   string `json:"role"` // "admin", "user", "manager"
    jwt.RegisteredClaims
}

// Middleware check role
func RequireRole(roles ...string) gin.HandlerFunc {
    return func(c *gin.Context) {
        claims := c.MustGet("claims").(*Claims)

        for _, role := range roles {
            if claims.Role == role {
                c.Next()
                return
            }
        }

        c.AbortWithStatusJSON(403, gin.H{
            "error": "insufficient permissions",
        })
    }
}

// Sử dụng trong router
router.DELETE("/contracts/:id",
    AuthMiddleware(),
    RequireRole("admin", "manager"),
    handler.DeleteContract,
)

router.GET("/contracts",
    AuthMiddleware(),
    RequireRole("admin", "manager", "user"),
    handler.ListContracts,
)
```

### Implement — NestJS

```typescript
// Decorator
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// Guard
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
        if (!requiredRoles) return true;

        const { user } = context.switchToHttp().getRequest();
        return requiredRoles.includes(user.role);
    }
}

// Controller
@Delete(':id')
@Roles('admin', 'manager')
@UseGuards(JwtAuthGuard, RolesGuard)
deleteContract(@Param('id') id: string) {
    return this.contractService.delete(id);
}
```

### Database Schema

```sql
CREATE TABLE users (
    id      UUID PRIMARY KEY,
    email   VARCHAR(255) UNIQUE NOT NULL,
    role    VARCHAR(50) NOT NULL DEFAULT 'user',
    -- role: 'admin' | 'manager' | 'user' | 'viewer'
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Hạn chế

```
❌ User chỉ có 1 role → không linh hoạt
❌ Thêm role mới phải sửa code
❌ Không control được resource cụ thể
   (admin xóa được TẤT CẢ contract, không phân biệt)
```

---

## 3. Level 2 — RBAC (Role-Based Access Control)

### Khái niệm

User có nhiều Role. Mỗi Role có nhiều Permission. Permission gắn với Action cụ thể.

```
User → [Role] → [Permission] → Action

User Minh → Role: [Manager, Reviewer]
Manager   → Permission: [contract:read, contract:write, contract:approve]
Reviewer  → Permission: [contract:read, report:read]
```

### Khi nào dùng

- Hệ thống trung bình, 5-20 loại role
- HR system, ERP, CRM
- Khi role cần được cấu hình runtime (không hardcode)
- Insurance, Banking internal system

### Database Schema

```sql
-- Users
CREATE TABLE users (
    id    UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL
);

-- Roles
CREATE TABLE roles (
    id          UUID PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL, -- 'admin', 'manager', 'viewer'
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- Permissions
CREATE TABLE permissions (
    id       UUID PRIMARY KEY,
    resource VARCHAR(100) NOT NULL, -- 'contract', 'report', 'user'
    action   VARCHAR(100) NOT NULL, -- 'read', 'write', 'delete', 'approve'
    UNIQUE(resource, action)
);

-- Role ↔ Permission (many-to-many)
CREATE TABLE role_permissions (
    role_id       UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY(role_id, permission_id)
);

-- User ↔ Role (many-to-many)
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, role_id)
);
```

### Seed data

```sql
-- Permissions
INSERT INTO permissions (id, resource, action) VALUES
    (gen_random_uuid(), 'contract', 'read'),
    (gen_random_uuid(), 'contract', 'write'),
    (gen_random_uuid(), 'contract', 'delete'),
    (gen_random_uuid(), 'contract', 'approve'),
    (gen_random_uuid(), 'report',   'read'),
    (gen_random_uuid(), 'user',     'manage');

-- Roles
INSERT INTO roles (id, name) VALUES
    ('role-admin',   'admin'),
    ('role-manager', 'manager'),
    ('role-viewer',  'viewer');

-- Admin có tất cả permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-admin', id FROM permissions;

-- Manager có một số permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-manager', id FROM permissions
WHERE (resource, action) IN (
    ('contract', 'read'),
    ('contract', 'write'),
    ('contract', 'approve'),
    ('report', 'read')
);
```

### Implement — Golang

```go
// Permission service
type RBACService struct {
    db    *sql.DB
    cache *redis.Client
}

// Check user có permission không
func (s *RBACService) HasPermission(
    ctx context.Context,
    userID, resource, action string,
) (bool, error) {
    // Cache key: rbac:{userID}:{resource}:{action}
    cacheKey := fmt.Sprintf("rbac:%s:%s:%s", userID, resource, action)

    // Check cache trước
    cached, err := s.cache.Get(ctx, cacheKey).Result()
    if err == nil {
        return cached == "1", nil
    }

    // Query DB
    var count int
    err = s.db.QueryRowContext(ctx, `
        SELECT COUNT(*)
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1
          AND p.resource = $2
          AND p.action   = $3
    `, userID, resource, action).Scan(&count)

    if err != nil {
        return false, err
    }

    allowed := count > 0

    // Cache 5 phút
    val := "0"
    if allowed { val = "1" }
    s.cache.SetEX(ctx, cacheKey, val, 5*time.Minute)

    return allowed, nil
}

// Middleware
func (s *RBACService) RequirePermission(resource, action string) gin.HandlerFunc {
    return func(c *gin.Context) {
        userID := c.MustGet("userID").(string)

        allowed, err := s.HasPermission(c.Request.Context(), userID, resource, action)
        if err != nil || !allowed {
            c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
            return
        }

        c.Next()
    }
}

// Router
router.GET("/contracts",
    auth.RequirePermission("contract", "read"),
    handler.ListContracts,
)

router.DELETE("/contracts/:id",
    auth.RequirePermission("contract", "delete"),
    handler.DeleteContract,
)

router.POST("/contracts/:id/approve",
    auth.RequirePermission("contract", "approve"),
    handler.ApproveContract,
)
```

### Load permissions vào JWT để giảm DB query

```go
// Khi login, load tất cả permissions của user vào token
type Claims struct {
    UserID      string   `json:"user_id"`
    Permissions []string `json:"perms"` // ["contract:read", "contract:write"]
    jwt.RegisteredClaims
}

func (s *AuthService) Login(userID string) (string, error) {
    perms, _ := s.rbac.GetUserPermissions(userID)

    claims := Claims{
        UserID:      userID,
        Permissions: perms, // ["contract:read", "report:read"]
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)),
        },
    }

    return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// Check từ token — không cần DB
func HasPermission(claims *Claims, resource, action string) bool {
    target := resource + ":" + action
    for _, p := range claims.Permissions {
        if p == target || p == resource+":*" || p == "*:*" {
            return true
        }
    }
    return false
}
```

---

## 4. Level 3 — ABAC (Attribute-Based Access Control)

### Khái niệm

Quyết định dựa trên **thuộc tính** của user, resource, và môi trường — không chỉ role.

```
Decision = f(UserAttributes, ResourceAttributes, EnvironmentAttributes)

Ví dụ:
"Manager chỉ được approve contract của branch mình,
 trong giờ hành chính, với giá trị <= 500 triệu"

UserAttr:     { role: "manager", branch: "HCM", level: 3 }
ResourceAttr: { type: "contract", branch: "HCM", value: 200_000_000 }
EnvAttr:      { time: "09:30", day: "weekday" }
→ ALLOW ✅

ResourceAttr: { type: "contract", branch: "HN", value: 200_000_000 }
→ DENY ❌ (khác branch)
```

### Khi nào dùng

- Insurance, Banking, Healthcare
- Multi-branch organization
- Cần control theo nhiều chiều (region, time, value, department)
- Compliance requirements phức tạp

### Implement — Golang

```go
// Định nghĩa attributes
type UserAttributes struct {
    ID         string
    Role       string
    Branch     string
    Department string
    Level      int
}

type ResourceAttributes struct {
    Type   string
    ID     string
    Branch string
    Value  float64
    OwnerID string
    Status string
}

type EnvironmentAttributes struct {
    Time    time.Time
    IP      string
    Country string
}

// Policy engine
type Policy struct {
    ID         string
    Name       string
    Resource   string
    Action     string
    Conditions []Condition
    Effect     string // "allow" | "deny"
}

type Condition struct {
    Attribute string // "user.branch", "resource.value", "env.time"
    Operator  string // "eq", "lt", "gt", "in", "contains"
    Value     interface{}
}

// Evaluate policy
type ABACEngine struct {
    policies []Policy
}

func (e *ABACEngine) IsAllowed(
    user     UserAttributes,
    resource ResourceAttributes,
    env      EnvironmentAttributes,
    action   string,
) bool {
    for _, policy := range e.policies {
        if policy.Resource != resource.Type || policy.Action != action {
            continue
        }

        if e.evaluateConditions(policy.Conditions, user, resource, env) {
            return policy.Effect == "allow"
        }
    }
    return false // deny by default
}

func (e *ABACEngine) evaluateConditions(
    conditions []Condition,
    user UserAttributes,
    resource ResourceAttributes,
    env EnvironmentAttributes,
) bool {
    for _, cond := range conditions {
        val := e.resolveAttribute(cond.Attribute, user, resource, env)
        if !e.evaluate(val, cond.Operator, cond.Value) {
            return false
        }
    }
    return true
}

func (e *ABACEngine) resolveAttribute(
    attr string,
    user UserAttributes,
    resource ResourceAttributes,
    env EnvironmentAttributes,
) interface{} {
    switch attr {
    case "user.branch":     return user.Branch
    case "user.role":       return user.Role
    case "user.level":      return user.Level
    case "resource.branch": return resource.Branch
    case "resource.value":  return resource.Value
    case "resource.owner":  return resource.OwnerID
    case "env.hour":        return env.Time.Hour()
    case "env.weekday":     return env.Time.Weekday() != time.Saturday &&
                                   env.Time.Weekday() != time.Sunday
    }
    return nil
}

// Policy config (có thể load từ DB hoặc YAML)
var contractPolicies = []Policy{
    {
        Name:     "Manager approve contract same branch",
        Resource: "contract",
        Action:   "approve",
        Effect:   "allow",
        Conditions: []Condition{
            {Attribute: "user.role",       Operator: "eq",  Value: "manager"},
            {Attribute: "user.branch",     Operator: "eq",  Value: "resource.branch"},
            {Attribute: "resource.value",  Operator: "lt",  Value: 500_000_000.0},
            {Attribute: "env.weekday",     Operator: "eq",  Value: true},
            {Attribute: "env.hour",        Operator: "gte", Value: 8},
            {Attribute: "env.hour",        Operator: "lte", Value: 17},
        },
    },
    {
        Name:     "Admin approve any contract",
        Resource: "contract",
        Action:   "approve",
        Effect:   "allow",
        Conditions: []Condition{
            {Attribute: "user.role", Operator: "eq", Value: "admin"},
        },
    },
}
```

### Dùng thư viện Casbin (phổ biến nhất)

```go
// Casbin là policy engine mạnh nhất cho Go
// go get github.com/casbin/casbin/v2

import "github.com/casbin/casbin/v2"

// Policy model (model.conf)
/*
[request_definition]
r = sub, obj, act, attrs

[policy_definition]
p = sub_rule, obj_rule, act, eft

[matchers]
m = eval(p.sub_rule) && eval(p.obj_rule) && r.act == p.act && p.eft == "allow"
*/

// Policy (policy.csv)
/*
p, r.sub.role == "manager" && r.sub.branch == r.obj.branch, r.obj.type == "contract" && r.obj.value < 500000000, approve, allow
p, r.sub.role == "admin", true, approve, allow
*/

func checkABAC(userID, resource, action string) bool {
    e, _ := casbin.NewEnforcer("model.conf", "policy.csv")

    user := getUserAttributes(userID)
    res  := getResourceAttributes(resource)
    env  := getEnvironmentAttributes()

    ok, _ := e.Enforce(user, res, action, env)
    return ok
}
```

---

## 5. Level 4 — ReBAC (Relationship-Based Access Control)

### Khái niệm

Quyền dựa trên **mối quan hệ** giữa user và resource. Google dùng model này cho Google Drive, Docs.

```
User A là owner của Document X
  → A có thể read, write, share Document X

User B được A share Document X với role "editor"
  → B có thể read, write Document X
  → B KHÔNG thể share Document X

User C được B share Document X với role "viewer"
  → C chỉ có thể read Document X
```

### Khi nào dùng

- Google Drive-like system (document sharing)
- Project management (Jira, Trello)
- Social network (follow, friend)
- Hệ thống cần hierarchical permission

### Implement cơ bản

```go
// Relationship tuple: (user, relation, object)
// "user:alice" "owner"  "doc:123"
// "user:bob"   "editor" "doc:123"
// "user:carol" "viewer" "doc:123"

type Relationship struct {
    UserID   string // "user:alice"
    Relation string // "owner", "editor", "viewer"
    ObjectID string // "doc:123", "folder:456"
}

// Schema quan hệ
/*
document:
  - owner: có thể read, write, delete, share
  - editor: có thể read, write
  - viewer: chỉ có thể read
  - commenter: có thể read, comment

folder:
  - owner: có thể tạo/xóa document trong folder
  - editor: có thể tạo document trong folder
  - viewer: xem được danh sách document
*/

type ReBAC struct {
    db *sql.DB
}

// Check permission thông qua relationship
func (r *ReBAC) CheckPermission(
    ctx context.Context,
    userID, objectID, permission string,
) (bool, error) {
    // Lấy tất cả relations của user với object
    rows, err := r.db.QueryContext(ctx, `
        SELECT relation FROM relationships
        WHERE user_id = $1 AND object_id = $2
    `, userID, objectID)
    if err != nil { return false, err }
    defer rows.Close()

    for rows.Next() {
        var relation string
        rows.Scan(&relation)

        // Map relation → permissions
        if r.relationAllows(relation, permission) {
            return true, nil
        }
    }

    // Check inherited permission từ parent (folder)
    return r.checkInherited(ctx, userID, objectID, permission)
}

func (r *ReBAC) relationAllows(relation, permission string) bool {
    permissionMap := map[string][]string{
        "owner":     {"read", "write", "delete", "share", "comment"},
        "editor":    {"read", "write", "comment"},
        "commenter": {"read", "comment"},
        "viewer":    {"read"},
    }
    for _, p := range permissionMap[relation] {
        if p == permission { return true }
    }
    return false
}

// Share document
func (r *ReBAC) ShareDocument(
    ctx context.Context,
    ownerID, targetUserID, objectID, relation string,
) error {
    // Chỉ owner mới được share
    canShare, _ := r.CheckPermission(ctx, ownerID, objectID, "share")
    if !canShare {
        return errors.New("only owner can share")
    }

    _, err := r.db.ExecContext(ctx, `
        INSERT INTO relationships (user_id, relation, object_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
    `, targetUserID, relation, objectID)
    return err
}
```

### Dùng OpenFGA / Zanzibar (production-grade)

```go
// OpenFGA là open-source implementation của Google Zanzibar
// go get github.com/openfga/go-sdk

import fgaSdk "github.com/openfga/go-sdk"

// Authorization model
const authModel = `
model
  schema 1.1

type user

type document
  relations
    define owner: [user]
    define editor: [user] or owner
    define viewer: [user] or editor
    define can_read:   viewer
    define can_write:  editor
    define can_delete: owner
    define can_share:  owner
`

// Check permission
func canAccess(userID, docID, permission string) bool {
    client := fgaSdk.NewSdkClient(...)

    resp, _ := client.Check(context.Background()).Body(
        fgaSdk.CheckRequest{
            TupleKey: fgaSdk.CheckRequestTupleKey{
                User:     "user:" + userID,
                Relation: permission,
                Object:   "document:" + docID,
            },
        },
    ).Execute()

    return resp.GetAllowed()
}
```

---

## 6. Level 5 — PBAC (Policy-Based Access Control)

### Khái niệm

Policy được viết dưới dạng ngôn ngữ declarative (OPA, Cedar) — tách biệt hoàn toàn business logic khỏi authorization logic.

```
Policy (Rego/OPA):
  "Allow nếu:
    - User là employee của company
    - Contract thuộc company của user
    - Giá trị contract <= budget limit của user
    - Không phải ngày lễ"
```

### Khi nào dùng

- Enterprise, Fintech, Banking phức tạp
- Compliance requirements (SOC2, ISO 27001)
- Policy cần audit trail đầy đủ
- Nhiều team cùng define policy

### Implement với OPA (Open Policy Agent)

```go
// policy.rego
/*
package authz

import future.keywords.if
import future.keywords.in

default allow = false

# Manager approve contract trong branch của mình
allow if {
    input.action == "approve"
    input.resource.type == "contract"
    input.user.role == "manager"
    input.user.branch == input.resource.branch
    input.resource.value <= input.user.budget_limit
    is_business_hour(input.env.time)
    not is_holiday(input.env.date)
}

# Admin approve bất kỳ
allow if {
    input.action == "approve"
    input.user.role == "admin"
}

# Helper functions
is_business_hour(t) if {
    t.hour >= 8
    t.hour < 17
}

is_holiday(date) if {
    date in {"2024-01-01", "2024-04-30", "2024-05-01"}
}
*/

// Golang call OPA
import "github.com/open-policy-agent/opa/rego"

func (s *AuthService) CheckPolicy(
    ctx context.Context,
    input map[string]interface{},
) (bool, error) {
    query, err := rego.New(
        rego.Query("data.authz.allow"),
        rego.Load([]string{"./policies/"}, nil),
    ).PrepareForEval(ctx)

    if err != nil { return false, err }

    results, err := query.Eval(ctx, rego.EvalInput(input))
    if err != nil { return false, err }

    if len(results) == 0 { return false, nil }
    return results[0].Expressions[0].Value.(bool), nil
}

// Sử dụng
func (h *ContractHandler) Approve(c *gin.Context) {
    user     := getUserFromContext(c)
    contract := getContractFromDB(c.Param("id"))

    input := map[string]interface{}{
        "action": "approve",
        "user": map[string]interface{}{
            "id":           user.ID,
            "role":         user.Role,
            "branch":       user.Branch,
            "budget_limit": user.BudgetLimit,
        },
        "resource": map[string]interface{}{
            "type":   "contract",
            "id":     contract.ID,
            "branch": contract.Branch,
            "value":  contract.Value,
        },
        "env": map[string]interface{}{
            "time": time.Now(),
            "date": time.Now().Format("2006-01-02"),
            "ip":   c.ClientIP(),
        },
    }

    allowed, err := h.authService.CheckPolicy(c.Request.Context(), input)
    if err != nil || !allowed {
        c.JSON(403, gin.H{"error": "policy denied"})
        return
    }

    h.contractService.Approve(c.Request.Context(), contract.ID)
    c.JSON(200, gin.H{"message": "approved"})
}
```

---

## 7. JWT & Token-based Auth

### Access Token + Refresh Token

```go
// Token pair
type TokenPair struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token"`
    ExpiresIn    int    `json:"expires_in"` // seconds
}

// Claims trong Access Token
type AccessClaims struct {
    UserID      string   `json:"uid"`
    Permissions []string `json:"perms"`
    SessionID   string   `json:"sid"`
    jwt.RegisteredClaims
}

func (s *AuthService) GenerateTokenPair(user User) (*TokenPair, error) {
    sessionID := uuid.New().String()

    // Access token: sống ngắn (15 phút)
    accessClaims := AccessClaims{
        UserID:      user.ID,
        Permissions: s.getUserPermissions(user.ID),
        SessionID:   sessionID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    accessToken, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).
        SignedString([]byte(s.accessSecret))

    // Refresh token: sống lâu (7 ngày), lưu DB
    refreshToken := generateSecureToken(32)
    s.db.ExecContext(context.Background(), `
        INSERT INTO refresh_tokens (token, user_id, session_id, expires_at)
        VALUES ($1, $2, $3, $4)
    `, hash(refreshToken), user.ID, sessionID, time.Now().Add(7*24*time.Hour))

    return &TokenPair{
        AccessToken:  accessToken,
        RefreshToken: refreshToken,
        ExpiresIn:    900, // 15 phút
    }, nil
}

// Refresh access token
func (s *AuthService) RefreshToken(refreshToken string) (*TokenPair, error) {
    // Verify refresh token từ DB
    var userID, sessionID string
    err := s.db.QueryRowContext(context.Background(), `
        SELECT user_id, session_id
        FROM refresh_tokens
        WHERE token = $1
          AND expires_at > NOW()
          AND revoked = false
    `, hash(refreshToken)).Scan(&userID, &sessionID)

    if err != nil {
        return nil, errors.New("invalid or expired refresh token")
    }

    // Rotate refresh token (invalidate cũ, tạo mới)
    s.db.ExecContext(context.Background(), `
        UPDATE refresh_tokens SET revoked = true WHERE token = $1
    `, hash(refreshToken))

    user := s.getUserByID(userID)
    return s.GenerateTokenPair(user)
}
```

### Token Revocation (Blacklist)

```go
// Khi user logout hoặc đổi password → revoke tất cả session
func (s *AuthService) RevokeAllSessions(userID string) error {
    // Lưu vào Redis blacklist
    // Key: blacklist:{sessionID}, Value: 1, TTL: bằng token expiry
    sessions, _ := s.db.QueryContext(context.Background(), `
        SELECT session_id FROM refresh_tokens
        WHERE user_id = $1 AND revoked = false
    `, userID)

    for sessions.Next() {
        var sessionID string
        sessions.Scan(&sessionID)
        s.redis.SetEX(context.Background(),
            "blacklist:"+sessionID, "1", 15*time.Minute)
    }

    // Revoke trong DB
    s.db.ExecContext(context.Background(), `
        UPDATE refresh_tokens SET revoked = true WHERE user_id = $1
    `, userID)

    return nil
}

// Middleware check blacklist
func (s *AuthService) ValidateToken(tokenStr string) (*AccessClaims, error) {
    claims := &AccessClaims{}
    _, err := jwt.ParseWithClaims(tokenStr, claims, s.keyFunc)
    if err != nil { return nil, err }

    // Check blacklist
    exists, _ := s.redis.Exists(context.Background(),
        "blacklist:"+claims.SessionID).Result()
    if exists > 0 {
        return nil, errors.New("token revoked")
    }

    return claims, nil
}
```

---

## 8. API Key & Scope

### Khi nào dùng

- B2B integration (đối tác gọi API)
- Machine-to-machine communication
- Third-party developer access

### Implement

```go
// API Key với scopes
type APIKey struct {
    ID        string
    Key       string   // hash lưu DB, raw trả về lúc tạo
    ClientID  string
    Scopes    []string // ["contracts:read", "reports:write"]
    RateLimit int      // requests per minute
    ExpiresAt *time.Time
    CreatedAt time.Time
}

// Tạo API Key
func (s *APIKeyService) Create(clientID string, scopes []string) (string, error) {
    // Generate raw key
    rawKey := "sk_live_" + generateSecureToken(32)

    _, err := s.db.ExecContext(context.Background(), `
        INSERT INTO api_keys (id, key_hash, client_id, scopes, rate_limit)
        VALUES ($1, $2, $3, $4, $5)
    `, uuid.New(), hash(rawKey), clientID,
        pq.Array(scopes), 100)

    if err != nil { return "", err }

    // Chỉ trả raw key 1 lần duy nhất — không thể recover
    return rawKey, nil
}

// Validate API Key
func (s *APIKeyService) Validate(ctx context.Context,
    rawKey, requiredScope string,
) (*APIKey, error) {
    var apiKey APIKey
    err := s.db.QueryRowContext(ctx, `
        SELECT id, client_id, scopes, rate_limit, expires_at
        FROM api_keys
        WHERE key_hash = $1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND revoked = false
    `, hash(rawKey)).Scan(
        &apiKey.ID, &apiKey.ClientID,
        pq.Array(&apiKey.Scopes),
        &apiKey.RateLimit, &apiKey.ExpiresAt,
    )

    if err != nil { return nil, errors.New("invalid API key") }

    // Check scope
    if !contains(apiKey.Scopes, requiredScope) {
        return nil, fmt.Errorf("missing scope: %s", requiredScope)
    }

    // Rate limiting
    if !s.checkRateLimit(ctx, apiKey.ID, apiKey.RateLimit) {
        return nil, errors.New("rate limit exceeded")
    }

    return &apiKey, nil
}

// Rate limiting với Redis sliding window
func (s *APIKeyService) checkRateLimit(ctx context.Context,
    keyID string, limit int,
) bool {
    now := time.Now()
    windowKey := fmt.Sprintf("ratelimit:%s:%d", keyID, now.Unix()/60)

    count, _ := s.redis.Incr(ctx, windowKey).Result()
    s.redis.Expire(ctx, windowKey, 2*time.Minute)

    return int(count) <= limit
}
```

---

## 9. Row-Level Security

### Khái niệm

User chỉ xem được data của mình — không phải toàn bộ table.

```
User A query: SELECT * FROM contracts → chỉ thấy contracts của mình
User B query: SELECT * FROM contracts → chỉ thấy contracts của mình
Admin query:  SELECT * FROM contracts → thấy tất cả
```

### Implement trong PostgreSQL

```sql
-- Enable RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Policy: user chỉ đọc được contract của mình
CREATE POLICY user_contracts ON contracts
    FOR SELECT
    USING (owner_id = current_setting('app.current_user_id')::uuid);

-- Policy: manager đọc được contract của branch mình
CREATE POLICY manager_contracts ON contracts
    FOR SELECT
    USING (
        branch_id = current_setting('app.current_branch_id')::uuid
        OR
        current_setting('app.current_role') = 'admin'
    );

-- Set context trước khi query
SET app.current_user_id = 'user-uuid-here';
SET app.current_role = 'manager';
SET app.current_branch_id = 'branch-uuid-here';
```

```go
// Golang — set RLS context mỗi request
func (r *ContractRepo) FindAll(ctx context.Context, userID, role, branchID string) ([]*Contract, error) {
    tx, _ := r.db.BeginTx(ctx, nil)
    defer tx.Rollback()

    // Set session variables cho RLS
    tx.ExecContext(ctx, "SET LOCAL app.current_user_id = $1", userID)
    tx.ExecContext(ctx, "SET LOCAL app.current_role = $1", role)
    tx.ExecContext(ctx, "SET LOCAL app.current_branch_id = $1", branchID)

    // Query — RLS tự filter
    rows, err := tx.QueryContext(ctx, "SELECT * FROM contracts ORDER BY created_at DESC")
    if err != nil { return nil, err }

    // ... scan rows
    tx.Commit()
    return contracts, nil
}
```

### Implement trong Application Layer

```go
// Thêm filter vào mọi query dựa theo role
type ContractRepo struct{ db *sql.DB }

func (r *ContractRepo) FindAll(ctx context.Context, viewer Viewer) ([]*Contract, error) {
    query := squirrel.Select("*").From("contracts")

    switch viewer.Role {
    case "admin":
        // Không filter — xem tất cả
    case "manager":
        // Chỉ xem branch của mình
        query = query.Where("branch_id = ?", viewer.BranchID)
    default:
        // User thường — chỉ xem của mình
        query = query.Where("owner_id = ?", viewer.UserID)
    }

    sql, args, _ := query.ToSql()
    rows, err := r.db.QueryContext(ctx, sql, args...)
    // ...
}
```

---

## 10. Multi-tenant Authorization

### Khái niệm

Nhiều tổ chức (tenant) dùng chung hệ thống, data hoàn toàn isolated.

```
Tenant A: VinGroup → users của VinGroup chỉ thấy data của VinGroup
Tenant B: Masan    → users của Masan chỉ thấy data của Masan
```

### Implement

```go
// Mọi table đều có tenant_id
/*
CREATE TABLE contracts (
    id        UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    ...
);

CREATE INDEX idx_contracts_tenant ON contracts(tenant_id);
*/

// Claims trong JWT có tenant_id
type Claims struct {
    UserID   string `json:"uid"`
    TenantID string `json:"tid"` // ← quan trọng
    Role     string `json:"role"`
    jwt.RegisteredClaims
}

// Middleware inject tenant vào context
func TenantMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        claims := c.MustGet("claims").(*Claims)
        c.Set("tenantID", claims.TenantID)
        c.Next()
    }
}

// Repository LUÔN filter theo tenant_id
func (r *ContractRepo) FindByID(ctx context.Context, id string) (*Contract, error) {
    tenantID := ctx.Value("tenantID").(string)

    var contract Contract
    err := r.db.QueryRowContext(ctx, `
        SELECT * FROM contracts
        WHERE id = $1 AND tenant_id = $2  -- ← luôn có tenant filter
    `, id, tenantID).Scan(&contract)

    if err == sql.ErrNoRows {
        return nil, errors.New("not found") // Không tiết lộ record tồn tại ở tenant khác
    }
    return &contract, err
}
```

---

## 11. So sánh & Khi nào dùng gì

| Pattern | Độ phức tạp | Linh hoạt | Hiệu năng | Use case điển hình |
|---|---|---|---|---|
| Simple Role | ⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | Startup, internal tool |
| RBAC | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ERP, CRM, HR system |
| ABAC | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Banking, Insurance, Healthcare |
| ReBAC | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Google Drive-like, social |
| PBAC/OPA | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | Enterprise, Compliance |

### Decision tree

```
Hệ thống nhỏ, < 5 loại role?
  → Simple Role Check

Cần nhiều role, cấu hình runtime?
  → RBAC

Cần control theo branch, region, value, time?
  → ABAC (+ Casbin)

Cần document/resource sharing như Google Drive?
  → ReBAC (+ OpenFGA)

Cần compliance audit, policy as code?
  → PBAC/OPA

Hệ thống phức tạp thực tế?
  → Kết hợp: RBAC làm base + ABAC cho edge case
```

### Kết hợp thực tế (Production Pattern)

```
Hầu hết hệ thống thực tế dùng kết hợp:

1. RBAC   → check role cơ bản (nhanh, từ JWT)
2. ABAC   → check điều kiện phức tạp (branch, value)
3. RLS    → filter data ở DB level (safety net)
4. Tenant → isolate data giữa các tổ chức

Flow:
Request → JWT validate → RBAC check (từ cache)
       → ABAC evaluate (nếu cần điều kiện phức tạp)
       → DB query với RLS filter
       → Response
```

---

*Document này cover từ pattern đơn giản nhất đến enterprise-grade.*
*Trong thực tế: bắt đầu với RBAC, thêm ABAC khi cần, không over-engineer từ đầu.*
