# CI/CD VPS Với GitHub Actions

Hướng dẫn này ghi lại quy trình setup CI/CD cho backend QLTB theo đúng bối cảnh hiện tại:

- repo GitHub là `private`
- source production trên VPS đang nằm tại `/root/apps/qltb/be`
- GitHub Actions SSH vào VPS bằng user `root`
- VPS tự `git pull` từ GitHub bằng SSH key riêng
- deploy bằng `docker-compose.prod.yml`
- workflow có 2 job:
  - `test`
  - `deploy`

Tài liệu này ưu tiên tính thực dụng để khớp với production đang chạy. Đây không phải cấu hình bảo mật tối ưu dài hạn. Khi hệ thống ổn định, nên migrate sang user deploy riêng thay vì `root`.

## 1. Kiến trúc CI/CD hiện tại

Luồng chạy:

1. push code lên branch deploy
2. GitHub Actions checkout code
3. job `test` chạy:
   - `npm ci`
   - `npm run build`
   - unit test selective theo module thay đổi
4. nếu `test` pass, job `deploy` chạy:
   - decode SSH private key từ GitHub secret
   - SSH vào VPS bằng `root`
   - chạy `cd /root/apps/qltb/be && ./deploy.sh`
5. `deploy.sh` trên VPS sẽ:
   - `git fetch` / `git pull`
   - backup DB trước deploy
   - `docker compose up -d --build`
   - `npx prisma migrate deploy`
   - kiểm tra app bằng smoke check

Phân biệt 2 loại SSH key:

- **Key 1: GitHub Actions -> VPS**
  - dùng trong GitHub Secrets
  - cho phép workflow SSH vào VPS
- **Key 2: VPS -> GitHub**
  - nằm trên VPS
  - cho phép `git fetch` / `git pull` repo private

Hai key này phải tách riêng.

## 2. Điều kiện đầu vào

Phải có sẵn:

- VPS Linux có Docker và Docker Compose
- source đã clone ở `/root/apps/qltb/be`
- `docker-compose.prod.yml` chạy ổn khi deploy manual
- file `.env` production đã có sẵn trên VPS
- repo GitHub private có quyền chỉnh `Actions`, `Secrets`, `Environments`

Kiểm tra nhanh trên VPS:

```bash
cd /root/apps/qltb/be
git remote -v
git branch --show-current
docker compose -f docker-compose.prod.yml ps
```

## 3. Setup SSH key cho VPS pull repo private

### 3.1 Tạo SSH key trên VPS

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
ssh-keygen -t ed25519 -C "vps-root-git-pull" -f /root/.ssh/github_git_pull
```

Khi hỏi passphrase, nhấn `Enter` 2 lần để **không đặt passphrase**.

### 3.2 Add public key vào GitHub repo

Lấy public key:

```bash
cat /root/.ssh/github_git_pull.pub
```

Vào repo GitHub:

- `Settings`
- `Deploy keys`
- `Add deploy key`
- paste key
- chọn `Read access`

<!-- ![Deploy key đã được add thành công](./img/ci-cd-deploy-key-added.png) -->

### 3.3 Ép SSH trên VPS dùng đúng key này

Tạo `/root/.ssh/config`:

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/github_git_pull
  IdentitiesOnly yes
```

Sửa quyền:

```bash
chmod 600 /root/.ssh/config
chmod 600 /root/.ssh/github_git_pull
chmod 644 /root/.ssh/github_git_pull.pub
```

### 3.4 Test root -> GitHub

```bash
ssh -T git@github.com
cd /root/apps/qltb/be
git fetch origin
git pull --ff-only origin <branch-deploy>
```

Nếu `ssh -T git@github.com` báo `Permission denied (publickey)`, key VPS -> GitHub chưa đúng hoặc chưa được add vào Deploy keys.

<!-- ![SSH test VPS → GitHub thành công](./img/ci-cd-ssh-test-success.png) -->

## 4. Setup SSH key cho GitHub Actions vào VPS

### 4.1 Tạo key mới không passphrase

Trên VPS:

```bash
ssh-keygen -t ed25519 -C "github-actions-root-deploy" -f /root/.ssh/github_actions_deploy_nopass
```

Khi hỏi passphrase, nhấn `Enter` 2 lần.

### 4.2 Add public key vào `authorized_keys`

```bash
cat /root/.ssh/github_actions_deploy_nopass.pub >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
```

Kiểm tra:

