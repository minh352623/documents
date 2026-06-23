# VPS Deployment Guide

Hướng dẫn này gom quy trình triển khai backend QLTB lên một VPS Linux bằng Docker, Traefik, PostgreSQL và domain riêng.

Phạm vi:

- chuẩn bị VPS
- cấu hình DNS domain
- cài Docker
- chạy Traefik reverse proxy + SSL
- chạy backend + PostgreSQL
- migrate schema bằng Prisma
- backup và restore database
- kết nối DB từ máy local qua SSH tunnel

Nguyên tắc vận hành:

- production chỉ dùng `npx prisma migrate deploy`
- không public PostgreSQL ra internet
- mount persistent volume cho `uploads/` và Postgres data
- secret chỉ lưu trong `.env` hoặc secret manager, không commit git

## 1. Kiến trúc khuyến nghị

Thành phần:

- `Traefik`: reverse proxy, TLS, route domain vào app
- `app`: container backend NestJS, listen nội bộ cổng `3000`
- `postgres`: container PostgreSQL 16, chỉ mở trong host nội bộ

Luồng truy cập:

1. user gọi `https://api.example.com`
2. DNS trỏ về IP public của VPS
3. Traefik nhận request ở cổng `80/443`
4. Traefik route vào service `app`
5. `app` kết nối `postgres` qua Docker network nội bộ

## 2. Điều kiện đầu vào

Cần có:

- một VPS Ubuntu 22.04 hoặc 24.04
- quyền SSH vào VPS bằng `root` hoặc user có `sudo`
- domain có quyền chỉnh DNS
- source backend đã push lên GitHub hoặc đã copy lên VPS

Biến môi trường bắt buộc của source này:

- `NODE_ENV`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

Bắt buộc thêm trong production:

- `ALLOWED_ORIGINS`
- `AUTH_REFRESH_REPLAY_ENCRYPTION_KEY`

## 3. Chuẩn bị DNS

Ví dụ muốn dùng domain API là `api.example.com`.

Tại nơi quản lý DNS:

- tạo record `A`
- host/name: `api`
- value: `IP public của VPS`

Kiểm tra sau khi lưu:

```bash
nslookup api.example.com
```

Phải trả về đúng IP VPS.

## 4. Chuẩn bị VPS

Đăng nhập SSH:

```bash
ssh root@<VPS_IP>
```

Cập nhật hệ thống:

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg ufw git
```

Mở firewall:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## 5. Cài Docker và Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
newgrp docker
```

Kiểm tra:

```bash
docker --version
docker compose version
```

## 6. Clone source

Khuyến nghị dùng SSH key để clone GitHub private repo.

Tạo SSH key trên VPS:

```bash
ssh-keygen -t ed25519 -C "vps-deploy"
cat ~/.ssh/id_ed25519.pub
```

Add public key vào GitHub, rồi test:

```bash
ssh -T git@github.com
```

Clone repo:

```bash
mkdir -p ~/apps/qltb
cd ~/apps/qltb
git clone git@github.com:minh352623/quanly-thiet-bi.git be
cd be
```

## 7. Tạo Docker network cho Traefik

```bash
docker network create traefik-public
```

## 8. Triển khai Traefik

Tạo thư mục riêng:

```bash
mkdir -p ~/apps/traefik
cd ~/apps/traefik
touch acme.json
chmod 600 acme.json
```

Tạo file `docker-compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.7.5
    container_name: traefik
    restart: unless-stopped
    command:
      - --api.dashboard=true
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.tlschallenge=true
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./acme.json:/letsencrypt/acme.json
    networks:
      - traefik-public

networks:
  traefik-public:
    external: true
```

Chạy Traefik:

```bash
docker compose up -d
docker logs traefik --tail 50
```

Lưu ý:

- không set `DOCKER_API_VERSION`
- nếu log có lỗi `client version 1.24 is too old`, hãy xóa container cũ và recreate bằng image mới

## 9. Tạo file `.env` production cho backend

Tại `~/apps/qltb/be/.env`:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://qltb_user:CHANGE_ME_DB_PASSWORD@postgres:5432/qltb?schema=public

JWT_ACCESS_SECRET=CHANGE_ME_ACCESS_SECRET
JWT_REFRESH_SECRET=CHANGE_ME_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
AUTH_REFRESH_REPLAY_ENCRYPTION_KEY=CHANGE_ME_BASE64_32_BYTES

