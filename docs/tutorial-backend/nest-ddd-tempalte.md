---
sidebar_position: 2
title: NestJS DDD Template — Domain-Driven Design
---
<div align="center">

# 🧩 NestJS DDD Template — Domain-Driven Design

Template NestJS chuẩn DDD, áp dụng Best Practices, sẵn sàng scale từ Monolith sang Microservices.

[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)

</div>

---

## 📖 Giới thiệu

Xin chào team! 👋

Đây là template NestJS được thiết kế theo kiến trúc **Domain-Driven Design (DDD)**, tích hợp sẵn các **Best Practices** đã được thống nhất. Mục tiêu là mọi thành viên — dù mới join project hay đã có kinh nghiệm — đều có thể:

- 🧠 **Hiểu ngay** cấu trúc code chỉ sau 10 phút đọc tài liệu này
- 🚀 **Thêm feature mới** nhanh chóng mà không phá vỡ kiến trúc
- 🔄 **Chuyển sang Microservices** khi cần mà **không cần rewrite business logic**

> [!IMPORTANT]
> Document này là nguồn sự thật duy nhất (**single source of truth**) cho kiến trúc project. Nếu code và document mâu thuẫn, hãy báo để cập nhật.

---

## 🏗️ 1. Kiến trúc tổng quan

### DDD Layers — "Ai làm gì?"

Hãy tưởng tượng mỗi layer là một bộ phận trong công ty:

| Layer | Ví von | Trách nhiệm | Dependency Rule |
|-------|--------|-------------|-----------------|
| 🔴 **Domain** | CEO — quyết định luật chơi | Business logic, Entity, Rule | ❌ Không phụ thuộc ai |
| 🟡 **Application** | Manager — điều phối công việc | Orchestrate use cases | ➡️ Chỉ gọi Domain |
| 🟢 **Infrastructure** | IT — triển khai kỹ thuật | Database, External API | ➡️ Implement Domain interfaces |
| 🔵 **Controller** | Lễ tân — tiếp nhận yêu cầu | HTTP request/response | ➡️ Gọi Application |

### Flow xử lý request

```
HTTP Request
    ↓
[Controller] user.handler.ts       → Validate input (class-validator), parse DTOs
    ↓
[Application] user.service.impl.ts → Orchestrate use case, gọi Domain
    ↓
[Domain] user.domain.service.ts    → Business logic (hash password, validate email...)
         user.entity.ts            → Domain invariants (create, validate)
    ↓
[Infrastructure] user.repository.ts → Prisma persistence (upsert, findMany...)
    ↓
[ResponseInterceptor]              → Wrap response: { data, message }
    ↓
HTTP Response
```

### Dependency Flow (Quy tắc vàng)

```
Controller → Application → Domain ← Infrastructure
                  ↑           ↑
            (depends on)  (implements)

✅ Domain layer KHÔNG phụ thuộc vào layer nào khác
✅ Các layer khác đều phụ thuộc vào Domain
```

> [!CAUTION]
> **Không bao giờ** import từ Infrastructure vào Domain. Nếu cần, hãy định nghĩa Interface (Port) trong Domain và implement Adapter trong Infrastructure.

---

## 🌳 2. Cấu trúc thư mục — "Cái gì ở đâu?"

