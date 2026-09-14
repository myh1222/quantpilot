# TradingView + Pine + AI 自选股智能监控系统方案

> **文档状态**：Revised Architecture Proposal；实现受 Phase 0 Spike 门禁约束\
> **目标读者**：项目开发者 / Reviewer\
> **核心原则**：TradingView/Pine 负责实时技术信号触发；AI
> 只在信号发生后介入，结合新闻、市场环境和历史信号做二次研判；原生 Watchlist Alert
> 负责动态覆盖列表，浏览器自动化仅作可选审计和维护，不承担实时盯盘。

------------------------------------------------------------------------

## 1. 背景与目标

目前已有一个 TradingView Pine Script 技术指标，可计算并展示：

-   EMA20 / EMA50 / EMA200
-   VWAP（日内）
-   RSI
-   MACD
-   ATR
-   成交量 / Volume Ratio
-   Previous Day High / Low
-   Swing High / Swing Low
-   第一、第二支撑
-   第一、第二压力
-   当前周期综合评分
-   日线趋势
-   当前周期与日线趋势关系

下一步希望将其扩展为一个自动化股票监控系统。

系统需要实现：

1.  从用户已登录的 TradingView 账号读取指定 Watchlist。
2.  自动同步 Watchlist 的新增、删除股票。
3.  为 Watchlist 股票配置并维护必要的 TradingView Alert。
4.  Pine Script 在 TradingView 服务器侧持续计算技术指标。
5.  只在有意义的技术事件发生时发送 Webhook，而不是持续上报行情。
6.  Webhook 触发 AI 分析任务。
7.  AI 自动收集个股新闻、公告、行业信息、指数、宏观和市场风险情绪。
8.  AI 综合技术面、新闻面、市场环境和历史信号评估信号质量。
9.  仅对达到阈值的信号向用户发送通知。
10. 系统只做监控和分析，**不自动交易、不自动下单**。

------------------------------------------------------------------------

## 2. 非目标

第一阶段明确不做：

-   自动买卖股票
-   券商账户连接
-   自动下单
-   高频交易
-   Tick 级行情处理
-   AI 持续刷新 TradingView 网页读取行情
-   依赖截图/OCR作为主要数据来源

AI 和 Playwright 都不应该承担实时行情监控职责。

### 2.1 实现前置条件

以下条件不是后续优化，而是开始 Phase 1 前必须完成的门禁：

1.  使用真实账户验证原生 Watchlist Alert、当前自定义 Pine、动态 `alert()` JSON 和 Webhook 的完整链路；
2.  确认目标账户支持 Webhook、已开启 2FA，并确认 Watchlist Alert 配额与到期行为；
3.  逐交易所确认实时行情 entitlement；延迟行情必须在 UI 和通知中明确标记，不能按实时监控宣传；
4.  选择公网部署形态：推荐 VPS；本地运行时必须通过受控 HTTPS Tunnel 暴露网关；
5.  确定 Phase 1 使用的公告、新闻和 Outcome Quote Provider，并确认 API 权限、使用条款与数据保留要求。

任何门禁失败都必须形成显式 fallback 或 STOP 决策，不能在实现过程中默认绕过。特别是：
Watchlist Alert 不可用但普通技术 Alert 与 Webhook 可用时，才允许进入 per-symbol fallback；
若普通技术 Alert 或 Webhook entitlement 也不可用，则 Phase 1 必须停止，直到订阅能力满足。

------------------------------------------------------------------------

## 3. 总体架构

``` text
                         TradingView Account
                                │
                         Watchlist 自选股
                                │
                   Native Watchlist Alert（首选）
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
          动态跟随列表成员               Playwright（可选）
                 │                    本地审计 / Alert 维护
                 │                             │
                 └──────────────┬──────────────┘
                                ▼
┌─────────────────────────────────────────────────────┐
│                  TradingView Cloud                  │
│                                                     │
│              Pine Technical Engine                  │
│                                                     │
│ EMA / RSI / MACD / VWAP / ATR / Volume             │
│ Swing / Support / Resistance / MTF Trend            │
│                                                     │
│              Event Detection Engine                 │
└──────────────────────────┬──────────────────────────┘
                           │
                        Webhook
                           │
                           ▼
                  ┌─────────────────┐
                  │ Signal Gateway  │
                  │ Validate / Auth │
                  │ Store + Outbox  │
                  └────────┬────────┘
                           │
                       Async Worker
                           │
                           ▼
                  ┌─────────────────┐
                  │   AI Analyst    │
                  └────────┬────────┘
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
          Technical       News          Market
           Context       Context        Context
             │             │              │
             └─────────────┼──────────────┘
                           ▼
                   Sentiment Engine
                           │
                           ▼
                 Signal Confidence
                           │
                           ▼
                     Notification
              Telegram / Feishu / macOS
```

------------------------------------------------------------------------

## 4. 核心设计原则

### 4.1 TradingView 负责实时计算

不要让 AI 每隔几分钟：

1.  打开 TradingView；
2.  点击股票；
3.  切换周期；
4.  读取指标；
5.  判断是否有信号。

这套方式依赖网页 DOM，成本高、延迟大且不稳定。

正确职责划分：

``` text
TradingView / Pine
    → 实时技术指标计算
    → 技术事件检测
    → Alert

AI
    → 事件发生后才启动
    → 搜集上下文
    → 判断信号质量
```

### 4.2 Alert 应报告"事件"，而不是"状态"

错误示例：

``` text
score <= -5
→ 每根 K 线都报告“强空”
```

正确示例：

``` text
偏空 -4
    ↓
强空 -5

→ ENTER_STRONG_SHORT
```

只在状态发生变化时触发。

### 4.3 浏览器自动化只做控制面

首选架构使用 TradingView 原生 Watchlist Alert。列表新增或删除 Symbol 后，由 TradingView
动态更新同一条 Alert 的覆盖范围，不为每只股票创建独立 Alert。

Playwright 仅在确有需要时用于：

-   Watchlist 本地镜像与审计
-   少量 Watchlist Alert 的存在性、版本和到期检查
-   经验证安全的 Alert 重建

如果 Phase 0 证明自定义 Pine 无法用于 Watchlist Alert，才启用 fallback：每个
`symbol + trigger timeframe` 一条聚合 Alert。无论哪种模式，8 个事件都通过同一 Pine
脚本内的动态 `alert()` 发出，禁止按事件创建 8 条独立 Alert。

不用于实时行情读取。

可以理解为：

``` text
TradingView Watchlist Alert = Primary Control Plane
Playwright = Optional/Reconciliation Control Plane
Pine       = Data / Signal Plane
AI         = Analysis Plane
```

------------------------------------------------------------------------

## 5. 推荐技术栈

### Backend

-   Node.js
-   TypeScript
-   Fastify（或 Express）
-   SQLite（MVP）
-   Playwright