FRONTEND_URL=https://app.example.com
SCAN_BASE_URL=https://app.example.com
```

Tạo key replay:

```bash
openssl rand -base64 32
```

## 10. Tạo file `docker-compose.prod.yml`

Tại `~/apps/qltb/be/docker-compose.prod.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: qltb_postgres
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: qltb_user
      POSTGRES_PASSWORD: CHANGE_ME_DB_PASSWORD
      POSTGRES_DB: qltb
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U qltb_user -d qltb"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - internal

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: qltb_app
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./uploads:/app/uploads
    networks:
      - internal
      - traefik-public
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik-public
      - traefik.http.routers.qltb.rule=Host(`api.example.com`)
      - traefik.http.routers.qltb.entrypoints=websecure
      - traefik.http.routers.qltb.tls=true
      - traefik.http.routers.qltb.tls.certresolver=le
      - traefik.http.services.qltb.loadbalancer.server.port=3000

volumes:
  pgdata:

networks:
  internal:
  traefik-public:
    external: true
```

Giải thích:

- Postgres chỉ bind `127.0.0.1:5432` để local tunnel hoặc tool SSH tunnel có thể dùng
- app không expose cổng public, chỉ đi qua Traefik
- `uploads` được mount ra host để không mất file

## 11. Khởi động backend stack

```bash
cd ~/apps/qltb/be
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

## 12. Chạy Prisma migrate

Áp dụng schema production:

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

Kiểm tra trạng thái:

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma migrate status
```

Chạy seed chỉ khi thật sự cần:

```bash
docker compose -f docker-compose.prod.yml exec app npm run seed
```

## 13. Kiểm tra sau deploy

Kiểm tra local trong VPS:

```bash
curl -I http://127.0.0.1:3000/api/docs
curl -I http://127.0.0.1/api/docs
curl -I https://api.example.com/api/docs
```

Kiểm tra Traefik:

```bash
docker logs traefik --tail 100
```

Kiểm tra Postgres:

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U qltb_user -d qltb
```

## 14. Kết nối database từ local

Khuyến nghị dùng SSH tunnel, không mở public `5432`.

Từ máy local:

```bash
ssh -L 5433:127.0.0.1:5432 root@<VPS_IP>
```

Sau đó kết nối bằng DBeaver/TablePlus:

- host: `127.0.0.1`
- port: `5433`
- database: `qltb`
- username: `qltb_user`
- password: mật khẩu DB

## 15. Backup database

### 15.1 Backup trước khi deploy hoặc trước khi restore

```bash
docker exec qltb_postgres pg_dump -U qltb_user -d qltb > /root/qltb-$(date +%F-%H%M%S).sql
```

### 15.2 Auto backup production-safe với WAL mỗi 15 phút RPO

Khuyến nghị cho production:

- không chạy `pg_dump` mỗi 15 phút
- chạy `full dump` mỗi ngày
- bật `WAL archiving` với `archive_timeout=900` để RPO khoảng 15 phút
- dùng `systemd timer` để điều phối script backup trên host VPS

Thêm WAL archive mount và config vào service `postgres` trong `docker-compose.prod.yml`:

```yaml
postgres:
  image: postgres:16-alpine
  container_name: qltb_postgres
  restart: unless-stopped
  ports:
    - "127.0.0.1:5432:5432"
  environment:
    POSTGRES_USER: qltb_user
    POSTGRES_PASSWORD: CHANGE_ME_DB_PASSWORD
    POSTGRES_DB: qltb
  command:
    - postgres
    - -c
    - wal_level=replica
    - -c
    - archive_mode=on
    - -c
    - archive_timeout=900
    - -c
    - archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f
  volumes:
    - pgdata:/var/lib/postgresql/data
    - /var/backups/qltb/wal:/wal-archive
```

Trên VPS:

```bash
mkdir -p /var/backups/qltb/postgres /var/backups/qltb/wal
chmod 700 /var/backups/qltb
chmod 700 /var/backups/qltb/postgres /var/backups/qltb/wal
```

Copy script từ repo lên host:

```bash
install -m 755 scripts/backup/qltb-backup-postgres.sh /usr/local/bin/qltb-backup-postgres.sh
install -m 755 scripts/backup/qltb-prune-wal.sh /usr/local/bin/qltb-prune-wal.sh
install -m 755 scripts/backup/qltb-backup-healthcheck.sh /usr/local/bin/qltb-backup-healthcheck.sh
```

