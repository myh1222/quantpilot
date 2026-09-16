# TradingView Pine 按需查询与多源缝合设计

## 1. 决策

QuantPilot 增加一个不依赖 TradingView Alert/Webhook 的查询面。在用户主动运行分析时，系统使用独立、持久化且已登录的 Chrome Profile 打开 TradingView，读取 Pine 指标在 Data Window 中暴露的结构化快照。

该能力用于补充 Pine 自定义指标结果，不替代历史行情 Provider：

- TradingView/Pine：自定义结构位、趋势、指标状态和结构统计；
- Quote Provider：完整已确认 K 线、本地图表和可回测统计；
- QuantPilot：自选股、账户风险参数和持仓；
- AI Provider：只解读以上结构化事实，不生成最终技术分。

## 2. 请求链路

```text
用户点击“运行分析”
  ├─ Quote Provider 拉取历史 K 线并运行确定性规则
  └─ TradingViewSnapshotProvider 串行打开目标 Symbol/周期
       ├─ 验证登录态
       ├─ 打开 Data Window
       └─ 读取 QP_* Pine 字段
                ↓
按 symbol + timeframe + confirmed bar_time 对齐
                ↓
本地报告 + Pine 快照 + 持仓（需用户授权）提交 AI
```

TradingView 查询失败不得使本地分析失败。结果必须显式返回 `disabled`、`unavailable` 或 `completed`，页面不得静默伪装成已经缝合。

## 3. Pine 快照契约

Pine 使用 `display.data_window` 暴露固定名称的数值字段。实时 K 线期间统一输出上一根已确认 K 线，避免把盘中漂移值交给 AI。

必需字段：

- `QP_BAR_TIME_S`、`QP_CLOSE`；
- `QP_EMA20`、`QP_EMA50`、`QP_EMA200`；
- `QP_RSI14`、`QP_ATR14`、`QP_VOLUME_RATIO`；
- `QP_DAILY_TREND`、`QP_SCORE`；
- `QP_SUPPORT1/2`、`QP_RESISTANCE1/2`；
- S1/R1 确认时间及结构确认、触碰、突破计数；
- `QP_SCRIPT_VERSION`。

字符串状态使用稳定整数编码。字段或语义改变时必须增加脚本版本。

## 4. 对齐规则

QuantPilot 不覆盖本地规则结果，而是附加来源和一致性：

- 收盘价绝对差不超过本地收盘价的 0.5%；
- Bar 开盘时间差不超过 60 分钟；
- 两项均满足记为 `matched`，否则记为 `diverged`；
- AI 必须收到 alignment，不能把不同数据口径当成同一事实。

后续应按市场交易时段把 60 分钟阈值细化为一个 Bar 周期，并显式处理午休、停牌和延迟行情。

## 5. 浏览器生命周期

- Profile 默认目录：`data/tradingview-profile`，已由 `.gitignore` 排除；
- 首次运行 `npm run tradingview:open`，用户在系统 Chrome 专用 Profile 中手动登录并挂载最新版 Pine；分析期间保持该窗口打开，Provider 通过仅监听本机的 CDP 端口连接；
- UI 进程启用 Provider 后复用一个浏览器 Context；
- 同一 Profile 的读取任务串行执行，防止多个请求互相切换 Symbol；
- 登录失效、指标缺失、Data Window DOM 改版均 fail closed，并降级到本地分析；
- `QP_SCRIPT_VERSION` 必须与 `tradingView.expectedScriptVersion` 一致，避免旧 Pine 输出被误读；
- 不调用 TradingView 私有 WebSocket/内部接口，不识别 Canvas 像素。
- Chrome 调试端口固定绑定 `127.0.0.1:9223`，不得暴露到局域网或公网。

这是低频、只读、用户主动触发的控制面自动化。TradingView UI 和服务条款变化仍可能要求人工更新选择器或停用该能力。

## 6. AI 与隐私边界

- Keychain/环境变量密钥只能发送到服务端配置的 Base URL、模型和 API 类型；
- 自定义 Base URL 必须使用本次请求输入的 Key；
- TradingView Cookie 只存在专用浏览器 Profile，不提交给 AI；
- 持仓默认只在本地计算，用户明确勾选后才提交；
- 提交持仓时去除账户名称和数据库 ID；
- 技术最终分始终由本地规则计算，AI Schema 禁止额外 confidence 字段。

## 7. 失败策略

| 失败 | 行为 |
| --- | --- |
| 未登录 TradingView | 返回 `unavailable`，提示运行登录命令 |
| 指标或 `QP_*` 字段缺失 | 返回 `unavailable`，提示更新 Pine |
| UI 选择器失效 | 返回 `unavailable`，不读取猜测值 |
| 数据源不一致 | 保留两份数据并标记 `diverged` |
| AI 失败 | 本地报告和 TradingView 快照照常显示 |
| Quote Provider 失败 | 当前分析失败，因为历史图表和规则仍依赖 K 线 |

## 8. 验收标准

1. 未启用 TradingView 时，现有本地分析行为不变；
2. 未登录或 DOM 变化时，分析成功但快照显示降级原因；
3. 登录后能读取全部 `QP_*` 字段，并校验脚本版本；
4. AI 请求包含快照和对齐信息，但不包含 TradingView Cookie、账户名称或 API Key；
5. 并发分析不会串 Symbol；
6. 删除仍有关联持仓的自选股返回 409；
7. Keychain 密钥不会被请求中的自定义 Base URL 带走。

## 9. 已知边界

当前实现是按需分析，不提供后台连续告警。TradingView Basic 可以运行 Pine 和显示 Data Window，因此适合该路径；如未来升级套餐，Alert/Webhook 可作为实时事件面，与本查询面并存。