Phase 1 固定为单机、单 Node.js 进程：HTTP Server、Worker Loop 和 SQLite 共存，但 HTTP
接收路径始终优先且不执行外部 I/O。Phase 2 允许同一主机启动多个 Worker，仍共享单个 SQLite。

仅在满足以下任一条件并有指标证据时评估 Postgres/Redis：

-   需要多主机或多实例高可用部署；
-   SQLite write-lock 等待持续导致 Webhook 提交 p95 接近 3 秒预算；
-   oldest pending job age 或任务领取延迟持续超过 SLO，且增加本机 Worker 无法解决；
-   备份、容灾或运维要求无法由单文件数据库满足。

Symbol 数量或单日 Signal 数量本身不作为提前引入 Redis/BullMQ 的理由。

### AI

抽象统一接口：

``` typescript
interface AIProvider {
    analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
```

后端可替换：

-   OpenAI
-   Claude
-   其他模型

不要将项目与单一模型供应商强耦合。

### Notification

统一接口：

``` typescript
interface Notifier {
    send(notification: Notification): Promise<void>;
}
```

实现：

-   Telegram
-   Feishu
-   macOS Desktop Notification

------------------------------------------------------------------------

## 6. 项目目录建议

``` text
tv-ai-monitor/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
│
├── config/
│   ├── monitor.yaml
│   ├── symbols.yaml
│   └── prompts/
│       ├── signal-analysis.md
│       └── market-summary.md
│
├── pine/
│   └── ai-dashboard-alert.pine
│
├── src/
│   ├── browser/
│   │   ├── tradingview.ts
│   │   ├── watchlist.ts
│   │   └── alerts.ts
│   │
│   ├── server/
│   │   └── webhook.ts
│   │
│   ├── signals/
│   │   ├── parser.ts
│   │   ├── dedup.ts
│   │   ├── state-machine.ts
│   │   └── evaluator.ts
│   │
│   ├── market/
│   │   ├── news.ts
│   │   ├── announcements.ts
│   │   ├── macro.ts
│   │   ├── sentiment.ts
│   │   └── quotes.ts
│   │
│   ├── ai/
│   │   ├── provider.ts
│   │   ├── analyst.ts
│   │   └── prompt-builder.ts
│   │
│   ├── notify/
│   │   ├── notifier.ts
│   │   ├── telegram.ts
│   │   ├── feishu.ts
│   │   └── desktop.ts
│   │
│   ├── db/
│   │   ├── sqlite.ts
│   │   └── schema.sql
│   │
│   ├── queue/
│   │   ├── outbox.ts
│   │   └── worker.ts
│   │
│   └── jobs/
│       ├── sync-watchlist.ts
│       ├── reconcile-alerts.ts
│       ├── analyze-signal.ts
│       └── track-outcome.ts
│
├── data/
│   └── monitor.db
│
└── tests/
```

------------------------------------------------------------------------

## 7. Watchlist 与 Alert 拓扑

### 7.1 登录方式

使用 Playwright persistent browser profile。

原则：

-   第一次由用户手动登录 TradingView。
-   后续复用浏览器 Profile。
-   程序不得读取或打印密码。
-   程序不得导出 Cookie / Session Token。
-   日志中不得出现认证信息。
-   不允许自动点击 Buy / Sell / Trade 等交易按钮。
-   登录态过期、出现验证码或页面身份不明时必须 fail closed，并通知管理员手动恢复。
-   Browser Profile 视为敏感数据，只允许当前用户访问，不进入备份、日志或版本控制。

### 7.2 首选：原生 Watchlist Alert

一条 Watchlist Alert 使用当前 Pine 指标和 `Any alert() function call`，由 Pine 在消息中
动态输出 `symbol` 和 `event`。TradingView 负责在列表成员变化时更新覆盖范围。

Phase 0 必须验证：

1.  `alert()` 中基于 `syminfo.tickerid` 拼接的 JSON 对每个列表 Symbol 正确求值；
2.  混合市场、停牌、无权限或无数据 Symbol 不会影响其他 Symbol；
3.  高频同时触发不会使整个 Watchlist Alert 进入 limited functionality 或 fire-control；
4.  到期时间、版本升级和重建期间的重复投递行为可观测。

当前官方 fire-control 边界为单 Symbol 15 次/3 分钟、整条 Watchlist Alert 1000 次/3 分钟。
Phase 0 的 TradingView 实测必须低于该边界；网关容量压测使用合成 HTTP 流量独立完成，不能为
压测自家服务而故意停掉 TradingView Alert。

### 7.3 可选：本地镜像同步

``` text
Scheduler
   │
   ▼
打开 TradingView
   │
   ▼
读取指定 Watchlist
   │
   ▼
Normalize Symbol
   │
   ▼
与 DB 做 Diff
   │
   ├── 新增 → enabled
   ├── 保留 → update last_seen_at
   └── 删除 → disabled
```

推荐同步频率：

``` text
1 hour
```

Watchlist 不是高频变化数据，不需要分钟级刷新。

本地镜像只用于审计、Symbol 元数据补充和 AI 上下文，不作为 TradingView 是否监控该股票的
唯一真相来源。同步失败时禁止根据不完整页面批量 disabled。

### 7.4 Symbol 标准化与元数据

内部统一保存完整标识：

``` text
HKEX:981
HKEX:9988
NASDAQ:AAPL
NASDAQ:NVDA
SSE:600519
SZSE:300750
```

避免只使用 `981` / `700` 等可能产生歧义的 ticker。

每个 Symbol 还必须保存或通过配置补齐：

``` text
market
instrument_type
timezone
currency
industry
data_delay_seconds
quote_provider_symbol
```

行业、市场交易日历和跨 Provider Symbol 映射不能仅靠 AI 猜测。MVP 标的较少时允许在
`symbols.yaml` 中人工维护并定期审计。

------------------------------------------------------------------------

## 8. Pine Technical Engine

### 8.1 当前指标

保留：

-   EMA20
-   EMA50
-   EMA200
-   VWAP
-   RSI
-   MACD
-   ATR
-   Volume Ratio
-   PDH / PDL
-   Swing High / Low
-   Support / Resistance
-   Current Score
-   Daily Trend

### 8.2 时间周期

MVP 只监控：

``` text
Daily
15 Minute
```

职责：

``` text
Daily
→ Higher Timeframe Context

15m
→ Signal Trigger
```

Daily 不是独立 Alert，不计入 Alert 数量。Pine 在 15m 触发上下文中读取上一根已收盘日线。

### 8.3 行情权限

Watchlist Alert 解决的是计算覆盖范围，不保证底层行情实时。Phase 0 必须逐一确认 HKEX、
SSE、SZSE、NASDAQ 等目标交易所的实时权限。Payload 必须包含已知的
`data_delay_seconds`；权限未知时标记 `null`，不得默认为实时。

避免一开始同时监控：