```text
src/
├── core/                              # ⚙️ Core Infrastructure (global services)
│   ├── prisma.service.ts              #   Database connection lifecycle
│   └── config/                        #   Configuration management
│       └── env.validation.ts          #   Environment variable validation
│
├── shared/                            # 📦 Shared Kernel (dùng chung cho tất cả modules)
│   ├── domain/
│   │   ├── base.entity.ts             #   Base Entity, AggregateRoot, DomainEvent
│   │   ├── value-object.ts            #   Base Value Object
│   │   ├── result.ts                  #   Result pattern (Either monad)
│   │   └── exceptions/
│   │       └── domain.exception.ts    #   🚨 DomainException, BusinessException,...
│   ├── application/
│   │   ├── use-case.ts                #   UseCase interface
│   │   └── mapper.ts                  #   Mapper interface
│   └── presentation/
│       ├── filters/                   #   Global exception filters
│       │   ├── domain-exception.filter.ts  # Map DomainException → HTTP status
│       │   └── all-exceptions.filter.ts    # Catch-all safety net
│       └── interceptors/
│           └── response.interceptor.ts     # 🎯 Chuẩn hóa response format
│
├── modules/
│   ├── user/                          # 👤 User Module (Provider)
│   │   ├── domain/                    #   🔴 DOMAIN LAYER
│   │   │   ├── model/entity/
│   │   │   │   └── user.entity.ts     #     Aggregate Root
│   │   │   ├── repository/
│   │   │   │   └── user.repository.ts #     Repository Interface (Port)
│   │   │   └── service/
│   │   │       ├── user.domain.service.ts      # Domain Service Interface
│   │   │       └── user.domain.service.impl.ts # Implementation (bcrypt)
│   │   │
│   │   ├── application/               #   🟡 APPLICATION LAYER
│   │   │   └── service/
│   │   │       ├── dto/user.dto.ts    #     Input/Output DTOs
│   │   │       ├── user.service.ts    #     Service Interface
│   │   │       └── user.service.impl.ts #   Implementation + Logger
│   │   │
│   │   ├── infrastructure/            #   🟢 INFRASTRUCTURE LAYER
│   │   │   └── persistence/
│   │   │       ├── model/user.model.ts    # Prisma model type
│   │   │       ├── mapper/user.mapper.ts  # Entity ↔ Model mapper
│   │   │       └── repository/user.repository.ts # Prisma implementation
│   │   │
│   │   ├── controller/                #   🔵 CONTROLLER LAYER
│   │   │   ├── dto/user.dto.ts        #     @ApiProperty + class-validator
│   │   │   └── http/user.handler.ts   #     HTTP endpoints + Swagger
│   │   │
│   │   └── user.module.ts             #   DI wiring
│   │
│   └── payment/                       # 💳 Payment Module (Consumer — demo Port & Adapter)
│       ├── domain/
│       │   ├── model/entity/
│       │   │   └── payment.entity.ts  #     Aggregate Root + PaymentStatus enum
│       │   ├── repository/
│       │   │   └── payment.repository.ts
│       │   ├── service/
│       │   │   ├── payment.domain.service.ts
│       │   │   └── payment.domain.service.impl.ts
│       │   └── ports/                 #     🌐 External Ports (Interfaces)
│       │       ├── index.ts
│       │       └── external-user.port.ts  # IExternalUserPort interface
│       │
│       ├── application/service/
│       │   ├── dto/payment.dto.ts     #     Re-export PaymentStatus from Domain
│       │   ├── payment.service.ts
│       │   └── payment.service.impl.ts #   Logger + DomainException
│       │
│       ├── infrastructure/
│       │   ├── persistence/repository/payment.repository.ts
│       │   └── external/              #     🔌 Adapters (implements Ports)
│       │       ├── index.ts
│       │       ├── user-repository.local-adapter.ts  # Monolith
│       │       └── user-repository.http-adapter.ts   # Microservice
│       │
│       ├── controller/
│       │   ├── dto/payment.dto.ts     #     @ApiProperty + class-validator
│       │   └── http/payment.handler.ts #    @ApiTags + Swagger
│       │
│       └── payment.module.ts
│
├── app.module.ts                      # Root module: ConfigModule, ThrottlerModule, Filters
└── main.ts                            # Bootstrap: helmet, CORS, Swagger, ValidationPipe
```

---

## 🔎 3. Giải thích chi tiết từng folder

### 📁 `src/core/` — Hạ tầng lõi

Chứa các service thuộc về **infrastructure mà không gắn với business module nào**. Mọi module đều có thể sử dụng.

| File | Chức năng | Lý do tồn tại |
|------|----------|---------------|
| `prisma.service.ts` | Quản lý kết nối Prisma (`onModuleInit`, `onModuleDestroy`) | Lifecycle hook tập trung, tránh mỗi module tự connect |
| `config/env.validation.ts` | Validate biến env khi app khởi động (`PORT`, `DATABASE_URL`, `NODE_ENV`) | **Fail fast** — phát hiện lỗi cấu hình ngay lúc start, không đợi runtime |

