---
sidebar_position: 1
title: Golang MVC
---
## 🌟 Hướng dẫn cho người mới (For Developers)

### Cài đặt môi trường phát triển

```bash
# Cài đặt dependencies
go mod download
go install github.com/swaggo/swag/cmd/swag@latest
```

### Các lệnh thường dùng

1. Chạy ứng dụng:
   ```bash
   # Chế độ development
   make dev
   
   # Hoặc chạy trực tiếp
   go run cmd/server/main.go
   ```

2. Tạo migration mới:
   ```bash
   cd sql/schema/{db}
   goose create add_some_column sql
   make upse
   ```

3. Generate swagger:
   ```bash
   swag init -g cmd/server/main.go
   ```

### Quy trình thêm biến môi trường mới

1. **Thêm biến vào file `.env`**:
   ```env
   # Ví dụ thêm biến cho API key
   PAYMENT_API_KEY=your_api_key_here
   ```

2. **Mapping biến trong file config theo môi trường**:
   ```yaml
   # config/development.yaml hoặc config/production.yaml
   app:
     payment:
       api_key: ${PAYMENT_API_KEY} # Sử dụng cú pháp ${} để map với biến môi trường
   ```

3. **Khai báo trong Global Config**:
   ```go
   // global/global.go
   
   // Thêm vào struct Config
   type Config struct {
       App struct {
           Payment struct {
               APIKey string `mapstructure:"api_key"`
           } `mapstructure:"payment"`
       } `mapstructure:"app"`
   }

   // Sau đó có thể sử dụng thông qua
   apiKey := global.Config.App.Payment.APIKey
   ```

💡 **Giải thích quy trình**:
- Bước 1: Khai báo biến môi trường trong `.env` để có thể dễ dàng thay đổi giá trị theo môi trường
- Bước 2: Map biến vào file config theo môi trường (development/staging/production) để tổ chức cấu hình theo layer
- Bước 3: Khai báo trong global config để có thể truy cập biến từ bất kỳ đâu trong ứng dụng thông qua global.Config

### Quy trình tạo table và model mới

1. **Tạo migration file**:
   ```bash
   cd sql/schema/postgres
   goose create create_users_table sql
   ```

2. **Định nghĩa cấu trúc table trong migration**:
   ```sql
   -- sql/schema/postgres/YYYYMMDDHHMMSS_create_users_table.sql
   -- +goose Up
   CREATE TABLE IF NOT EXISTS users (
       id SERIAL PRIMARY KEY,
       username VARCHAR(255) NOT NULL,
       email VARCHAR(255) UNIQUE NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   -- +goose Down
   DROP TABLE IF EXISTS users;
   ```

3. **Tạo và chạy migration**:
   ```bash
   # Lệnh này sẽ tạo bảng trong database
   make upse
   ```

4. **Tạo SQL queries cho table**:
   ```sql
   -- queries/users.sql
   -- name: GetUser :one
   SELECT * FROM users
   WHERE id = $1 LIMIT 1;

   -- name: ListUsers :many
   SELECT * FROM users
   ORDER BY created_at DESC;

   -- name: CreateUser :one
   INSERT INTO users (username, email)
   VALUES ($1, $2)
   RETURNING *;
   ```

5. **Generate code từ SQL queries**:
   ```bash
   # Lệnh này sẽ tạo ra các function Go tương ứng với các câu SQL
   sqlc generate
   ```

💡 **Giải thích quy trình**:
- Bước 1-3: Tạo và thực thi migration để tạo bảng trong database
- Bước 4: Định nghĩa các câu SQL query cần thiết trong file `.sql` riêng biệt
  - `:one` - query trả về một row
  - `:many` - query trả về nhiều rows
  - `:exec` - query không trả về kết quả (INSERT không có RETURNING)
- Bước 5: Chạy sqlc generate để tự động tạo code Go trong `internal/database`
  - Các function được tạo ra sẽ có type safety
  - Không cần viết code thủ công để map database rows

Sau khi generate, bạn có thể sử dụng các function đã được tạo:
```go
// Ví dụ sử dụng generated code
user, err := db.CreateUser(ctx, CreateUserParams{
    Username: "john_doe",
    Email:    "john@example.com",
})

// Tất cả parameter và return type đều được type check
users, err := db.ListUsers(ctx)
```

### Quy trình triển khai interface trong service

1. **Tạo interface**:
   ```go
   // internal/service/{name_service}/{interface}.go
   package types

   type ExampleService interface {
       DoSomething(ctx context.Context, param string) error
       GetSomething(ctx context.Context, id int64) (*Something, error)
   }
   ```