``` text
1m / 5m / 15m / 30m / 1h / 4h / 1D
```

否则 Alert 数量和噪声都会迅速增加。

------------------------------------------------------------------------

## 9. Pine Event Model

MVP 建议定义 8 个事件：

``` text
ENTER_STRONG_LONG
ENTER_STRONG_SHORT

BREAK_RESISTANCE_1
BREAK_SUPPORT_1

BULL_ALIGNMENT
BEAR_ALIGNMENT

RSI_OVERSOLD_RECOVERY
RSI_OVERBOUGHT_FALLBACK
```

8 个事件共用一个 `alert()` 出口，不创建 8 条 `alertcondition()` Alert。消息由 Pine
动态拼接为 JSON，调用频率统一为：

``` pine
if eventTriggered and barstate.isconfirmed
    alert(message, alert.freq_once_per_bar_close)
```

### 9.1 Non-repaint 契约

-   所有 15m 事件只在 K 线收盘后确认；
-   日线上下文只使用上一根已收盘日线，例如
    `request.security(syminfo.tickerid, "1D", trendExpr[1], lookahead = barmerge.lookahead_on)`；
-   禁止使用未来数据或未确认 Pivot；
-   Pine 回放结果、实时结果和 Alert Runtime 必须使用相同输入与版本做一致性测试。

### 9.2 强多/强空

不是持续判断：

``` pine
strongLong = score >= 5
```

而是检测进入状态：

``` pine
enterStrongLong = strongLong and not strongLong[1]
```

### 9.3 RSI

关注恢复/回落，而不是单纯进入极值：

``` text
RSI < 30
→ RSI 重新上穿 30
→ RSI_OVERSOLD_RECOVERY
```

``` text
RSI > 70
→ RSI 重新跌破 70
→ RSI_OVERBOUGHT_FALLBACK
```

### 9.4 支撑压力突破

``` text
close cross below Support 1
→ BREAK_SUPPORT_1

close cross above Resistance 1
→ BREAK_RESISTANCE_1
```

默认优先使用 K 线收盘确认，减少盘中假突破。

Support/Resistance 必须是已确认并冻结的 level。每个 level 至少包含：

``` text
level_id
level_price
level_confirmed_at
level_source
```

结构位生命周期统一为：

``` text
DETECTED → CONFIRMED → ACTIVE → BROKEN
                           └──→ INVALIDATED
```

-   `DETECTED`：候选 Pivot，尚不可触发事件；
-   `CONFIRMED`：满足左右确认 bar 数，生成不可变 `level_id` 和价格；
-   `ACTIVE`：进入当前支撑/压力集合，可参与突破判断；
-   `BROKEN`：价格在收盘时穿越该冻结 level，仅允许产生一次突破事件；
-   `INVALIDATED`：因结构更新、超龄或配置规则退出，不产生突破事件。

MVP 中新 `support1` 确认后，旧 `support1` 仅在仍满足排序、距离和有效期规则时降级为
`support2`，否则进入 `INVALIDATED`；压力位同理。被突破的 resistance 不自动转换为 support，
支阻角色互换作为后续独立事件模型。EMA 只作为趋势/排列条件，不进入 frozen structural level；
可冻结的结构位仅限已确认 Pivot、PDH/PDL 和配置明确允许的静态价位。

突破比较上一有效冻结 level，而不是一条可在当前 bar 平移的动态曲线。level 替换本身不产生
价格突破；如确需处理，必须定义独立的 `LEVEL_REPLACED` 内部状态。Pivot 的左右确认 bar 数、
level 失效条件和重置规则必须进入 `pine_config_version`。

------------------------------------------------------------------------

## 10. Alert Payload

Pine → Webhook 使用 JSON。

建议 Schema：

``` json
{
  "schema_version": 1,
  "pine_config_version": 1,

  "alert_instance_id": "main-watchlist-15m-v1",
  "run_id": "P0-20260911-001",

  "symbol": "HKEX:981",
  "ticker": "981",
  "market": "HK",
  "timeframe": "15m",
  "data_delay_seconds": 0,

  "event": "BREAK_SUPPORT_1",

  "price": 61.20,

  "score": -6,
  "max_score": 7,

  "daily_trend": "BEARISH",

  "rsi": 34.2,
  "macd_hist": -0.42,

  "atr": 2.31,
  "atr_pct": 3.8,

  "volume_ratio": 1.72,

  "support1": 61.30,
  "support1_id": "pivot-low-1789005600000",
  "support1_confirmed_at_ms": 1789005600000,
  "support2": 58.30,

  "resistance1": 63.00,
  "resistance2": 64.70,

  "bar_open_time_ms": 1789092000000
}
```

时间字段统一为 Unix epoch milliseconds、UTC 语义。`bar_open_time_ms` 表示触发 K 线的
开盘时刻；`received_at` 由网关生成，不接受 Payload 覆盖。外部 API 或展示层需要秒/ISO
时间时在边界转换。

### 10.1 Schema Version

必须提供：

``` text
schema_version
```

便于后续兼容 Payload 结构变化。

### 10.2 Pine Config Version

必须提供：

``` text
pine_config_version
```

例如：

``` text
FINAL ALERT V1 → 1
FINAL ALERT V2 → 2
```

如果 Pine 参数或 Alert 逻辑变化，Alert Reconciler 可检测：

``` text
DB Alert Version != Current Pine Version
```

并标记需要重建。

------------------------------------------------------------------------

## 11. Signal Gateway

接口：

``` text
POST /webhook/tradingview
```

处理过程：

``` text
Receive
  ↓
Validate Schema
  ↓
Validate Client Certificate / Secret
  ↓
Normalize Symbol
  ↓
Validate Symbol / Time Window
  ↓
BEGIN IMMEDIATE
  ├── Insert Delivery
  ├── Upsert Provisional Symbol（仅未知 Symbol）
  ├── Upsert Logical Signal
  └── Insert Durable Job / Outbox
COMMIT
  ↓
Return HTTP 200
```

Webhook handler 不同步等待：

``` text
News Search
AI Analysis
Notification
```

这些工作全部异步执行。

Handler 必须在 TradingView 的 3 秒超时内完成持久化并返回。不能依赖“故意返回 500”作为
主重试机制：TradingView 只对部分 5xx 有限重发，超时、504 和多数 4xx 不保证重发。

Worker 从 SQLite durable jobs 表领取任务，使用 lease 防止并发重复执行；进程重启后扫描
到期 lease 和 `pending/retry` 任务。Signal 与 Job 必须在同一事务内提交，禁止使用仅存在于
内存的队列作为事实来源。

------------------------------------------------------------------------

## 12. Webhook 安全

### 12.1 公网部署是硬性前提

TradingView 服务器必须访问公网 HTTPS 地址，本地 `localhost` 无法接收 Webhook。Phase 1
必须二选一：