```bash
grep -n "github-actions-root-deploy" /root/.ssh/authorized_keys
ls -ld /root /root/.ssh
ls -l /root/.ssh
```

### 4.3 Encode private key thành base64

```bash
base64 -w 0 /root/.ssh/github_actions_deploy_nopass
```

Nếu hệ điều hành không hỗ trợ `-w 0`:

```bash
base64 /root/.ssh/github_actions_deploy_nopass | tr -d '\n'
```

Copy output này. Đây sẽ là secret `VPS_SSH_KEY_B64`.

### 4.4 Lấy `known_hosts` của VPS

Chạy từ máy local:

```bash
ssh-keyscan -p 22 <VPS_IP>
```

Copy output này để dùng làm secret `VPS_KNOWN_HOSTS`.

## 5. GitHub Secrets và Environment

Environment đang dùng theo context hiện tại là:

- `VPS_SSH_KEY`

Workflow hiện lấy secrets từ environment này. Nếu đổi tên environment, phải sửa lại file workflow.

Tạo các secrets trong environment `VPS_SSH_KEY`:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_KEY_B64`
- `VPS_KNOWN_HOSTS`

Giá trị:

- `VPS_HOST`: IP hoặc hostname VPS
- `VPS_PORT`: `22` hoặc SSH port thực tế
- `VPS_USER`: `root`
- `VPS_SSH_KEY_B64`: private key base64 của `github_actions_deploy_nopass`
- `VPS_KNOWN_HOSTS`: output của `ssh-keyscan`

<!-- ![GitHub Secrets đã được tạo đầy đủ](./img/ci-cd-github-secrets-done.png) -->

## 6. Script deploy trên VPS

Tạo file `/root/apps/qltb/be/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/apps/qltb/be"
BRANCH="main"

cd "$APP_DIR"

echo "==> Current commit before deploy"
git rev-parse --short HEAD || true

echo "==> Fetch latest code"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Backup database before deploy"
docker exec qltb_postgres pg_dump -U qltb_user -d qltb > "/root/predeploy-$(date +%F-%H%M%S).sql"

echo "==> Rebuild and start containers"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Run prisma migrate deploy"
docker compose -f docker-compose.prod.yml exec -T app npx prisma migrate deploy

echo "==> Container status"
docker compose -f docker-compose.prod.yml ps

echo "==> App logs"
docker compose -f docker-compose.prod.yml logs --tail 100 app

echo "==> Local smoke check"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/docs >/dev/null; then
    echo "Local smoke check passed"
    break
  fi
  echo "Waiting for local app... ($i/30)"
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/docs >/dev/null