```typescript
// env.validation.ts — App sẽ crash ngay nếu thiếu DATABASE_URL
export class EnvironmentVariables {
  @IsString()
  DATABASE_URL!: string;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  PORT: number = 3000;
}
```

### 📁 `src/shared/` — Shared Kernel

"Bộ cơ sở hạ tầng chung" mà **mọi module đều kế thừa**. Gồm 3 sub-layer:

#### 📁 `shared/domain/` — Primitives của DDD

| File | Mô tả | Ví dụ sử dụng |
|------|--------|---------------|
| `base.entity.ts` | `Entity<T>`, `AggregateRoot<T>`, `DomainEvent` | `User extends AggregateRoot<string>` |
| `value-object.ts` | Base class cho Value Objects | `Email`, `Money` (nếu cần) |
| `result.ts` | Result Pattern (Either monad) — xử lý success/failure an toàn | `Result.ok(user)`, `Result.fail(error)` |
| `exceptions/domain.exception.ts` | Hệ thống Exception phân cấp | Xem bảng dưới |

**Exception Hierarchy** — chọn đúng exception cho đúng tình huống:

| Exception | HTTP Status | Khi nào dùng | Ví dụ |
|-----------|------------|-------------|-------|
| `EntityNotFoundException` | 404 | Entity không tồn tại | `new EntityNotFoundException('User', userId)` |
| `ConflictException` | 409 | Trùng lặp dữ liệu | `new ConflictException('Email already exists')` |
| `ValidationException` | 400 | Validation thất bại | `new ValidationException([{ field: 'email', message: '...' }])` |
| `BusinessRuleViolationException` | 422 | Vi phạm business rule | `new BusinessRuleViolationException('Insufficient balance')` |
| `BusinessException` | Tùy code | Lỗi business tùy chỉnh | `new BusinessException('ORDER_ALREADY_PAID', '...')` |

> [!TIP]
> **`BusinessException`** hỗ trợ code-based mapping. Thêm code mới vào `codeStatusMap` trong `DomainExceptionFilter` để map sang HTTP status tương ứng.

#### 📁 `shared/presentation/` — Filters & Interceptors

| File | Chức năng |
|------|----------|
| `filters/domain-exception.filter.ts` | Catch `DomainException` → map sang HTTP status, trả response chuẩn |
| `filters/all-exceptions.filter.ts` | Safety net — catch mọi exception còn lại, log error |
| `interceptors/response.interceptor.ts` | Wrap response thành format chuẩn `{ data, message }` |

**Response format chuẩn**:

```json
// ✅ Success
{
  "data": { "id": "...", "email": "..." },
  "message": "Success"
}

// ❌ Error (from DomainExceptionFilter)
{
  "code": "ENTITY_NOT_FOUND",
  "message": "User with identifier '123' was not found",
  "details": null,
  "path": "/users/123",
  "timestamp": "2026-02-10T10:00:00.000Z"
}
```

### 📁 `src/modules/` — Feature Modules

Mỗi module là một **Bounded Context** trong DDD, chứa đầy đủ 4 layers.

#### 📁 `modules/user/` — Ví dụ Module chuẩn

Module **provider** (cung cấp data cho module khác).

##### 🔴 `domain/` — "Luật chơi"

| Folder/File | Vai trò |
|------------|--------|
| `model/entity/user.entity.ts` | **Aggregate Root** — validate invariants, factory method `create()` + `reconstitute()` |
| `repository/user.repository.ts` | **Port** — abstract class định nghĩa contract |
| `service/user.domain.service.ts` | **Domain Service** — logic cross-entity (email unique check, password hashing) |
| `service/user.domain.service.impl.ts` | Implementation — sử dụng **bcrypt** hash password |

```typescript
// Entity dùng Factory Method — validate trước khi tạo
const userResult = User.create({ email, name, password });
if (userResult.isFailure) {
  // Validation thất bại → trả Result.fail
}

// Reconstitute từ DB — skip validation
const user = User.reconstitute({ id, email, name, password, createdAt });
```

##### 🟡 `application/` — "Điều phối"

| File | Vai trò |
|------|--------|
| `service/user.service.ts` | **Interface** — abstract class định nghĩa use cases |
| `service/user.service.impl.ts` | **Implementation** — orchestrate: validate → create → hash → save |
| `service/dto/user.dto.ts` | **Input/Output DTOs** — data transfer giữa Application và Controller |