-   推荐：VPS + Nginx/Caddy + Signal Gateway；通知以 Telegram/Feishu 为主；
-   本地模式：受控 HTTPS Tunnel 暴露本地网关；保留 macOS 通知，但把隧道可用性纳入监控。

Webhook 仅使用 443（兼容约束为 80/443），域名必须有有效 TLS，账户必须开启 2FA。
当前不依赖 IPv6。

### 12.2 请求认证

Webhook URL 不应只有公开路径。

建议：

``` text
https://example.com/webhook/tradingview/<random-secret>
```

同时：

-   HTTPS
-   在 TLS 边缘验证 TradingView 客户端证书的完整信任链，再校验 Subject/SAN
-   高熵 URL Secret 作为第二层认证
-   TradingView 官方出口 IP allowlist 作为辅助防线；通过配置更新，不硬编码进业务逻辑
-   Payload Schema Validation
-   按合法 burst 容量设计 Rate Limit，避免对真实信号返回不可重试的 429
-   Body Size Limit
-   日志脱敏
-   Reject unknown schema version
-   Reject unknown event type
-   Reject 明确 disabled 的 Symbol；未知 Symbol 先持久化为 provisional 并暂停分析，触发一次 Watchlist 校验
-   Reject unreasonable `bar_open_time_ms`

如果 TLS 在 Tunnel、反向代理或 API Gateway 终止，必须证明客户端证书身份能安全传递到验证
层；仅匹配一个可伪造的 CN 字符串不构成证书验证。

------------------------------------------------------------------------

## 13. 去重与状态机

简单 cooldown 不足以解决所有重复信号问题。

推荐同时使用：

### Delivery Idempotency

精确投递键用于吸收 TradingView 重发：

``` text
delivery_key = hash(
    alert_instance_id + pine_config_version +
    symbol + timeframe + event + bar_open_time_ms
)
```

### Logical Event Correlation

逻辑事件键用于关联版本迁移期间 V1/V2 对同一市场事件的投递：

``` text
logical_event_key = hash(
    symbol + timeframe + event + bar_open_time_ms
)
```

同一 `delivery_key` 只落一次；同一 `logical_event_key` 可以保留多次原始 delivery，但只由
当前 `pine_config_version` 生成一次分析和一次通知。禁止简单“先到先得”，否则旧版本可能
压掉新版本。Alert 更新优先采用停止旧版、创建新版的受控切换，并记录切换窗口。

### Cooldown

例如：

``` text
same symbol
same timeframe
same event

30 min cooldown
```

### State Machine

例如支撑突破：

``` text
ABOVE_SUPPORT
     │
     │ crossunder
     ▼
BELOW_SUPPORT
     │
     │ 不重复报警
     │
     │ crossover
     ▼
ABOVE_SUPPORT
```

只有重新回到支撑上方以后，再次跌破才产生新的完整事件。

------------------------------------------------------------------------

## 14. 数据库设计

SQLite 启动时必须执行：

``` sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

### symbols

``` sql
CREATE TABLE symbols (
    symbol TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    ticker TEXT NOT NULL,
    market TEXT,
    instrument_type TEXT,
    timezone TEXT,
    currency TEXT,
    industry TEXT,
    data_delay_seconds INTEGER,
    quote_provider_symbol TEXT,
    membership_status TEXT NOT NULL DEFAULT 'pending',
    metadata_status TEXT NOT NULL DEFAULT 'pending',
    enabled INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
```

原生 Watchlist 新增 Symbol 可能先触发 Webhook、后被小时级本地同步发现，因此未知 Symbol 不能
直接丢弃。网关先创建 provisional Symbol 和 Signal，Job 进入 `awaiting_symbol_verification`；
确认属于目标 Watchlist 并补齐元数据后再分析。明确 disabled、越界市场或验证失败的事件只保留
审计记录，不调用 AI。

### alerts

``` sql
CREATE TABLE alerts (
    alert_instance_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    watchlist_name TEXT,
    symbol TEXT,
    timeframe TEXT NOT NULL,
    pine_config_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT,
    last_verified_at TEXT,
    updated_at TEXT NOT NULL,

    CHECK (mode IN ('watchlist', 'symbol'))
);
```

首选模式每个 `watchlist + trigger timeframe` 一行；fallback 模式每个
`symbol + trigger timeframe` 一行。事件类型不再参与 Alert 主键。

### webhook_deliveries

``` sql
CREATE TABLE webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_key TEXT UNIQUE NOT NULL,
    logical_event_key TEXT NOT NULL,
    alert_instance_id TEXT NOT NULL,
    pine_config_version INTEGER NOT NULL,
    raw_payload TEXT NOT NULL,
    authenticated INTEGER NOT NULL,
    received_at TEXT NOT NULL
);

CREATE INDEX idx_deliveries_logical_event
    ON webhook_deliveries(logical_event_key, received_at);
```

### signals

``` sql
CREATE TABLE signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    logical_event_key TEXT UNIQUE NOT NULL,

    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    event TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    selected_pine_config_version INTEGER NOT NULL,
    bar_open_time_ms INTEGER NOT NULL,
    signal_price REAL NOT NULL,

    payload TEXT NOT NULL,

    received_at TEXT NOT NULL,

    analysis_status TEXT NOT NULL DEFAULT 'pending',

    FOREIGN KEY(symbol) REFERENCES symbols(symbol)
);

CREATE INDEX idx_signals_symbol_bar_time
    ON signals(symbol, bar_open_time_ms DESC);
```

### jobs

``` sql
CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL,
    locked_at TEXT,
    locked_until TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    UNIQUE(signal_id, job_type),
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
```

### context_items

``` sql
CREATE TABLE context_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT,
    source TEXT NOT NULL,
    url TEXT,
    published_at TEXT,
    event_at TEXT,
    fetched_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    relevance REAL,
    sentiment REAL,
    source_confidence REAL,
    metadata_json TEXT NOT NULL,

    UNIQUE(signal_id, provider, content_hash),
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
```

### analyses

``` sql
CREATE TABLE analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    signal_id INTEGER NOT NULL,

    sentiment_score REAL,
    confidence_score INTEGER,
    context_quality INTEGER NOT NULL,
    data_freshness_seconds INTEGER,

    ai_provider TEXT NOT NULL,
    ai_model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    rule_version TEXT NOT NULL,

    result_json TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
```

### notifications

建议额外保存通知状态：

``` sql
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    signal_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,

    sent_at TEXT,
    error TEXT,

    UNIQUE(signal_id, channel),
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
```

### signal_outcomes

``` sql
CREATE TABLE signal_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    horizon TEXT NOT NULL,
    target_at TEXT NOT NULL,
    evaluated_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    price REAL,
    raw_return REAL,
    direction_adjusted_return REAL,
    max_favorable_excursion REAL,
    max_adverse_excursion REAL,
    benchmark_symbol TEXT,
    benchmark_return REAL,
    excess_return REAL,
    sector_benchmark_symbol TEXT,
    sector_return REAL,
    sector_excess_return REAL,
    direction_adjusted_excess_return REAL,
    quote_provider TEXT NOT NULL,
    adjustment_mode TEXT NOT NULL,
    error TEXT,

    UNIQUE(signal_id, horizon),
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
```

------------------------------------------------------------------------

## 15. AI Analysis Pipeline

AI **只在 Signal Gateway 收到有效事件后启动**。

流程：

``` text
Signal
  │
  ▼
