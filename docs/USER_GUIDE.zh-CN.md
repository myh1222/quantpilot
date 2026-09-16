# QuantPilot 使用指南

## 1. 启动前端

需要 Node.js 20 或更高版本。首次使用，在项目目录安装依赖：

```bash
cd /Users/mengyihua/code/08-quantpilot
npm install
```

启动本地界面：

```bash
npm run ui
```

终端出现 `QuantPilot 已启动：http://127.0.0.1:8787` 后，用浏览器打开：

<http://127.0.0.1:8787>

终端保持运行。使用结束后回到终端按 `Ctrl+C` 停止服务。

## 2. 运行一次技术分析

1. 在左侧选择股票。默认配置包含 `HKEX:981`。
2. 选择 K 线周期和回看天数。15 分钟、30 天是推荐起点。
3. 暂时关闭“AI 深度研判”。
4. 点击“运行分析”。

页面会显示：

- K 线、EMA20、EMA50；
- 当前仍有效的冻结支撑位 S1/S2 和压力位 R1/R2；
- RSI14、ATR14、成交量比；
- 确定性技术评分及逐条评分依据；
- 结构位确认、触碰、突破和失效统计。

技术评分由本地规则计算，并不由 AI 决定。

### 缝合 TradingView Pine 指标

这个功能不需要 TradingView Alert。首次使用时：

1. 把仓库中的最新版 `pine/quantpilot-structure-analysis.pine` 保存到 TradingView，并挂到图表；
2. 在终端运行 `npm run tradingview:open`，在打开的系统 Chrome 专用窗口中登录；
3. 在打开的专用 Chrome 窗口中登录，完成后回终端按 `Ctrl+C`；
4. 把 `config/monitor.yaml` 中的 `tradingView.enabled` 改为 `true`，重新启动 UI；
5. 分析时保持“缝合 TradingView 指标”开启。

QuantPilot 会读取 Pine Data Window 中的最新已确认快照，并与本地 K 线按股票、周期和 Bar 时间对齐。读取失败时仍完成本地分析，并在报告顶部显示降级原因。不要同时运行两个使用 `data/tradingview-profile` 的程序。

## 3. 使用 AI 研判

1. 打开“AI 深度研判”。
2. 填写用户自己的 API Key，或者使用本机 Keychain/环境变量中已经配置的 Key。
3. 选择 API 类型并填写模型名称。
4. 使用 OpenAI 时选择 Responses API，并保持 Base URL 为 `https://api.openai.com/v1`。
5. 若关联了持仓，明确勾选是否允许把持仓字段提交给 AI。
6. 点击“运行分析”。

AI 接收的是本地已经处理好的指标、冻结结构位、统计、规则研判，以及成功读取时的 TradingView Pine 快照。它不接收浏览器 Cookie，也不会自行抓取或编造新闻。AI 输出只包括条件研判、关键观察、风险和数据局限，不负责最终技术评分。

### API Key 如何处理

- Key 不会写入 `config/monitor.yaml`；
- Key 不会写入 SQLite；
- Key 不会写入分析结果；
- 页面不使用 localStorage 或 Cookie 保存 Key；
- 页面 Key 只存在于当前页面输入框和本机 Node 进程处理该次请求时的内存中；
- Keychain/环境变量 Key 只能发送到 `config/monitor.yaml` 预设的 Provider；
- 自定义 Base URL 必须同时提供本次请求自己的 Key；
- 持仓默认不提交 AI。授权后会提交当前持仓、同账户其他聚合持仓、各币种现金余额和风险参数，但不会提交账户名称、数据库 ID 或现金备注。

如果 AI 请求失败，本地技术分析仍会正常展示，页面会单独显示 AI 错误。

兼容 Chat Completions 的模型如果首次返回了错误字段（例如只有 `stance/reason`），QuantPilot 会要求模型按研判 JSON Schema 自动修复一次。再次失败时页面只显示简洁的协议错误，不再暴露内部校验详情。