Copy `systemd` units:

```bash
install -m 644 scripts/backup/systemd/qltb-backup-postgres.service /etc/systemd/system/qltb-backup-postgres.service
install -m 644 scripts/backup/systemd/qltb-backup-postgres.timer /etc/systemd/system/qltb-backup-postgres.timer
install -m 644 scripts/backup/systemd/qltb-prune-wal.service /etc/systemd/system/qltb-prune-wal.service
install -m 644 scripts/backup/systemd/qltb-prune-wal.timer /etc/systemd/system/qltb-prune-wal.timer
install -m 644 scripts/backup/systemd/qltb-backup-healthcheck.service /etc/systemd/system/qltb-backup-healthcheck.service
install -m 644 scripts/backup/systemd/qltb-backup-healthcheck.timer /etc/systemd/system/qltb-backup-healthcheck.timer
systemctl daemon-reload
systemctl enable --now qltb-backup-postgres.timer qltb-prune-wal.timer qltb-backup-healthcheck.timer
```

Kiểm tra:

```bash
systemctl list-timers | grep qltb
journalctl -u qltb-backup-postgres.service -n 50 --no-pager
ls -lh /var/backups/qltb/postgres /var/backups/qltb/wal
```

### 15.2B Phương án tự động hơn với pgBackRest + Docker Compose

Nếu không muốn vận hành `script + systemd + WAL copy` trên host, có thể chuyển sang `pgBackRest`.

Ưu điểm:

- quản lý full backup + WAL archive bằng tool chuyên dụng cho PostgreSQL
- PITR rõ ràng hơn
- retention nằm trong config backup tool
- ít shell script host hơn

Đổi lại:

- cần custom image PostgreSQL có cài `pgbackrest`
- compose phức tạp hơn phương án host script

Artifacts mẫu trong repo:

- `docker-compose.backup.yml`
- `scripts/backup/pgbackrest/postgres-pgbackrest.Dockerfile`
- `scripts/backup/pgbackrest/pgbackrest-sidecar.Dockerfile`
- `scripts/backup/pgbackrest/pgbackrest-sidecar-entrypoint.sh`
- `scripts/backup/pgbackrest/pgbackrest.conf.example`
- `scripts/backup/pgbackrest/docker-compose.pgbackrest.yml.example`

Mô hình:

- `postgres` dùng image custom có cài `pgbackrest`
- `archive_command=pgbackrest --stanza=qltb archive-push %p`
- repository backup local ở `/var/backups/qltb/pgbackrest`
- `pgbackrest` sidecar chịu trách nhiệm `stanza-create` và chạy full backup định kỳ

Chuẩn bị thư mục trên VPS:

```bash
mkdir -p /var/backups/qltb/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
chmod 700 /var/backups/qltb /var/backups/qltb/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
```

Tích hợp:

1. Giữ nguyên `docker-compose.prod.yml`
2. Dùng thêm overlay `docker-compose.backup.yml`
3. Build lại stack:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.backup.yml up -d --build postgres pgbackrest
```

4. Khởi tạo stanza:

```bash
docker exec qltb_pgbackrest pgbackrest --stanza=qltb stanza-create
```

5. Chạy full backup đầu tiên:

```bash
docker exec qltb_pgbackrest pgbackrest --stanza=qltb --type=full backup
```

6. Kiểm tra:

```bash
docker exec qltb_pgbackrest pgbackrest --stanza=qltb info
docker compose -f docker-compose.prod.yml -f docker-compose.backup.yml logs --tail 100 pgbackrest
```

Lưu ý:

- overlay hiện dùng named volumes `pgbackrest_repo`, `pgbackrest_log`, `pgbackrest_spool` để ghép nhanh với compose hiện tại; nếu muốn offsite hoặc bind mount host path cụ thể thì thay volume mapping trên VPS
- `docker-compose.pgbackrest.yml.example` vẫn giữ vai trò reference đầy đủ; file `docker-compose.backup.yml` là overlay thực dụng để ghép trực tiếp với stack hiện tại

### 15.3 Backup kèm uploads

```bash
tar -czf /root/uploads-$(date +%F-%H%M%S).tar.gz -C /root/apps/qltb/be uploads
```

### 15.4 Kiểm tra file backup

```bash
ls -lh /root/*.sql /root/*.tar.gz
```

## 16. Restore database

Repo hiện có file backup SQL ở root:

- `backup.sql`

Đường dẫn sau khi clone lên VPS:

- `~/apps/qltb/be/backup.sql`

Đây là SQL dump thường, nên restore bằng `psql`.

### 16.1 Restore ghi đè toàn bộ DB

Backup DB hiện tại trước:

```bash
docker exec qltb_postgres pg_dump -U qltb_user -d qltb > /root/qltb-before-restore.sql
```

Drop và tạo lại schema:

```bash
docker exec -i qltb_postgres psql -U qltb_user -d qltb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

Restore:

```bash
cat /root/apps/qltb/be/backup.sql | docker exec -i qltb_postgres psql -U qltb_user -d qltb
```

### 16.2 Kiểm tra sau restore

```bash
docker exec -i qltb_postgres psql -U qltb_user -d qltb -c "\dt"
docker compose -f docker-compose.prod.yml exec app npx prisma migrate status
docker compose -f docker-compose.prod.yml restart app
docker compose -f docker-compose.prod.yml logs --tail 100 app
```

### 16.3 Restore theo mốc thời gian bằng full dump + WAL

Tình huống:

- restore full dump gần nhất
- sau đó replay WAL đến `recovery_target_time`

Ví dụ trên VPS:

```bash
systemctl stop qltb-backup-postgres.timer qltb-prune-wal.timer qltb-backup-healthcheck.timer || true
docker compose -f docker-compose.prod.yml stop app postgres
```

Khôi phục data directory từ full dump hoặc volume snapshot trước, sau đó chạy Postgres ở chế độ recovery với:

```conf
restore_command = 'cp /wal-archive/%f %p'
recovery_target_time = '2026-06-23 10:15:00+07'
```

Sau khi replay xong:

```bash
docker compose -f docker-compose.prod.yml start postgres
docker compose -f docker-compose.prod.yml start app
docker compose -f docker-compose.prod.yml logs --tail 100 app
```

Lưu ý:

- PITR bằng WAL đòi hỏi volume data + WAL archive phải còn đồng bộ
- luôn rehearsal trước trên staging hoặc clone production

Lưu ý:

- nếu restore full dump đã có schema + data, không chạy `migrate deploy` mù quáng trước khi kiểm tra trạng thái DB
- luôn backup DB hiện tại trước khi restore

## 17. Khôi phục database từ local qua SSH tunnel

Nếu file dump nằm trên máy local:

```bash
ssh -L 5433:127.0.0.1:5432 root@<VPS_IP>
```

Terminal khác trên local:

```bash
psql "postgresql://qltb_user:CHANGE_ME_DB_PASSWORD@127.0.0.1:5433/qltb" < backup.sql
```

## 18. Xử lý lỗi thường gặp

### DNS không phân giải

```text
ERR_NAME_NOT_RESOLVED
```

Kiểm tra:

```bash
nslookup api.example.com
dig api.example.com
```

### Traefik trả 404

Nguyên nhân thường gặp:

- router `Host(...)` sai domain
- app chưa join network `traefik-public`
- Traefik không đọc được Docker provider

Kiểm tra:

```bash
docker logs traefik --tail 100
docker compose -f docker-compose.prod.yml ps
```

### Traefik báo Docker API quá cũ

```text
client version 1.24 is too old. Minimum supported API version is 1.40
```

Cách xử lý:

- dùng image mới như `traefik:v3.1`
- bỏ biến `DOCKER_API_VERSION`
- recreate container Traefik

```bash
cd ~/apps/traefik
docker compose down
docker rm -f traefik 2>/dev/null || true
unset DOCKER_API_VERSION
docker pull traefik:v3.1
docker compose up -d --force-recreate
```

### `docker compose logs -f app` báo `no such service: app`

Bạn đang gọi nhầm file compose local của repo.

Dùng đúng file production:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

## 19. Checklist go-live

- DNS đã trỏ đúng IP VPS
- `https://api.example.com/api/docs` mở được
- `docker compose -f docker-compose.prod.yml exec app npx prisma migrate status` không báo lệch
- upload file thử thành công
- backup DB đầu tiên đã được lưu
- file `.env` đã sao lưu vào nơi an toàn