Technical Context
  │
  ├─────────────┐
  ▼             ▼
Company News   Market Context
  │             │
  ▼             ▼
Industry News  Macro Context
  │             │
  └──────┬──────┘
         ▼
     Sentiment
         │
         ▼
 Signal History
         │
         ▼
    AI Analysis
         │
         ▼
     Rule Engine
         │
         ▼
 Confidence / Context Quality
         │
         ▼
 Notification Policy
```

Worker 必须设置全局和 Provider 级并发上限。Company Context 按 Symbol 缓存，Market/Macro
Context 按 `market + time bucket` 缓存 10--15 分钟，避免开盘 burst 对同一市场重复抓取和
重复调用 AI。缓存条目必须带 `fetched_at`、来源状态和过期时间。

------------------------------------------------------------------------

## 16. 新闻与市场信息

AI 分析时至少收集四层信息。

### 16.0 Phase 1 Provider 契约

实现前必须在配置中列出实际 Provider，不接受“运行时临时搜索任意网页”作为唯一数据源：

-   公司公告优先使用交易所或监管机构官方披露源，例如 HKEXnews、巨潮资讯、SEC EDGAR；
-   新闻限定 1--2 个明确允许 API/程序化访问且覆盖目标市场的来源；
-   行情和 Outcome Tracking 使用独立 Quote Provider，保存其 Symbol 映射、复权方式和延迟；
-   每个 Provider 定义 timeout、rate limit、缓存期、数据许可、降级和健康检查策略。

Provider 的最终选择由 Phase 0 记录为 ADR；未选定的 category 返回 `unavailable`，禁止让模型
补写不存在的事实。

所有 Provider 共享状态 envelope，但保留领域专用请求和数据类型：

``` typescript
interface ProviderResult<T> {
    status: "ok" | "partial" | "unavailable";
    fetchedAt: number;
    source: string;
    data: T[];
    errors: ProviderError[];
}

interface AnnouncementProvider {
    fetch(request: AnnouncementRequest): Promise<ProviderResult<Announcement>>;
}

interface NewsProvider {
    fetch(request: NewsRequest): Promise<ProviderResult<NewsItem>>;
}

interface QuoteProvider {
    fetch(request: QuoteRequest): Promise<ProviderResult<Quote>>;
}

interface MacroProvider {
    fetch(request: MacroRequest): Promise<ProviderResult<MacroObservation>>;
}
```

`source_quality` 不能由 AI 自评；它由 Provider 等级、原始来源、字段完整性、发布时间和抓取状态
通过规则计算。AI 可以判断语义相关性，但不得修改来源身份和确定性质量等级。

### 16.1 Company

例如：

``` text
SMIC latest news
中芯国际 最新消息
00981 announcement
```

关注：

-   财报
-   订单
-   资本开支
-   产能
-   管理层
-   客户
-   监管
-   制裁
-   公司公告
-   券商评级

### 16.2 Industry

根据股票行业动态生成查询。

半导体示例：

-   Foundry
-   AI Chip
-   Semiconductor Equipment
-   Memory
-   Export Controls
-   China Semiconductor

### 16.3 Market

港股：

-   Hang Seng Index
-   Hang Seng TECH
-   CNH
-   DXY
-   US Treasury Yield
-   南向资金（数据源可用时）

A 股：

-   上证
-   深证
-   创业板
-   科创50
-   人民币
-   市场资金面

美股：

-   S&P 500
-   NASDAQ
-   SOX
-   VIX
-   DXY
-   US 10Y

### 16.4 Macro / Event

例如：

-   Fed
-   CPI
-   NFP
-   利率
-   中国政策
-   关税
-   芯片出口限制
-   地缘风险

------------------------------------------------------------------------

## 17. 新闻数据质量

这是需要 Reviewer 重点评估的部分。

新闻源必须保留：

``` text
title
source
published_at
url
symbol relevance
category
fetched_at
content_hash
provider
```

AI 不应该仅根据标题判断。

需要：

1.  去重；
2.  判断发布时间；
3.  判断是否真正与该公司相关；
4.  区分事实报道与评论；
5.  优先公司公告、监管披露、权威媒体；
6.  对低质量转载降低权重。
7.  使用 canonical URL、内容哈希和标题相似度联合去重；
8.  区分事件发生时间、原始发布时间和转载抓取时间。

必须避免"旧新闻被重新转载"导致情绪判断错误。

------------------------------------------------------------------------

## 18. Sentiment Model

建议统一范围：

``` text
-2.0 → Strong Negative
-1.0 → Negative
 0.0 → Neutral
+1.0 → Positive
+2.0 → Strong Positive
```

每条信息返回：

``` json
{
  "sentiment": -1.5,
  "relevance": 0.95,
  "confidence": 0.86,
  "category": "company"
}
```

`sentiment` 表示消息本身的方向，不直接等于对当前交易信号的支持程度。规则引擎按事件方向
转换：

``` text
signal_direction = +1  // long event
signal_direction = -1  // short event

directional_alignment = normalized_sentiment * signal_direction
```

因此负面新闻会确认空头事件、削弱多头事件。转换公式、裁剪范围和缺失值处理必须进入
`rule_version`，由确定性代码执行。

初始聚合权重：

``` text
Company       40%
Industry      25%
Market        20%
Macro         15%
```

这些权重必须放配置文件，不写死在代码。

------------------------------------------------------------------------

## 19. Signal Confidence

目标不是让 AI 简单回答：

``` text
BUY / SELL
```

而是评估：

``` text
这个 TradingView 技术信号有多值得关注？
```

初始评分：

``` text
Technical Consistency        30
Volume Confirmation          20
Higher Timeframe Alignment   20
Market Environment           15
News Sentiment               15
────────────────────────────────
Total                       100
```

从 MVP 起由 Rule Engine 计算最终分数。AI 只输出有 Schema 约束的事实摘要、新闻情绪、市场
解读、风险因素及各自置信度，不直接决定最终 `confidence_score`。

AI 输出契约至少为：

``` json
{
  "company_sentiment": -0.8,
  "industry_sentiment": -0.4,
  "market_sentiment": -0.6,
  "macro_sentiment": 0.0,
  "company_relevance": 0.94,
  "risk_factors": [],
  "summary": "..."
}
```

Schema 中禁止出现 `confidence_score`、`source_quality` 或通知决策。Rule Engine 使用 AI 的
分类情绪与相关性，加上程序计算的技术指标、Provider 来源质量和数据新鲜度，生成
`news_alignment_score`、`market_alignment_score`、`context_quality` 和最终分数。

同时输出三个互不混淆的维度：

``` text
signal_confidence    0..100  // 已获得证据对该方向信号的支持程度
context_quality      0..100  // 数据源完整性和可信度
data_freshness_seconds       // 从信号发生到分析完成的时延
```

新闻不可用是证据缺失，只降低 `context_quality`，不能当作负面证据直接降低
`signal_confidence`。通知策略可以对低质量上下文使用更高门槛或显式降级标签。

分类：

``` text
0–39    Noise
40–59   Weak
60–74   Worth Watching
75–89   High Quality
90–100  Very Strong Confirmation
```

------------------------------------------------------------------------

## 20. Notification Policy

默认：

``` text
confidence < 60
→ 保存分析
→ 不通知