##### 🟢 `infrastructure/` — "Kỹ thuật"

| File | Vai trò |
|------|--------|
| `persistence/model/user.model.ts` | Type definition match Prisma schema |
| `persistence/mapper/user.mapper.ts` | Convert Entity ↔ Prisma Model (`toDomain`, `toPersistence`) |
| `persistence/repository/user.repository.ts` | Prisma implementation: `upsert`, `findUnique`, `findMany` |

> [!NOTE]
> **Mapper Pattern** rất quan trọng — nó đảm bảo Domain Entity **không bao giờ** bị ô nhiễm bởi ORM. Entity dùng private constructor + factory method, Prisma dùng plain object.

##### 🔵 `controller/` — "Giao tiếp"

| File | Vai trò |
|------|--------|
| `dto/user.dto.ts` | HTTP DTOs: `@ApiProperty`, `@IsEmail`, `@MinLength` |
| `http/user.handler.ts` | REST endpoints: `@Post`, `@Get`, `@Patch`, `@Delete` + Swagger |

#### 📁 `modules/payment/` — Ví dụ Port & Adapter Pattern

Module **consumer** (cần data từ User module) — demo cách giao tiếp giữa các modules.

##### Đặc biệt: `domain/ports/` — External Interfaces

```typescript
// external-user.port.ts — Anti-Corruption Layer
export interface IExternalUserPort {
  findById(id: string): Promise<Result<ExternalUserData>>;
  exists(id: string): Promise<boolean>;
}
```

##### Đặc biệt: `infrastructure/external/` — Adapters

| File | Môi trường | Cách hoạt động |
|------|-----------|---------------|
| `user-repository.local-adapter.ts` | **Monolith** | Wrap `UserRepository` trực tiếp |
| `user-repository.http-adapter.ts` | **Microservice** | Gọi User Service qua HTTP/gRPC |

```
MONOLITH:   PaymentService → [Interface] → LocalAdapter → UserRepository (direct)
MICROSERVICE: PaymentService → [Interface] → HttpAdapter → User Service API (HTTP)
```

**Chuyển Microservice = sửa 1 dòng trong `payment.module.ts`**. Business logic KHÔNG đổi.

---

## 🛡️ 4. Best Practices đã tích hợp

### Security

| Feature | Implementation | File |
|---------|---------------|------|
| HTTP Security Headers | `helmet()` | `main.ts` |
| CORS Control | Đọc `ALLOWED_ORIGINS` từ env | `main.ts` |
| Rate Limiting | `ThrottlerModule` (100 req/60s) | `app.module.ts` |
| Input Validation | `ValidationPipe` + `class-validator` | `main.ts` |
| Password Hashing | `bcrypt` (salt rounds: 10) | `user.domain.service.impl.ts` |

### Configuration

| Feature | Implementation | File |
|---------|---------------|------|
| Env Validation | `@nestjs/config` + `class-validator` | `core/config/env.validation.ts` |
| Global Config | `ConfigModule.forRoot({ isGlobal: true })` | `app.module.ts` |
| Type-safe Access | `ConfigService.get<T>()` | `main.ts` |

### Error Handling

| Feature | Implementation |
|---------|---------------|
| Domain Errors | `DomainException` hierarchy + `Result Pattern` |
| HTTP Mapping | `DomainExceptionFilter` (class-based + code-based) |
| Safety Net | `AllExceptionsFilter` — catch mọi exception chưa handle |
| Response Format | `ResponseInterceptor` — chuẩn hóa `{ data, message }` |

### Observability

| Feature | Implementation |
|---------|---------------|
| Logging | `Logger` trong mọi Service (User + Payment) |
| API Documentation | Swagger/OpenAPI (`@ApiTags`, `@ApiOperation`, `@ApiResponse`) |

---

## 🛠️ 5. Quy trình thêm Module mới

### Step 1: Database Schema

```prisma
// prisma/schema.prisma
model Product {
  id        String   @id @default(uuid())
  name      String
  price     Decimal
  createdAt DateTime @default(now())
}
```

```bash
npm run prisma:generate
npm run prisma:migrate
```

### Step 2: Domain Layer