echo "==> Deployed commit"
git rev-parse --short HEAD
```

Cấp quyền chạy:

```bash
chmod +x /root/apps/qltb/be/deploy.sh
```

Test manual:

```bash
cd /root/apps/qltb/be
./deploy.sh
```

## 7. Workflow GitHub Actions

File workflow hiện tại: [/.github/workflows/deploy-vps.yml](/Users/min/Documents/device-management/BE/.github/workflows/deploy-vps.yml)

Context hiện tại:

- trigger branch trong repo đang là `sandbox`
- environment đang là `VPS_SSH_KEY`
- workflow đã có 2 job:
  - `test`
  - `deploy`

### 7.1 Job `test`

Chạy:

- `actions/checkout@v4` với `fetch-depth: 2`
- `npm ci`
- `npm run build`
- `scripts/ci/selective-unit-tests.sh`

### 7.2 Job `deploy`

Chạy:

- decode private key từ `VPS_SSH_KEY_B64`
- verify key:
  ```bash
  ssh-keygen -y -f ~/.ssh/id_ed25519 >/dev/null
  ```
- SSH vào VPS:
  ```bash
  ssh -i ~/.ssh/id_ed25519 \
    -o IdentitiesOnly=yes \
    -p "${{ secrets.VPS_PORT }}" \
    "${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}" \
    "cd /root/apps/qltb/be && ./deploy.sh"
  ```

## 8. Selective unit test script

File: [scripts/ci/selective-unit-tests.sh](/Users/min/Documents/device-management/BE/scripts/ci/selective-unit-tests.sh)

Logic hiện tại:

- lấy diff `HEAD^..HEAD`
- nếu file thay đổi nằm trong:
  - `src/modules/<module>/...`
  - gom module đó
- nếu file thay đổi nằm trong:
  - `src/core/`
  - `src/shared/`
  - `prisma/`
  - `.github/`
  - `docs/`
  - `scripts/`
  - `Dockerfile`
  - `docker-compose*.yml`
  - `package.json`
  - `package-lock.json`
  - `tsconfig*.json`
  - hoặc path không map được
  - fallback `npm test`
- nếu module được detect nhưng không có spec tương ứng:
  - fallback `npm test`
- nếu có spec:
  - chạy:
    ```bash
    npx jest <list-of-spec-files>
    ```

## 9. Các lệnh commit và push workflow/script

Sau khi sửa workflow hoặc script CI:

```bash
cd /Users/min/Documents/device-management/BE
git add .github/workflows/deploy-vps.yml scripts/ci/selective-unit-tests.sh
git commit -m "ci: update VPS deploy pipeline"
git push origin sandbox
```

Nếu bạn muốn deploy production từ `main`, đổi workflow trigger branch từ `sandbox` sang `main`, rồi push vào `main`.

## 10. Kiểm tra sau khi workflow chạy

Trên VPS:

```bash
cd /root/apps/qltb/be
git rev-parse --short HEAD
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 app
ls -lh /root/predeploy-*.sql | tail
```

Nếu có domain:

```bash
curl -I https://api-dhnct.chauthoi.io.vn/api/docs
```

![Workflow GitHub Actions chạy thành công](/ci-cd-1.jpg)
![Workflow GitHub Actions chạy thành công](/cd-ci-2.jpg)

## 11. Troubleshooting đã gặp trong thực tế

### 11.1 `Load key ".../id_ed25519": error in libcrypto`

Nguyên nhân:

- key trong secret sai format
- hoặc key có passphrase

Fix:

- tạo key riêng **không passphrase**
- lưu secret dưới dạng base64
- decode bằng:

```bash
printf '%s' "${{ secrets.VPS_SSH_KEY_B64 }}" | base64 -d > ~/.ssh/id_ed25519
```

### 11.2 `Permission denied (publickey,password)` ở bước SSH vào VPS

Nguyên nhân:

- public key chưa được add vào `/root/.ssh/authorized_keys`
- hoặc GitHub secret đang chứa private key không khớp cặp public key

Fix:

- kiểm tra:
  ```bash
  grep -n "github-actions-root-deploy" /root/.ssh/authorized_keys
  ```
- kiểm tra fingerprint của cặp key

### 11.3 `git@github.com: Permission denied (publickey)` trong `deploy.sh`

Nguyên nhân:

- VPS không `git pull` được repo private

Fix:

- tạo key riêng cho `root -> GitHub`
- add vào `Deploy keys`
- ép dùng đúng key qua `/root/.ssh/config`

### 11.4 `Smoke check` fail dù app vừa mới `up`

Nguyên nhân:

- app chưa bind xong port `3000`

Fix:

- dùng retry loop 30 lần x 2 giây như trong `deploy.sh`

### 11.5 `chmod: cannot access scripts/ci/selective-unit-tests.sh`

Nguyên nhân:

- file chưa được `git add/commit/push`
- workflow đang chạy trên branch chưa chứa file đó

Fix:

```bash
git add scripts/ci/selective-unit-tests.sh
git commit -m "ci: add selective unit test script"
git push origin <branch>
```

### 11.6 Không thấy `Deploy keys` trong GitHub

Nguyên nhân:

- đang ở sai chỗ
- hoặc account không có quyền admin repo

Đúng vị trí:

- vào trang repo
- `Settings`
- sidebar: `Deploy keys`

## 12. Quy ước vận hành

- Không chỉnh tay source trên VPS nếu có thể tránh.
- Mọi thay đổi deploy script hoặc workflow phải commit vào repo.
- Trước deploy luôn có backup DB:
  - `/root/predeploy-<timestamp>.sql`
- Nếu workflow đang nghe branch `sandbox`, đừng push thẳng vào `main` rồi mong workflow chạy.
- Nếu đổi branch deploy, phải sửa cả:
  - `.github/workflows/deploy-vps.yml`
  - `deploy.sh` biến `BRANCH`

## 13. Bước tiếp theo khuyến nghị

Khi pipeline này ổn định, nên nâng cấp theo thứ tự:

1. chuyển SSH deploy từ `root` sang user `deploy`
2. đổi environment GitHub từ `VPS_SSH_KEY` sang tên rõ nghĩa hơn như `production`
3. thêm public smoke check theo domain thật sau local smoke check
4. thêm rollback strategy rõ ràng hơn thay vì chỉ `git pull` + rebuild