60–74
→ 普通通知

>= 75
→ 高优先级通知
```

阈值必须可配置。

示例：

``` yaml
notification:
  min_confidence: 60
  high_priority_confidence: 75
```

### 20.1 时效与 Burst 策略

-   通知必须同时展示信号时间、分析完成时间和数据延迟；
-   超过 `max_analysis_age_minutes` 的结果降级为延迟摘要，不再作为即时高优先级提醒；
-   同一市场在 `digest_window_minutes` 内集中出现多个信号时合并为摘要；
-   单个高价值信号是否绕过聚合由确定性规则配置；
-   通知限流不能丢弃记录，所有 suppressed/digested 状态必须持久化。

------------------------------------------------------------------------

## 21. AI 输出格式

AI 必须输出结构化 JSON，同时生成适合人的摘要。

示例：

``` text
【981 中芯国际】

事件
15m 跌破第一支撑 61.30

现价
61.20

技术面
强空 -6/7
日线偏空
MACD 空头
RSI 34.2
成交量 1.72x

关键位置
下一支撑：58.30
第一压力：63.00
第二压力：64.70

市场环境
恒生科技偏弱
半导体板块偏弱
风险偏好下降

新闻
过去24小时发现 3 条高相关信息
...

新闻情绪
-1.2 / 2
偏空

Signal Confidence
83 / 100
High Quality

支持因素
1. 技术面空头一致
2. 跌破伴随放量
3. 日线方向一致
4. 行业情绪偏弱

反向风险
若快速重新站回 63 并伴随放量，
本次跌破可能是假突破。
```

不要输出确定性的：

``` text
一定上涨
一定下跌
```

------------------------------------------------------------------------

## 22. Signal History

AI 必须获得该股票最近若干次事件。

例如：

``` text
09-10
BREAK_EMA200
67.90

09-11
BREAK_SUPPORT_1
61.30
```

AI 可以判断：

``` text
当前跌破并非孤立事件，
此前已经发生趋势恶化。
```

MVP 建议输入：

``` text
latest 10 signals
```

后续可以加入：

-   最近一次相同事件
-   最近一次反向事件
-   事件发生后的实际价格表现

------------------------------------------------------------------------

## 23. Alert Reconciler

Phase 0 验证通过后，首选模式只维护少量 Watchlist Alert，不进行逐 Symbol 对账。

逻辑：

``` text
Expected Watchlist Alerts
      │
      ▼
TradingView Actual Alerts
      │
      ▼
      Diff
 ┌────┼─────┐
 ▼    ▼     ▼
Add  Keep  Roll Version / Expiration
```

同时检查：

``` text
pine_config_version
```

如果：

``` text
Expected Version = 2
Actual Version   = 1
```

则：

``` text
mark stale
→ recreate alert
```

Watchlist Alert 不支持 Open-ended，必须记录 `expires_at` 并在到期前滚动重建。重建流程需要：

1.  创建并验证新 Alert；
2.  切换 `current_pine_config_version`；
3.  停止旧 Alert；
4.  使用 `logical_event_key` 合并短暂重叠窗口内的事件；
5.  对缺失、limited functionality、fire-control 和过期状态通知管理员。

若自动化重建未经验证足够安全，MVP 只做提前提醒和人工重建，不扩大 Playwright 权限。

------------------------------------------------------------------------

## 24. Playwright 稳定性要求

浏览器自动化是系统最脆弱部分，因此必须：

-   优先 role / text / accessible selector
-   避免依赖随机 CSS class
-   timeout
-   retry
-   failure screenshot
-   structured logs
-   操作前确认页面状态
-   操作后验证结果
-   DOM 不符合预期时 fail closed

**禁止"猜测按钮然后继续点击"。**

特别是任何可能涉及：

``` text
Buy
Sell
Trade
Order
```

的区域，一律不得自动操作。

------------------------------------------------------------------------

## 25. Observability

至少提供：

### Logs

``` text
watchlist.sync
alert.reconcile
webhook.received
signal.duplicate
analysis.started
analysis.completed
notification.sent
notification.failed
```

### Metrics

后续可增加：

``` text
signals_received_total
signals_deduplicated_total
analysis_latency
news_fetch_latency
notifications_total
playwright_failures_total
webhook_auth_failures_total
jobs_pending
jobs_retry_total
oldest_pending_job_age
alert_expires_in_seconds
heartbeat_age_seconds
context_cache_hit_ratio
notification_digest_size
```

### Health Check

``` text
GET /health
```

返回：

``` json
{
  "status": "ok",
  "db": "ok",
  "worker": "ok"
}
```

### Heartbeat / Canary

链路安静不能自动解释为“没有信号”。至少配置一条 market-aware canary，通过同一 TradingView
Alert/Webhook 路径发送 `HEARTBEAT` 内部事件。网关结合交易日历、目标市场交易时段和行情
状态判断期望心跳；休市、停牌或无实时 bar 不得误报为网关故障。

同时独立监控公网 HTTPS、数据库、Worker、Tunnel/VPS 和 Alert 到期。若能力允许，定期读取
TradingView Alert Log/Webhook status 作为投递侧证据。

------------------------------------------------------------------------

## 26. 配置文件

`config/monitor.yaml` 示例：

``` yaml
watchlist:
  sync_interval_minutes: 60

deployment:
  mode: "vps" # vps | tunnel

alerts:
  preferred_mode: "watchlist"
  expiration_renew_before_days: 7
  current_pine_config_version: 1

markets:
  HK:
    allowed_data_delay_seconds: 0
  CN:
    allowed_data_delay_seconds: 0

timeframes:
  trigger:
    - "15m"
  context:
    - "1D"

signal:
  cooldown_minutes: 30
  max_bar_age_minutes: 30

worker:
  concurrency: 4
  lease_seconds: 300
  max_attempts: 5

cache:
  market_context_minutes: 15
  company_context_minutes: 10