```text
src/modules/product/domain/
├── model/entity/product.entity.ts     # AggregateRoot, create(), reconstitute()
├── repository/product.repository.ts   # Abstract class
└── service/
    ├── product.domain.service.ts      # Interface
    └── product.domain.service.impl.ts # Implementation
```

### Step 3: Application Layer

```text
src/modules/product/application/service/
├── dto/product.dto.ts           # Input/Output DTOs
├── product.service.ts           # Abstract class
└── product.service.impl.ts      # Orchestrate + Logger
```

### Step 4: Infrastructure Layer

```text
src/modules/product/infrastructure/persistence/
├── model/product.model.ts       # Prisma type
├── mapper/product.mapper.ts     # toDomain(), toPersistence()
└── repository/product.repository.ts  # Prisma implementation
```

### Step 5: Controller Layer

```text
src/modules/product/controller/
├── dto/product.dto.ts           # @ApiProperty + class-validator
└── http/product.handler.ts      # @ApiTags + REST endpoints
```

### Step 6: Module Wiring

```typescript
// product.module.ts
@Module({
  controllers: [ProductHandler],
  providers: [
    PrismaService,
    { provide: ProductRepository, useClass: PrismaProductRepository },
    { provide: ProductDomainService, useClass: ProductDomainServiceImpl },
    { provide: ProductService, useClass: ProductServiceImpl },
  ],
  exports: [ProductService, ProductRepository],
})
export class ProductModule {}
```

### Step 7: Register in AppModule

```typescript
// app.module.ts
@Module({
  imports: [ConfigModule.forRoot(...), UserModule, PaymentModule, ProductModule],
})
export class AppModule {}
```

---

## ⚙️ 6. Chạy dự án

### Yêu cầu
- Node.js 18+
- Docker Desktop (cho PostgreSQL)

### Setup

```bash
# 1. Clone và cài dependencies
npm install

# 2. Tạo file .env (copy từ .env.example)
cp .env.example .env
# → Sửa DATABASE_URL, JWT_SECRET cho phù hợp

# 3. Start PostgreSQL
docker compose up -d

# 4. Generate Prisma Client
npm run prisma:generate

# 5. Run migrations
npm run prisma:migrate

# 6. Start dev server
npm run start:dev
```

### `.env` variables

| Variable | Required | Default | Mô tả |
|----------|----------|---------|--------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NODE_ENV` | ❌ | `development` | Environment mode |
| `PORT` | ❌ | `3000` | Server port |
| `JWT_SECRET` | ❌ | — | JWT signing secret |
| `ALLOWED_ORIGINS` | ❌ | `*` | CORS origins (comma separated) |

### Test APIs

```bash
# Create User
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"John Doe","password":"Password123"}'

# List Users
curl http://localhost:3000/users

# Get User
curl http://localhost:3000/users/{id}

# Create Payment
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{"userId":"{id}","amount":100.50,"currency":"USD","description":"Test"}'
```

### Swagger Documentation

🔗 **http://localhost:3000/api/docs**

---

## 🧪 7. Testing Strategy

| Test Type | Target | Mock | Ví dụ |
|-----------|--------|------|-------|
| **Unit Test** | Domain Entity (`create`, `update`) | Không cần | `User.create({...})` returns `Result.ok` |
| **Unit Test** | Domain Service | Repository | `UserDomainService.validateUserCreation()` |
| **Unit Test** | Application Service | Domain + Repository | `UserServiceImpl.createUser()` |
| **Integration Test** | Repository | Real DB | `PrismaUserRepository.save()` + `.findById()` |
| **E2E Test** | Controller → DB | Real system | `POST /users` → check DB |

---

## 🔄 8. Cross-Module Communication (Port & Adapter)

### Tại sao cần Pattern này?

Khi Payment cần data từ User, **không inject trực tiếp service**, mà dùng **Interface + Adapter**:

- ✅ **Loose Coupling**: Payment không biết User implementation
- ✅ **Microservice Ready**: Đổi `LocalAdapter` → `HttpAdapter` = sửa 1 dòng
- ✅ **Anti-Corruption Layer**: Chỉ expose data cần thiết (`ExternalUserData`)

### Kiến trúc Monolith → Microservice

```
MONOLITH (Hiện tại):
┌───────────────────────────────────────────────────────────────┐
│  PaymentService ──► [Interface] ──► LocalAdapter ──► UserRepo │
└───────────────────────────────────────────────────────────────┘

