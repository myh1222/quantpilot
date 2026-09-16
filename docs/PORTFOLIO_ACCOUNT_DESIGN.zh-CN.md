# QuantPilot 账户、现金与持仓模型

## 1. 设计决策

账户是独立聚合根，不再作为持仓上的自由文本字段。关系固定为：

```text
Account 1 ── 0..N Position
Account 1 ── 0..N CashBalance
WatchlistItem 1 ── 0..N Position
```

可编辑 ER 图见 [`diagrams/portfolio-account-domain.drawio`](diagrams/portfolio-account-domain.drawio)，预览见 [`diagrams/portfolio-account-domain.drawio.png`](diagrams/portfolio-account-domain.drawio.png)。

## 2. 实体语义

### Account

- 可以在没有现金、没有持仓时独立存在；
- `name` 全局唯一，`base_currency` 必填；
- `reported_equity` 是用户提供的参考净值，不从多币种资产中猜测；
- `risk_budget_percent` 是账户级单笔风险预算；
- 有持仓时禁止删除。无持仓账户删除后，其现金记录级联删除。

### CashBalance

- 每个账户可以没有现金，也可以持有多个币种的现金；
- 同一账户、同一币种只有一条聚合余额，金额允许为 0；
- 不自动进行汇率换算，现金备注仅保存在本机，不提交 AI。

### Position

- 必须属于一个已有账户和一个自选股；
- 当前按“账户 + 股票”保存一条聚合仓位，而不是逐成交批次；
- 保存方向、数量、平均成本、币种、止损、目标价、建仓日期和持仓逻辑；
- 自选股仍有关联持仓时禁止删除。

## 3. 估值与风险口径

选中某条持仓分析时：

- 当前持仓的市值和浮盈亏使用本次行情 Provider 的已确认收盘价；
- 其他持仓只向 AI 提供方向、数量、平均成本和风险位，不伪造其实时市值；
- 只有持仓币种等于账户基础币种，且用户填写了参考净值时，才计算仓位/净值和止损风险/净值；
- 多币种现金分别展示，不直接相加；引入明确 FX Provider 前不得生成跨币种总资产。

## 4. AI 隐私边界

账户与持仓始终先在本机计算。只有用户勾选“允许提交仓位”后，AI 才收到：

- 当前持仓的脱敏分析数据；
- 同账户各币种现金的 `currency + amount`；
- 同账户其他聚合持仓的代码、方向、数量、成本和风险位；
- 账户基础币种、参考净值和风险预算。

永不提交账户名称、数据库 ID、现金备注、Cookie 或 API Key。

## 5. 持久化与迁移

`004_accounts_and_cash.sql` 将旧模型迁移到新模型：

1. `account_profiles` 转成 `accounts`；
2. 旧 `cash` 转成该账户基础币种下的一条 `cash_balances`；
3. `positions.account_name` 映射成 `positions.account_id`；
4. 保留原持仓 ID、时间戳和风险字段；
5. `schema_migrations` 保证结构迁移只执行一次。

迁移必须在事务中运行；任一步失败不得留下半迁移状态。

## 6. API 契约

- `GET/POST/DELETE /api/accounts`
- `POST/DELETE /api/cash-balances`
- `GET/POST/DELETE /api/positions`

删除有关联持仓的账户或自选股返回 `409`。重复账户名、同账户重复现金币种、同账户重复股票仓位返回 `409`。

## 7. 当前边界

- 当前是聚合仓位模型，不处理逐笔成交、佣金、税费、已实现盈亏和公司行动；
- `reported_equity` 由用户维护，不代表实时券商净值；
- AI 能看到授权账户的结构，但不能代替用户下单，也不能生成未经净值和风险预算支持的精确交易数量；
- 后续引入 Quote/FX 快照后，才增加账户级实时总市值、现金占比、行业集中度和跨币种风险。