providers:
  announcements: "TBD_BY_PHASE_0_ADR"
  news: "TBD_BY_PHASE_0_ADR"
  quotes: "TBD_BY_PHASE_0_ADR"

rules:
  version: "v1"

sentiment:
  company_weight: 0.40
  industry_weight: 0.25
  market_weight: 0.20
  macro_weight: 0.15

notification:
  min_confidence: 60
  high_priority_confidence: 75
  min_context_quality: 50
  max_analysis_age_minutes: 15
  digest_window_minutes: 5

heartbeat:
  enabled: true
  max_age_minutes: 60

history:
  recent_signals: 10
```

Secret 只通过环境变量：

``` text
AI_API_KEY
TELEGRAM_BOT_TOKEN
FEISHU_WEBHOOK
TRADINGVIEW_WEBHOOK_SECRET
```

`.env` 必须加入 `.gitignore`。

------------------------------------------------------------------------

## 27. 实施阶段

### Phase 0 --- Feasibility Gates

在写完整业务实现前完成可丢弃的纵向 Spike：

``` text
Watchlist Alert
  + Custom Pine alert()
  + per-symbol Dynamic JSON
  + Public HTTPS / Authentication
  + SQLite Commit
```

验收：

1.  列表新增/删除自动生效；
2.  混合市场、停牌、无权限 Symbol 行为明确；
3.  并发触发、到期和重建行为可观测；
4.  HK/A/US 目标市场行情实时权限已记录；
5.  部署模式与公告、新闻、Quote Provider 已形成 ADR。

#### GATE-TV-01：Watchlist Alert 架构分叉

``` text
PASS
→ Watchlist Alert 能执行自定义 Pine alert()
→ symbol / event / timeframe 按每个成员独立求值
→ 动态 JSON 是合法、可解析且与实际触发 Symbol 一致
→ 新增/删除成员、异常成员、到期和 limited functionality 均可观测
→ 公网入口在持久化后于内部 1 秒预算内返回 2xx
→ Phase 1 只实现 watchlist mode

FAIL
→ 记录失败证据和 TradingView 账户/版本环境
→ 若普通技术 Alert 与 Webhook 均可用：Phase 1 只实现 per-symbol aggregated alert mode
→ 每个 symbol + trigger timeframe 一条 Alert
→ 若普通技术 Alert 或 Webhook 不可用：STOP，不得开始依赖 TradingView 信号面的 Phase 1
```

Gate 结果必须形成 ADR。不得在 Phase 1 中继续“边开发边验证”，也不得同时实现两条主路径。

#### 2026-09-11 实测结果

当前测试账户为 TradingView Basic，GATE-TV-01 判定为 **FAIL / ENTITLEMENT BLOCKED**：

-   Watchlist 菜单存在 `Add alert on the list…`，但操作后提示 Watchlist Alert 仅升级计划可用；
-   普通技术 Alert 保存失败，页面明确显示当前计划技术 Alert 上限为 `0`；
-   Webhook URL 选项可见但不可启用，操作后提示 Webhook 仅升级计划可用；
-   自定义 Pine 已保存并挂载，Alert 条件能选择 `Any alert() function call`，但无法创建服务端
    Alert，因此不能验证真实运行时的 per-symbol 动态求值；
-   `HKEX:981` 在界面明确显示 `Quotes are delayed by 15 min`，当前 entitlement 不满足港股实时监控。

接收网关、SQLite 原子 outbox、幂等处理以及公网 HTTPS POST 已独立验证通过，但这些组件级
PASS 不能替代 TradingView 端到端 PASS。Phase 1 在当前订阅下保持 STOP。升级后只需重跑
服务端 Alert 创建、真实触发、Watchlist 成员变更和 webhook 入库检查；详细证据与步骤见
`docs/adr/0001-gate-tv-01.md`。

该 STOP 只约束依赖 TradingView 服务端 Alert/Webhook 的实时信号链，不阻止本地研究功能继续
开发。当前账户可使用独立的本地分析路径：Quote Provider 拉取已确认 OHLCV，确定性代码计算
指标、冻结结构位和统计，随后可选地把精简后的结构化技术结果提交 AI。API key 只能从运行环境
读取，禁止写入 YAML、数据库、报告或日志；调用默认不允许服务端持久化。AI 输出使用严格
Schema，负责总结、场景和风险，不得生成最终 `confidence_score`，也不得补写输入中不存在的
新闻、公告或基本面事实。

### Phase 1 --- End-to-End MVP

目标：先证明核心链路可靠。

实现：

``` text
Native Watchlist Alert
        +
Optional Watchlist Audit
        +
Pine Alert
        +
TradingView Webhook
        +
Signal DB
        +
News / Market Context
        +
AI Analysis
        +
Notification
```

Alert 暂时由用户手动创建。

MVP 限定一个市场、一个 15m 触发周期和 3--5 只股票。若 Watchlist Alert Spike 成功，只需
手工创建一条聚合 Alert。

验收标准：

1.  能正确同步或审计 Watchlist；
2.  TradingView Alert 在健康链路中能到达 Webhook，重复和缺失场景均可观测；
3.  重复事件不会重复处理；
4.  AI 只在事件发生后调用；
5.  新闻带来源和时间；
6.  AI 能生成结构化分析；
7.  Notification Threshold 正常工作；
8.  全链路失败可追踪。
9.  Signal 与 Job 同事务持久化，重启可恢复；
10. 规则引擎方向化评分稳定且带版本；
11. Heartbeat、任务积压和 Alert 到期可告警；
12. 开盘 burst 不会突破 Provider 并发限制或产生通知风暴。

### Phase 2 --- Alert Lifecycle Automation

实现：

-   Watchlist Alert 到期前滚动重建
-   自动检测缺失、停止或 limited functionality
-   Pine Version Reconciliation
-   仅在 Watchlist Alert 不可用时启用逐 Symbol fallback

### Phase 3 --- Intelligence

实现：

-   更完整市场情绪
-   新闻质量排序
-   Signal History
-   每日复盘
-   Outcome 报表与 Confidence Calibration
-   Web Dashboard

------------------------------------------------------------------------

## 28. Signal Outcome Tracking（MVP 数据采集）

为了以后判断系统到底有没有价值，建议从一开始记录信号发生后的价格。

例如：

``` text
Signal Time
T + 1h
T + 4h
T + 1D
T + 3D
T + 5D
```

计算：

``` text
return_1h
return_4h
return_1d
return_3d
return_5d

