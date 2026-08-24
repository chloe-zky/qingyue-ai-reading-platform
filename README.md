# 轻阅读 · AI 阅读与编辑协作平台

一个面向读者、作者和编辑团队的全栈作品集项目。它把“投稿—AI 辅助打标—人工审稿—发布—个性化推荐”串成一条可演示的内容生命周期，并通过角色权限区分平台技术配置、编辑策略管理与具体稿件审读。

> 公开仓库只包含可解释的应用源码、数据库迁移和自动化测试。真实 Supabase 地址、密钥、账号、线上数据、执行日志、协作记录和设计过程文件均不在仓库中。

## 已实现的功能

- 读者端：偏好选择、推荐列表、正文阅读、护眼模式与首页推荐卡片。
- 作者端：表单投稿、DOCX 正文提取、投稿回执、进度查询，以及退修后的再次提交。
- 审稿编辑：查看待审稿件、AI 标签草稿、确认标签、上传封面、通过、退修或拒稿，并查看自己的审稿记录。
- 编辑部负责人：查看当前 Prompt、标签词表、推荐策略版本及编辑域审计日志。
- 平台管理员：配置 OpenAI-compatible LLM、邀请或停用内部账号、分配角色，并查看技术与安全审计日志。
- 内部鉴权：Supabase Auth 登录，后端校验 Bearer access token，再读取 `staff_profiles` 执行角色授权。

当前审稿闭环与三角色鉴权已实现。编辑部负责人的 Prompt、词表和推荐策略目前以“查询现有版本”为主，版本创建、审批与发布仍是待完善功能；作者端也尚未接入正式用户账号归属，因此不应直接作为公开生产服务部署。

## 技术结构

```text
front/                       React 19 + Vite 8
  src/author/                作者投稿工作台
  src/reader/                推荐与阅读流程
  src/staff/                 三角色内部工作台
  src/auth/                  Supabase 会话与角色守卫
backend/                     FastAPI + Supabase Python SDK
  app/routers/               HTTP 接口与权限依赖
  app/services/              投稿、审稿、推荐、配置与审计逻辑
  app/schemas/               Pydantic 请求/响应模型
  migrations/                角色、配置、审计与审稿状态迁移
  tests/                     不访问真实 Supabase 的测试
```

核心数据流：

```text
作者投稿 → books.pending_review → AI 生成标签草稿
        → 审稿编辑人工确认 → 通过 / 退修 / 拒稿
        → active + confirmed → 读者推荐池
```

AI 打标默认只读取标题、扉页语和内容简介，不发送正文或封面。

## 本地运行

### 1. 后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

在 `backend/.env` 中填写：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`：只允许存在于后端，不得使用 `VITE_` 前缀
- `APP_ENV`：本地使用 `development`
- `FRONTEND_ORIGINS`：生产环境允许访问后端的前端来源，多个值用英文逗号分隔

`ADMIN_TOKEN` 仅为旧版迁移期排障兼容项，当前内部接口不依赖它，新部署可以留空。

### 2. 前端

```bash
cd front
cp .env.example .env.local
npm ci
npm run dev -- --host 0.0.0.0
```

在 `front/.env.local` 中填写 Supabase 项目 URL 与 **anon public key**。开发服务器监听 `0.0.0.0` 后，同一局域网或手机热点内可通过 `http://<电脑私网IP>:5173` 访问；后端也必须监听 `0.0.0.0:8000`。

内部工作台可通过 `?mode=studio` 或 `#studio` 进入。真正的访问控制在后端完成，隐藏前端入口不构成安全措施。

### 3. 数据库

迁移不会自动作用于托管项目。执行前先备份，并按照 [`backend/migrations/README.md`](backend/migrations/README.md) 的顺序操作。仓库中的迁移建立在项目既有 `books`、标签、Prompt 和推荐相关基础表之上；它不是从空数据库初始化全部业务表的完整基线。

## 验证

```bash
cd backend
PYTHONDONTWRITEBYTECODE=1 ./venv/bin/python -m unittest discover -s tests -v
./venv/bin/python -m pip check

cd ../front
npm run lint
npm run build
```

后端测试使用内存替身，不会修改 Supabase。真实端到端测试会创建业务记录，执行前应使用隔离环境并在验证后清理测试数据。

## 主要接口

- 公共与作者：`/api/health`、`/api/recommendations`、`/api/author/*`
- 登录员工：`GET /api/internal/me`
- 审稿编辑：`/api/editor/*`、`/api/uploads/cover`、`/api/books/{id}/*-tags`
- 编辑部负责人：`/api/editorial/*`
- 平台管理员：`/api/platform/*`

内部接口统一使用 `Authorization: Bearer <Supabase access token>`。交互式接口文档默认位于 `http://127.0.0.1:8000/docs`。

## 安全边界与公开说明

- `.env`、`.env.local`、服务端 service-role key、LLM key 和账号凭据不得提交。
- 浏览器只使用 Supabase anon public key；数据权限仍需由 RLS 与后端角色校验共同约束。
- 作者稿件查询目前缺少账号级所有权校验，公开部署前必须补齐。
- 该仓库不提供生产数据、内部账号或可直接连接作者托管项目的配置。
- 安全问题请参阅 [`SECURITY.md`](SECURITY.md)。

## License

本仓库暂未授予开源许可证。源码可供作品展示与评审阅读；复制、分发或商用前请先取得作者许可。
