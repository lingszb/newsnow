# AGENTS.md

## 沟通与执行

- 默认使用简体中文；代码、命令、日志、报错、变量名和 API 名称保持原文。
- 先核对当前 checkout、现有实现和工作区状态，再修改；不得把其他 NewsNow checkout 或历史结论当作当前事实。
- 严格按用户指定的路径、字段、文案和范围执行，不添加未请求的抽象、依赖、兼容层或预留功能。
- 工作区可能包含用户未提交的修改。保留并绕开无关改动，不得擅自还原、覆盖或整理。

## 项目概况

- 技术栈：TypeScript、React 19、TanStack Router/Query、Vite、Nitro、UnoCSS、Vitest。
- 包管理器：`pnpm@10.30.3`；Windows 下优先使用 PowerShell 7 和 `.cmd` 入口。
- Node.js 要求：`>= 20`。
- 前端代码位于 `src/`，服务端 API、服务和数据访问位于 `server/`，前后端共享类型与元数据位于 `shared/`。
- Node/Docker 部署使用 db0 + SQLite，并依赖持久化 `.data`；Cloudflare 部署使用 D1。不要假设不同运行环境的数据行为完全一致。
- 内置 MCP 的实现位于 `server/mcp/`，HTTP 入口为 `/mcp`；修改行业、数据源或设置契约时同步检查 MCP 输入、输出和 stdio 适配。

## 修改原则

- 优先删除或不改，其次复用现有实现、标准库、平台原生能力和已有依赖，最后才做最小新增实现。
- API 请求和响应类型优先定义在 `shared/`；服务端输入必须在 API 边界校验，不能只依赖前端校验。
- 设置页不得返回或持久化展示 `JWT_SECRET`、OAuth Secret、分类 API Key、MCP Token 等敏感值。密钥、安全边界和启动期参数继续由环境变量管理。
- 涉及 SQLite/D1 时保持 SQL 和返回值兼容；数据库相关测试优先使用 `:memory:`，不得污染项目 `.data`。
- 修改行业分类时同时检查：分类提示词与结果校验、资讯查询和计数、动态路由、设置接口、MCP schema/校验、旧分类结果的重新入队行为。
- 保持现有无障碍行为：对话框焦点约束、键盘关闭、表单标签、按钮可访问名称和 switch 状态不得退化。

## 生成文件与环境

- `src/routeTree.gen.ts` 由 TanStack Router 生成，除非生成流程明确要求，否则不要手工编辑。
- `shared/sources.json`、`shared/pinyin.json` 等可能由 `scripts/` 中的预处理脚本生成；运行前后必须检查 diff，避免覆盖用户改动。
- `pnpm.cmd run build` 会先执行 `presource`。仅需验证编译且不希望重写生成数据时，可使用 `.\node_modules\.bin\vite.CMD build`。
- `.env`、`.env.server` 和本机 `.data` 可能包含敏感信息或真实状态。只读取完成任务所需的变量名，不输出密钥值，不提交这些文件。
- 临时验证产物统一放入 `.tmp/verification/`，结束前清理；构建产物使用项目既有 `dist/`。

## 验证规则

- 默认不进行页面级验证。除非用户明确提醒或要求，否则不要启动 `dev`、`preview` 或生产服务器，不要使用浏览器、Chrome DevTools、Playwright、截图或人工页面验收。
- 前端修改默认使用非页面级的最小充分验证，例如定向 ESLint、相关 Vitest、TypeScript 检查或生产构建。
- 只有用户明确要求页面级验证时才执行浏览器交互；验证业务状态变化，不能只以 HTTP 200 或元素存在作为通过依据。
- 启动本项目服务会触发后台数据源刷新并访问外部站点。页面级验证获准后，也应使用隔离的 `.tmp/verification/` 数据目录，关闭未需调用的分类服务，并在结束时停止由本次任务启动的进程。
- 验证失败时区分本次回归与既有问题；给出具体文件和报错，不得把被既有错误阻断写成验证通过。

## 常用命令

```powershell
pnpm.cmd install
pnpm.cmd run lint
pnpm.cmd run typecheck
pnpm.cmd test --run <test-file> [...]
pnpm.cmd run build
```

- 优先运行与改动直接相关的测试和 lint 文件；风险较高或影响共享契约时再扩大范围。
- 构建、测试和 lint 完成后运行 `git diff --check`，并用 `git status --short` 确认没有误改或遗留临时文件。