max_favorable_excursion
max_adverse_excursion
```

MVP 必须保存完整 Signal、精确 `bar_open_time_ms`、信号价、方向、Provider 和复权语义，并至少
实现一种策略：

-   当天运行轻量 Quote Snapshot Job，保留盘中 T+1h/T+4h 与 MFE/MAE；或
-   明确接受分钟历史窗口限制，只保证可回补的日线 T+1D/T+3D/T+5D。

`T+N` 按目标交易所交易日历和有效交易时段计算，不按简单墙钟；停牌、午休、跨日、公司行动、
复权和缺失行情必须有显式状态。多空事件同时保存 raw return 与 direction-adjusted return。

每个市场在配置中指定市场基准和可选行业基准，并使用与标的相同的起止时刻、交易日历、币种
处理和复权口径：

``` text
excess_return = asset_return - benchmark_return
sector_excess_return = asset_return - sector_return
direction_adjusted_excess_return = signal_direction * excess_return
```

缺少行业基准时保留 `null`，不能用大盘基准伪装成行业基准。Outcome 评估必须能分别回答绝对
收益、相对市场超额收益和相对行业超额收益。

这样未来可以回答：

``` text
过去100次 BREAK_SUPPORT_1：

在日线偏空 + 放量情况下，
未来3日继续下跌概率是多少？
```

这比凭感觉修改 AI Prompt 或评分权重可靠得多。

------------------------------------------------------------------------

## 29. MVP 必需：规则评分与 AI 分离

从 MVP 起：

``` text
Confidence Score
```

尽量由确定性代码计算。

AI 输出：

``` text
news sentiment
market interpretation
risk factors
reasoning summary
```

程序负责：

``` text
technical score
volume score
higher timeframe score
final weighted score
threshold
```

这样：

-   可回测
-   可解释
-   可复现
-   不会因为模型版本变化导致同样输入评分大幅漂移

AI 是"信息理解器"，而不是整个系统唯一的决策器。

------------------------------------------------------------------------

## 30. Failure Strategy

### TradingView 不可访问

``` text
Watchlist Sync failed
→ 保留现有 symbols
→ 不删除任何监控
→ 告警管理员
```

### Webhook / Tunnel 不可访问

``` text
Public health check 或 Canary 超时
→ 立即告警管理员
→ 标记 monitoring_degraded
→ 恢复后对照 Alert Log 审计缺失窗口
```

Webhook 只能保证尽力投递。部分 5xx 可能收到有限重发，4xx、504 和超时不应假定会重发。

### Playwright DOM 改变

``` text
Fail Closed
→ screenshot
→ log
→ 不执行任何 destructive action
```

### News Provider 失败

继续技术分析，但标记：

``` text
news_context = unavailable
```

降低 `context_quality` 并标记数据缺失，而不是伪造新闻判断或把缺失当成反向证据。

### AI Provider 失败

Signal 仍然保存：

``` text
analysis_status = retry
```

后台重试。

Worker 超过 `locked_until` 未完成时由其他 Worker 回收；达到 `max_attempts` 后进入
`dead_letter` 并通知管理员，禁止永远停留在 `pending`。

### Notification 失败

分析结果仍保存在 DB，Notification Worker 单独重试。

### 行情或上下文延迟

``` text
data_delay_seconds > allowed_delay
或 analysis_age > max_analysis_age
→ 保留分析
→ 标记 delayed / degraded
→ 不发送即时高优先级通知
```

### Alert 到期或功能受限

到期前主动提醒或滚动重建；检测到 stopped、limited functionality 或 fire-control 时告警，
不得把该状态解释为“市场没有信号”。

------------------------------------------------------------------------

## 31. Review 决策记录

本轮 Review 已固化以下决定：

1.  原生 Watchlist Alert 是首选；逐 Symbol 聚合 Alert 仅为验证失败后的 fallback；
2.  公网 HTTPS、2FA、行情 entitlement 和 Provider 选型是 Phase 0 门禁；
3.  Webhook 按 at-least-once/possible-loss 现实建模，使用双层事件身份和 durable outbox；
4.  Pine 只发收盘确认事件，HTF 使用已收盘值，S/R 使用已确认冻结 level；
5.  Watchlist Alert 必须跟踪到期、功能受限和版本迁移；
6.  AI 不计算最终分数；Rule Engine 负责方向化、可版本化、可回测的 Confidence；
7.  缺失上下文降低 `context_quality`，不等价于反向证据；
8.  SQLite 足以支撑 MVP，但必须启用 WAL、外键、索引、lease 和重试；
9.  Outcome Tracking 从 MVP 开始采集必要数据；
10. Heartbeat、burst 缓存、Worker 并发、通知聚合和分析时效均进入 MVP。

Phase 0 后仍需通过 ADR 回填的开放项只有：部署供应商、具体新闻/公告/Quote Provider、目标市场
和账户实测限制。它们未确定前不得把对应能力标记为 ready。

------------------------------------------------------------------------

## 32. 最终职责边界

``` text
┌────────────────────┬──────────────────────────────┐
│ Component          │ Responsibility               │
├────────────────────┼──────────────────────────────┤
│ TradingView        │ 行情、图表、Alert Runtime     │
│ Pine               │ 技术指标、事件检测            │
│ Watchlist Alert    │ 动态覆盖列表与运行 Alert        │
│ Playwright         │ 可选审计 / Alert 生命周期维护   │
│ Signal Gateway     │ 接收、校验、去重、持久化       │
│ Durable Worker     │ Lease / Retry / Outcome Jobs   │
│ Market Collectors  │ 新闻、公告、指数、宏观         │
│ AI                 │ 信息理解、情绪、综合研判       │
│ Rule Engine        │ Confidence / Notification     │
│ SQLite             │ 状态与历史                    │
│ Notifier           │ 用户通知                      │
└────────────────────┴──────────────────────────────┘
```

核心数据流：

``` text
Watchlist
    ↓
Watchlist Alert + Pine
    ↓
Event
    ↓
Webhook
    ↓
Transactional Outbox
    ↓
Context Collection
    ↓
AI
    ↓
Rule-based Confidence
    ↓
Notification
    ↓
Outcome Tracking
```

------------------------------------------------------------------------

## 33. 一句话总结

> **这是一个事件驱动的股票监控系统：TradingView/Pine
> 负责发现"发生了什么"，AI
> 负责理解"为什么发生、是否值得关注"，规则引擎决定"要不要打扰用户"，历史数据最终用于验证整套系统到底有没有预测价值。**

------------------------------------------------------------------------

## 34. 外部约束参考

以下约束在实现前仍需按当时官方文档和账户实测复核：

-   [Watchlist Alerts 官方说明](https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/)
-   [Alert 配置与 Watchlist Open-ended 限制](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)
-   [Pine Alerts 执行与脚本快照语义](https://www.tradingview.com/pine-script-docs/concepts/alerts/)
-   [Webhook 配置、端口、超时、IPv6、2FA 与出口 IP](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)
-   [Webhook 客户端证书认证](https://www.tradingview.com/support/solutions/43000680459-webhook-authentication/)
-   [Webhook 官方重发规则](https://www.tradingview.com/support/solutions/43000735201-webhook-resubmission/)
-   [Webhook 错误语义](https://www.tradingview.com/support/solutions/43000776894-what-do-errors-mean-when-sending-webhooks/)