MICROSERVICE (Khi tách):
┌──────────────────────┐         ┌──────────────────────┐
│    Payment Service   │  HTTP   │    User Service      │
│  Service ──► [I/F]───┼────────►│──► UserRepo          │
│  ──► HttpAdapter     │         │                      │
└──────────────────────┘         └──────────────────────┘
```

### Chuyển Microservice — Chỉ sửa 1 dòng

```typescript
// payment.module.ts
{
  provide: EXTERNAL_USER_PORT,
  // useClass: UserRepositoryLocalAdapter,  // ← Monolith
  useClass: UserRepositoryHttpAdapter,      // ← Microservice ✨
}
```

**PaymentServiceImpl KHÔNG cần thay đổi code!**

---

## ✅ 9. Checklist tuân thủ DDD

- [ ] Domain không import NestJS/Prisma
- [ ] Entity sử dụng Factory Method (`create`, `reconstitute`)
- [ ] Application Service chỉ gọi Domain interfaces
- [ ] Repository trả về Domain Entity, không trả Prisma Model
- [ ] Controller mỏng, không chứa business logic
- [ ] Mapper tách biệt Entity và Persistence Model
- [ ] Enum/Constant nằm trong Domain layer (không để Application layer define)
- [ ] Service có Logger
- [ ] Error dùng DomainException hierarchy (không dùng `new Error()`)
- [ ] Controller DTOs có `@ApiProperty` cho Swagger

---

## 📦 10. File Reference nhanh

### User Module

| Layer | File | Key Feature |
|-------|------|-------------|
| Domain | `domain/model/entity/user.entity.ts` | AggregateRoot, Factory Method |
| Domain | `domain/repository/user.repository.ts` | Abstract class (Port) |
| Domain | `domain/service/user.domain.service.impl.ts` | **bcrypt** hash/verify |
| Application | `application/service/user.service.impl.ts` | Orchestrate + **Logger** |
| Infrastructure | `infrastructure/persistence/mapper/user.mapper.ts` | `toDomain` / `toPersistence` |
| Controller | `controller/http/user.handler.ts` | Swagger + ParseUUIDPipe |

### Payment Module

| Layer | File | Key Feature |
|-------|------|-------------|
| Domain | `domain/model/entity/payment.entity.ts` | **PaymentStatus enum** (source of truth) |
| Domain | `domain/ports/external-user.port.ts` | IExternalUserPort (Anti-Corruption) |
| Application | `application/service/dto/payment.dto.ts` | Re-export PaymentStatus from Domain |
| Infrastructure | `infrastructure/external/user-repository.local-adapter.ts` | Monolith adapter |
| Controller | `controller/http/payment.handler.ts` | **@ApiTags** + Swagger |

### Core & Shared

| File | Key Feature |
|------|-------------|
| `core/config/env.validation.ts` | **Fail-fast** env validation |
| `shared/domain/exceptions/domain.exception.ts` | Exception hierarchy + **BusinessException** |
| `shared/presentation/filters/domain-exception.filter.ts` | Code-based HTTP mapping |
| `shared/presentation/interceptors/response.interceptor.ts` | `{ data, message }` format |

---

## 11. Tài nguyên & Source Code

*   **Example Repository**: [https://github.com/minh352623/nestjs-template-ddd.git](https://github.com/minh352623/nestjs-template-ddd.git)

## 🙌 Kết luận

Template này mang đến:

- 🏛️ **DDD chuẩn** — Domain ở trung tâm, độc lập framework
- 🛡️ **Security sẵn sàng** — Helmet, CORS, Rate Limiting, bcrypt
- 📊 **API chuẩn** — Swagger docs, chuẩn hóa response format
- 🔄 **Microservice Ready** — Port & Adapter pattern tích hợp sẵn
- ⚡ **Fail Fast** — Validate env khi startup, DomainException hierarchy
- 📝 **Observable** — Logger trong mọi service

**Bất kỳ câu hỏi nào, hãy hỏi team lead hoặc mở Issue!** 🚀