2. **Tạo folder impl và file implementation**:
   ```bash
   mkdir -p internal/service/{name_service}/impl
   touch internal/service/{name_service}/impl/service.go
   ```

3. **Đăng ký service trong initialize**:
   ```go
   // internal/initiallize/service.go  
    query := database.New(global.Pdbc)
	campaignRepository := repo.NewCampaignRepository()
	repoPlatform := repo.NewPlatformConfigRepository()
	repoFee := repo.NewFeeSettingRepository(query)
	// investment
	investment.InitCampaignService(investmentImpl.NewCampaignServiceImpl(query, campaignRepository))
	investment.InitPresaleService(investmentImpl.NewPresaleServiceImpl(query, repoPlatform))
	investment.InitInformationInvestment(investmentImpl.NewInformationInvestmentImpl(query))
	investment.InitCampaignBalanceLogService(investmentImpl.NewCampaignBalanceLogServiceImpl(query, campaignRepository))
	investment.InitInterestService(investmentImpl.NewInterestServiceImpl(query))
   ```

4. **Implement interface**:
   ```go
   // internal/service/{name_service}/impl/service.go
   package impl

   type exampleService struct {
       db     *gorm.DB
       redis  *redis.Client
       config *config.Config
   }

   func NewExampleService(db *gorm.DB, redis *redis.Client, config *config.Config) types.ExampleService {
       return &exampleService{
           db:     db,
           redis:  redis,
           config: config,
       }
   }

   // Implement các method của interface
   func (s *exampleService) DoSomething(ctx context.Context, param string) error {
       // Implementation
       return nil
   }

   func (s *exampleService) GetSomething(ctx context.Context, id int64) (*Something, error) {
       // Implementation
       return nil, nil
   }
   ```

💡 **Giải thích quy trình**:
- Bước 1: Tạo interface để định nghĩa các method cần implement
- Bước 2: Tạo cấu trúc thư mục chuẩn để implement interface
- Bước 3: Đăng ký service trong initialize để có thể inject các dependency và quản lý lifecycle của service
  - ServiceGroup giúp quản lý tất cả các service trong ứng dụng
  - InitializeService khởi tạo service với các dependency cần thiết
- Bước 4: Implement interface với đầy đủ logic nghiệp vụ
  - Struct chứa các dependency cần thiết (DB, Redis, Config...)
  - Constructor function để khởi tạo service với dependency injection
  - Implement các method theo interface đã định nghĩa

🔍 **Cách sử dụng service đã implement**:
```go
// Trong controller hoặc service khác
type ExampleController struct {
    exampleService types.ExampleService
}

func (c *ExampleController) HandleSomething(ctx *gin.Context) {
    // Sử dụng service đã được inject
    campaign, err := investment.CampaignService().GetCampaignBySlug(data)
    if err != nil {
        // Xử lý lỗi
    }
}
```

### Hướng dẫn sử dụng Swagger

1. **Cài đặt swag**:
   ```bash
   # Cài đặt swag CLI
   go install github.com/swaggo/swag/cmd/swag@latest
   ```

2. **Thêm annotations trong code**:
   ```go
   // @title           API Documentation
   // @version         1.0
   // @description     API Server for Investment Application
   // @host            localhost:8080
   // @BasePath        /api/v1
   func main() {
       // ...
   }

   // @Summary      Get Campaign
   // @Description  Get campaign by slug
   // @Tags         campaigns
   // @Accept       json
   // @Produce      json
   // @Param        slug   path      string  true  "Campaign Slug"
   // @Success      200    {object}  types.Campaign
   // @Failure      400    {object}  response.Response
   // @Failure      404    {object}  response.Response
   // @Router       /campaigns/{slug} [get]
   func (c *CampaignController) GetCampaign(ctx *gin.Context) {
       // Implementation
   }
   ```

3. **Generate Swagger docs**:
   ```bash
   # Tại thư mục root của project
   swag init -g cmd/server/main.go
   ```

4. **Truy cập Swagger UI**:
   ```
   http://localhost:8080/swagger/index.html
   ```

💡 **Các annotation thường dùng**:
- `@title`: Tên của API
- `@version`: Phiên bản API
- `@description`: Mô tả API
- `@host`: Host của API
- `@BasePath`: Đường dẫn cơ bản
- `@Summary`: Tóm tắt API endpoint
- `@Description`: Mô tả chi tiết
- `@Tags`: Nhóm API
- `@Accept`: Kiểu dữ liệu nhận vào
- `@Produce`: Kiểu dữ liệu trả về
- `@Param`: Tham số (path, query, body...)
- `@Success`: Response khi thành công
- `@Failure`: Response khi thất bại
- `@Router`: Định nghĩa route và method

