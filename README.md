# 轻阅读 · AI 内容与个性化阅读平台

轻阅读是一个面向读者、作者与编辑团队的全流程内容平台。它把匿名投稿、AI 辅助打标、人工审稿、多次退修、内容发布、读者账号与轻量个性化推荐连接成一条可运行的业务闭环。

## 已完成的业务闭环

### 作者端

- 新稿投稿与 DOCX 正文提取
- 不可猜测的安全回执；数据库只保存 SHA-256 哈希
- 回执查询、退修意见查看和多轮修订重投
- 正文仅用于平台阅读与人工审稿，默认不发送给 AI

### 编辑端

- 审稿编辑认领稿件，避免并发重复处理
- AI 标签草稿、人工校对、退修、拒稿与审核发布
- 编辑部负责人管理版本化 Prompt、标签词表和推荐策略
- 平台管理员只管理 AI 服务、员工账号、运行状态与技术日志

### 读者端

- Supabase Auth 注册、登录、找回密码和独立会话
- 收藏、阅读历史、进度恢复和个性化开关
- 显式偏好与汇总阅读行为的轻量混合推荐
- 推荐反馈与“不感兴趣”排除；不采集原始指针或滚动轨迹

## 权责分离

| 角色 | 主要职责 |
| --- | --- |
| `platform_admin` | AI 服务、员工账号、服务状态、技术日志 |
| `editorial_lead` | Prompt、标签词表、推荐策略、编辑配置日志 |
| `review_editor` | 稿件认领、审读、退修、拒稿、标签确认与发布 |

前端入口按职责拆分：

- `/`：公开进入页
- `/reader`：已登录读者空间；未登录时返回公开进入页
- `/author`：作者投稿与回执中心
- `/studio/login`：内部人员登录
- `/studio/platform`：平台管理员工作台
- `/studio/editorial`：编辑部负责人工作台
- `/studio/review`：审稿编辑工作台

内部角色仍由后端校验；直接输入其他角色的网址不会获得对应权限。

## 技术架构

```text
React 19 + Vite
        │
        │ HTTPS / Bearer token
        ▼
FastAPI
  ├─ routers：HTTP 与角色边界
  ├─ schemas：字段校验
  ├─ services：投稿、审稿、推荐、配置等业务逻辑
  └─ utils：鉴权、限流、外呼保护、请求追踪
        │
        ├─ Supabase Auth / Postgres / Storage
        └─ OpenAI-compatible LLM（仅元数据打标）
```

推荐系统当前使用可解释的轻量方案：显式偏好 60%、汇总行为 25%、内容质量 10%、新鲜度 5%。AI 不参与实时排序，也不读取作者全文。

## 本地运行

### 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

后端至少需要：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`，只允许存在后端
- `APP_ENV=development`
- `FRONTEND_ORIGINS`

生产环境还必须使用 HTTPS 前端来源，并通过 `LLM_ALLOWED_HOSTS` 配置 AI 上游域名白名单。

### 前端

```bash
cd front
npm ci
cp .env.example .env.local
npm run dev -- --host 0.0.0.0 --port 5173
```

前端只能配置 Supabase 公钥。开发环境未设置 `VITE_API_BASE_URL` 时会按当前主机推断端口 `8000`，便于手机热点调试；生产环境必须显式配置 HTTPS API 地址。

电脑访问 `http://127.0.0.1:5173/`。同一热点下的手机访问 `http://电脑私网IP:5173/`。

## 验证

```bash
cd backend
./.venv/bin/python -m unittest discover -s tests -v
./.venv/bin/python -m pip check

cd ../front
npm run lint
npm run build
```

当前自动化基线为 118 个后端测试，覆盖角色矩阵、投稿与审稿状态机、配置安全、读者数据、个性化推荐、上传校验、限流和网络短暂失败重试。GitHub Actions 会在推送和拉取请求时重复执行后端测试、依赖检查、前端 lint 与生产构建。

运行状态接口：

- `GET /api/health/live`：进程存活
- `GET /api/health/ready`：服务与数据库就绪
- `GET /docs`：交互式 API 文档

所有响应携带 `X-Request-ID`，服务端输出不含正文、密钥和账号凭证的结构化请求日志。

## 安全与隐私边界

- Supabase service key、AI key 和旧迁移期共享 Token 不进入前端
- 员工与读者使用相互隔离的 Supabase Auth 存储键
- 员工权限由后端角色矩阵决定，不能由前端角色页面绕过
- 作者安全回执原文只保留在作者浏览器，数据库只存哈希
- AI 只接收标题、扉页语和简介；正文、配图与作者回执不发送给模型
- LLM 外呼只允许 HTTPS，拒绝本机、私网、保留地址和非白名单生产域名
- DOCX 有体积、条目数、解压体积、压缩比和 XML 声明限制
- 图片校验 MIME、文件头、体积、边长和总像素
- 公共写接口具有应用层滑动窗口限流；正式部署仍应在网关配置第一层限流

数据库迁移执行记录与权限核验见 `backend/migrations/APPLIED.md`。生产上线前仍需配置域名、HTTPS、网关限流、密钥轮换和备份策略。