“继续追问”只在本机环境变量或 Keychain 已配置服务端 Key 时启用。追问使用一小时内有效的本机分析会话 ID，不接受浏览器回传的分析正文作为可信上下文；页面临时 Key 不会为了追问而保存。

## 4. 自选股、账户、现金与仓位

顶部“自选股”可以按中文名称或代码搜索并长期保存常用股票。股票代码会在服务端规范化，例如 `0981.HK` 保存为 `HKEX:981`，减少同一股票产生多个身份。

顶部“账户”用于先创建一个或多个投资账户。账户可以暂时没有资产，也可以包含 0 到多个股票持仓和 0 到多个不同币种的现金余额。账户本身保存基础币种，以及可选的参考净值和单笔风险预算。

同一账户、同一币种保存一条聚合现金余额。不同币种不会在缺少汇率数据时强行相加。

顶部“仓位”用于把股票关联到一个已有账户，可以保存：

- 股票、所属账户、方向、数量、平均成本和币种；
- 止损、目标价、建仓日期和持仓逻辑；

参考净值和风险预算用于计算仓位占净值和止损风险占净值。币种不一致时这些比例显示为空，不会猜测换算。仍有关联持仓的账户或自选股不能删除，必须先处理持仓。详细设计见 [`PORTFOLIO_ACCOUNT_DESIGN.zh-CN.md`](PORTFOLIO_ACCOUNT_DESIGN.zh-CN.md)。

### 添加其他股票

在股票下拉框选择“自定义股票”，填写：

- 显示代码：报告中希望显示的代码，例如 `NASDAQ:AAPL`；
- Yahoo 行情代码：Yahoo Finance 使用的代码，例如 `AAPL`。

常见示例：

| 市场 | 显示代码 | Yahoo 行情代码 |
| --- | --- | --- |
| 港股 | `HKEX:981` | `0981.HK` |
| 上证 A 股 | `SSE:600519` | `600519.SS` |
| 深证 A 股 | `SZSE:000001` | `000001.SZ` |
| 美股 | `NASDAQ:AAPL` | `AAPL` |

也可以把初始股票加入 `config/monitor.yaml` 的 `localAlerts.symbols`，重启前端后会补充到自选股数据库。

## 5. TradingView 指标

TradingView 图表 `AKITEcJL` 已保存 `QuantPilot Structure & Analysis`。指标会绘制：

- EMA20/50/200；
- 前一日高点和低点；
- 已确认的 Pivot 冻结支撑/压力；
- 结构统计面板。

突破标签默认关闭，以免历史标签遮挡图表。可以在指标设置中打开 `Show break labels`。

TradingView 和本地前端使用相同设计原则，但行情提供方不同，价格、K 线切分或延迟可能导致结构位存在小幅差异。

## 6. 常见问题

### 页面打不开

确认运行 `npm run ui` 的终端仍然开着，并访问 `http://127.0.0.1:8787`，不要使用 HTTPS。

### 提示有效 K 线不足

EMA200 至少需要 200 根有效 K 线。增加回看天数，或改用更短周期。

### Yahoo 行情获取失败

检查 Yahoo 行情代码和网络连接。Yahoo 目前是可替换的数据 Provider，不保证实时性、可用性或特定交易所的数据授权。

### API Key 正确但 AI 失败

检查 API 类型、模型名称、账户余额、API 权限和 Base URL。这里需要 API 平台的 Key，不是 ChatGPT 网页账户密码。若使用本机预设 Key，页面里修改的 Base URL 不会覆盖服务端安全配置。

### TradingView 指标读取失败

先运行 `npm run tradingview:open`，保持这个专用 Chrome 窗口打开，再确认图表已经挂载最新版 QuantPilot Pine。若提示找不到 Data Window，可能是 TradingView UI 已变化，需要更新只读选择器；本地分析不受影响。

### 这是交易建议吗

不是。结果是技术研究辅助。行情可能延迟，结构规则也存在失效场景，交易前需要结合实时行情、公告、基本面和风险承受能力独立判断。