🔍 **Ví dụ về struct documentation**:
```go
// Campaign represents an investment campaign
// @Description Campaign information
type Campaign struct {
    // Campaign ID
    // @example 1
    ID int64 `json:"id"`

    // Campaign name
    // @example "Tech Startup Fund"
    Name string `json:"name"`

    // Campaign slug for URL
    // @example "tech-startup-fund-2024"
    Slug string `json:"slug"`

    // Investment target amount
    // @example 1000000
    TargetAmount decimal.Decimal `json:"target_amount"`
}
```

📚 **Tài liệu tham khảo**:
- [Swagger Documentation](https://github.com/swaggo/swag#declarative-comments-format)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)

## 📚 Tài liệu tham khảo

1. **Documentation chính thức**:
   - [Go Documentation](https://golang.org/doc/)
   - [Gin Framework](https://gin-gonic.com/docs/)
   - [SQLC Documentation](https://docs.sqlc.dev/)
   - [Swagger Documentation](https://swagger.io/docs/)

2. **Tutorials và Guides**:
   - [Mark Write Shine - Go Backend Guide](https://mark-write-shine.vercel.app/)
   - [Go Project Layout](https://github.com/golang-standards/project-layout)
   - [Go Best Practices](https://golang.org/doc/effective_go)

3. **Tools và Libraries**:
   - [sqlc](https://github.com/kyleconroy/sqlc)
   - [swag](https://github.com/swaggo/swag)
   - [goose](https://github.com/pressly/goose)

4. **Community Resources**:
   - [Go Forum](https://forum.golangbridge.org/)
   - [Stack Overflow - Go](https://stackoverflow.com/questions/tagged/go)
   - [Reddit - r/golang](https://www.reddit.com/r/golang/)

💡 **Tip**: Bookmark các link trên để tham khảo nhanh khi cần.

### Xử lý lỗi thường gặp

1. **Lỗi kết nối database**:
   ```go
   // Mẫu xử lý lỗi
   result, err := repository.GetData(ctx, id)
   if err != nil {
       if errors.Is(err, sql.ErrNoRows) {
           // Xử lý trường hợp không tìm thấy dữ liệu
           return nil, ErrNotFound
       }
       // Log lỗi với context
       log.WithContext(ctx).WithError(err).Error("failed to get data from database")
       // Trả về lỗi cho client với mã lỗi phù hợp
       return nil, ErrInternalServer
   }
   ```
   - Kiểm tra thông tin trong `.env`
   - Đảm bảo PostgreSQL đang chạy
   - Kiểm tra quyền truy cập

2. **Lỗi Redis**:
   - Kiểm tra Redis đang chạy: `redis-cli ping`
   - Xem log Redis: `tail -f /usr/local/var/log/redis.log`

3. **Lỗi RabbitMQ**:
   - Kiểm tra status: `rabbitmqctl status`
   - Xem log: `tail -f /usr/local/var/log/rabbitmq/rabbit@localhost.log`

### Quy trình tạo API mới

Ví dụ: Tạo API tạo chiến dịch đầu tư mới (Create Campaign)

1. **Định nghĩa request/response types**:
   ```go
   // internal/vo/campaign.go
   package vo

   type CreateCampaignRequest struct {
       Name         string          `json:"name" binding:"required"`
       Slug         string          `json:"slug" binding:"required"`
       Description  string          `json:"description"`
       TargetAmount decimal.Decimal `json:"target_amount" binding:"required"`
   }

   type CreateCampaignResponse struct {
       ID           int64           `json:"id"`
       Name         string          `json:"name"`
       Slug         string          `json:"slug"`
       Description  string          `json:"description"`
       TargetAmount decimal.Decimal `json:"target_amount"`
       CreatedAt    time.Time       `json:"created_at"`
   }
   ```

2. **Tạo SQL query cho API**:
   ```sql
   -- queries/campaign.sql
   -- name: CreateCampaign :one
   INSERT INTO campaigns (
       name, slug, description, target_amount
   ) VALUES (
       $1, $2, $3, $4
   ) RETURNING *;
   ```

3. **Generate SQL code**:
   ```bash
   sqlc generate
   ```

4. **Tạo interface service**:
   ```go
   // internal/service/investment/campaign.go
   package investment

   type CampaignService interface {
       CreateCampaign(ctx context.Context, req *vo.CreateCampaignRequest) (*vo.CreateCampaignResponse, error)
   }
   ```

5. **Implement service**:
   ```go
   // internal/service/investment/impl/campaign.go
   package impl

   type campaignService struct {
       query    *database.Queries
       repo     repository.CampaignRepository
   }

   func NewCampaignService(query *database.Queries, repo repository.CampaignRepository) investment.CampaignService {
       return &campaignService{
           query: query,
           repo:  repo,
       }
   }

   func (s *campaignService) CreateCampaign(ctx context.Context, req *vo.CreateCampaignRequest) (*vo.CreateCampaignResponse, error) {
       // Validate business rules
       if err := s.validateCampaign(req); err != nil {
           return nil, err
       }

       // Create campaign in database
       campaign, err := s.query.CreateCampaign(ctx, database.CreateCampaignParams{
           Name:         req.Name,
           Slug:         req.Slug,
           Description:  req.Description,
           TargetAmount: req.TargetAmount,
       })
       if err != nil {
           log.WithContext(ctx).WithError(err).Error("failed to create campaign")
           return nil, ErrInternalServer
       }

       // Transform to response
       return &vo.CreateCampaignResponse{
           ID:           campaign.ID,
           Name:         campaign.Name,
           Slug:         campaign.Slug,
           Description:  campaign.Description,
           TargetAmount: campaign.TargetAmount,
           CreatedAt:    campaign.CreatedAt,
       }, nil
   }
   ```

6. **Đăng ký service**:
   ```go
   // internal/initiallize/service.go
   func InitializeServices() {
       query := database.New(global.Pdbc)
       campaignRepo := repo.NewCampaignRepository()
       
       // Đăng ký Campaign Service
       investment.InitCampaignService(
           investmentImpl.NewCampaignService(query, campaignRepo),
       )
   }
   ```

7. **Tạo controller**:
   ```go
   // internal/controller/campaign.go
   package controller

   type CampaignController struct {
       Base
   }

   // @Summary      Create Campaign
   // @Description  Create a new investment campaign
   // @Tags         campaigns
   // @Accept       json
   // @Produce      json
   // @Param        request body     vo.CreateCampaignRequest true "Campaign Info"
   // @Success      200    {object}  vo.CreateCampaignResponse
   // @Failure      400    {object}  response.Response
   // @Failure      500    {object}  response.Response
   // @Router       /campaigns [post]
   func (c *CampaignController) CreateCampaign(ctx *gin.Context) {
       var req vo.CreateCampaignRequest
       if err := ctx.ShouldBindJSON(&req); err != nil {
           response.FailWithError(ctx, err)
           return
       }

       result, err := investment.CampaignService().CreateCampaign(ctx, &req)
       if err != nil {
           response.FailWithError(ctx, err)
           return
       }

       response.OkWithData(ctx, result)
   }
   ```

8. **Đăng ký route**:
   ```go
   // internal/routers/investment/campaign.go
   package investment

   func InitCampaignRoutes(r *gin.RouterGroup) {
       campaignController := controller.CampaignController{}
       
       campaigns := r.Group("/campaigns")
       {
           campaigns.POST("", middleware.Auth(), campaignController.CreateCampaign)
       }
   }
   ```

💡 **Giải thích quy trình**:
1. Định nghĩa cấu trúc request/response để validate input và format output
2. Tạo SQL query để thao tác với database
3. Generate code từ SQL để đảm bảo type-safety
4. Định nghĩa interface service để abstract business logic
5. Implement service với đầy đủ xử lý logic và error handling
6. Đăng ký service để có thể inject dependencies
7. Tạo controller để handle HTTP request với Swagger documentation
8. Đăng ký route với middleware authentication

🔍 **Testing API**:
```bash
# Generate Swagger docs
swag init -g cmd/server/main.go

# Gọi API qua curl
curl -X POST http://localhost:8080/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tech Startup Fund",
    "slug": "tech-startup-2024",
    "description": "Investment in tech startups",
    "target_amount": "1000000"
  }'
```

### Hướng dẫn tạo và sử dụng Middleware

1. **Tạo Global Middleware**:
   ```go
   // internal/middleware/logger.go
   package middleware

   func Logger() gin.HandlerFunc {
       return func(c *gin.Context) {
           // Thời gian bắt đầu
           startTime := time.Now()

           // Xử lý request
           c.Next()

           // Sau khi xử lý xong
           endTime := time.Now()
           latency := endTime.Sub(startTime)

           // Log thông tin
           log.WithFields(log.Fields{
               "method":     c.Request.Method,
               "path":       c.Request.URL.Path,
               "status":     c.Writer.Status(),
               "latency":    latency,
               "client_ip":  c.ClientIP(),
               "user_agent": c.Request.UserAgent(),
           }).Info("incoming request")
       }
   }
   ```

2. **Tạo Authentication Middleware**:
   ```go
   // internal/middleware/auth.go
   package middleware

   func Auth() gin.HandlerFunc {
       return func(c *gin.Context) {
           // Lấy token từ header
           token := c.GetHeader("Authorization")
           if token == "" {
               response.FailWithMessage(c, "unauthorized")
               c.Abort()
               return
           }

           // Validate token
           claims, err := utils.ParseToken(token)
           if err != nil {
               response.FailWithError(c, err)
               c.Abort()
               return
           }

           // Lưu thông tin user vào context
           c.Set("user_id", claims.UserID)
           c.Set("user_role", claims.Role)

           c.Next()
       }
   }
   ```

3. **Tạo Role-based Middleware**:
   ```go
   // internal/middleware/rbac.go
   package middleware

   func RequireRole(roles ...string) gin.HandlerFunc {
       return func(c *gin.Context) {
           userRole := c.GetString("user_role")
           
           // Kiểm tra role
           hasRole := false
           for _, role := range roles {
               if userRole == role {
                   hasRole = true
                   break
               }
           }

           if !hasRole {
               response.FailWithMessage(c, "permission denied")
               c.Abort()
               return
           }

           c.Next()
       }
   }
   ```

4. **Tạo Rate Limiting Middleware**:
   ```go
   // internal/middleware/ratelimit.go
   package middleware

   func RateLimit(limit int, duration time.Duration) gin.HandlerFunc {
       limiter := rate.NewLimiter(rate.Every(duration), limit)
       
       return func(c *gin.Context) {
           if !limiter.Allow() {
               response.FailWithMessage(c, "too many requests")
               c.Abort()
               return
           }
           c.Next()
       }
   }
   ```

5. **Đăng ký Global Middleware**:
   ```go
   // internal/routers/router.go
   func InitRouter() *gin.Engine {
       r := gin.New()

       // Global middlewares
       r.Use(middleware.Logger())
       r.Use(middleware.Recovery())
       r.Use(middleware.Cors())

       return r
   }
   ```

6. **Sử dụng Middleware trong Routes**:
   ```go
   // internal/routers/investment/campaign.go
   func InitCampaignRoutes(r *gin.RouterGroup) {
       campaignController := controller.CampaignController{}
       
       // Group với multiple middlewares
       campaigns := r.Group("/campaigns", 
           middleware.Auth(),
           middleware.RateLimit(100, time.Minute),
       )
       {
           // Route với role-based middleware
           campaigns.POST("", 
               middleware.RequireRole("admin", "manager"),
               campaignController.CreateCampaign,
           )

           // Route với custom middleware
           campaigns.GET("/:id",
               middleware.Cache("campaign", time.Hour),
               campaignController.GetCampaign,
           )
       }
   }
   ```

💡 **Giải thích các loại Middleware**:

1. **Global Middleware**:
   - Áp dụng cho tất cả requests
   - Ví dụ: logging, recovery, CORS

2. **Group Middleware**:
   - Áp dụng cho một nhóm routes
   - Ví dụ: authentication, rate limiting

3. **Route Middleware**:
   - Áp dụng cho route cụ thể
   - Ví dụ: role checking, caching

🔍 **Cách truy cập dữ liệu từ Middleware**:
```go
// Trong controller
func (c *CampaignController) CreateCampaign(ctx *gin.Context) {
    // Lấy user_id đã được set trong Auth middleware
    userID := ctx.GetString("user_id")
    
    // Lấy role đã được set trong Auth middleware
    userRole := ctx.GetString("user_role")
    
    // Sử dụng trong business logic
    req.CreatedBy = userID
}
```

⚠️ **Lưu ý khi tạo Middleware**:
1. Luôn gọi `c.Next()` để tiếp tục chain hoặc `c.Abort()` để dừng
2. Xử lý lỗi và response phù hợp
3. Không lưu trữ request-scoped data trong biến global
4. Sử dụng `c.Set()` và `c.Get()` để truyền data giữa middlewares
5. Đặt middleware theo thứ tự logic (ví dụ: logger trước, auth sau)