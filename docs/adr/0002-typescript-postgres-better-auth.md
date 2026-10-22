# TypeScript 全栈、只支持 Postgres、认证交给 Better Auth

单价换算与判断逻辑必须在前端（货架前快速判断，可离线）和后端（识别草稿、统计、MCP）得出完全一致的结果，所以前后端统一用 TypeScript，并把这部分逻辑放进共享的 `domain` 包。数据库只支持 Postgres：同时兼容 SQLite 需要成对维护 migration 和 SQL 方言（cardvault 就是这么做的），而这个项目从自托管场景中得不到相应的收益。家庭、成员、邀请以及 MCP 所需的 OAuth 2.1 授权服务器，都交给 Better Auth 的 organization 和 OAuth Provider 插件实现，不自己写。

## Considered Options

- Go + SQLite/Postgres 双库，沿用 cardvault 的骨架（被否：单价逻辑要在前端再实现一遍，双库成本对这个项目不划算）
- TS + SQLite/Postgres 双库（被否：同样要维护两套 schema）

## Consequences

- MCP 客户端只通过 CIMD（Client ID Metadata Document）接入，不开启 OAuth 动态客户端注册（DCR）。Claude 和 Claude Code 都发布了 CIMD 文档，已实测能完成授权并调用工具（APP-93）。开启 DCR 意味着任何人都能匿名注册任意回调地址的客户端，所以只有遇到只支持 DCR 的客户端时才重新评估。
- MCP access token 只携带用户（`sub`），不携带家庭。每次请求都由用户查 member 表得到所属家庭，成员离开家庭立即生效，不必等 token 过期。Better Auth 的 organization 插件允许一个用户属于多个 organization，单家庭约束由本项目自己保证并用测试覆盖。
- MCP access token 是 Better Auth 签发的 JWT，本地验签不查库，所以每次请求还会检查该用户对该客户端的授权（consent）是否还在。成员在 Web 端撤销授权时同时删除 consent 和已签发的 refresh token，旧的 access token 立即失效，不必等过期。
- MCP 权限分 `stockup:read` 和 `stockup:write` 两个 scope：只读工具需要前者，新建、修改和删除的工具只对带后者的 token 开放。渠道、大类和品类可以通过 MCP 新建、修改（含渠道归档）和删除，删除沿用 HTTP 接口的规则，仍被引用时拒绝；删除工具标注 destructive，由 MCP 客户端在执行前请成员确认。合并、修改入手价和成员管理不通过 MCP 提供。
