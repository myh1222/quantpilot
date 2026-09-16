const state = {
  config: null, watchlist: [], accounts: [], positions: [],
  result: null, chartBars: [], followUpMessages: [],
};
const $ = (id) => document.getElementById(id);
const form = $("analysis-form");
const symbolSelect = $("symbol-select");
const customFields = $("custom-symbol-fields");
const useAi = $("use-ai");
const aiFields = $("ai-fields");
const errorBox = $("form-error");
const watchlistForm = $("watchlist-form");
const positionForm = $("position-form");
const accountForm = $("account-form");
const cashForm = $("cash-form");
const searchInput = $("watchlist-name");
const searchResults = $("symbol-search-results");
const followUpForm = $("follow-up-form");
let searchSequence = 0;
let searchTimer = 0;

boot().catch((error) => showError(error.message));

async function boot() {
  const configResponse = await fetch("/api/config");
  if (!configResponse.ok) throw new Error("无法读取本地配置");
  state.config = await configResponse.json();
  $("timeframe").value = String(state.config.defaults.timeframeMinutes);
  $("lookback").value = String(state.config.defaults.lookbackDays);
  $("model").value = state.config.defaults.model;
  $("base-url").value = state.config.defaults.baseUrl;
  $("ai-transport").value = state.config.defaults.transport;
  $("api-key").placeholder = state.config.defaults.hasServerApiKey
    ? "留空使用本机已配置密钥"
    : "sk-…";
  document.querySelector(".follow-up-section").classList.toggle("hidden", !state.config.defaults.followUpEnabled);
  $("tradingview-row").classList.toggle("hidden", !state.config.defaults.tradingViewEnabled);
  $("use-tradingview").checked = state.config.defaults.tradingViewEnabled;
  await refreshPortfolio();
}

symbolSelect.addEventListener("change", () => {
  customFields.classList.toggle("hidden", symbolSelect.value !== "__custom__");
  renderPositionChoices();
  updatePositionConsent();
});
useAi.addEventListener("change", () => {
  aiFields.classList.toggle("hidden", !useAi.checked);
  updatePositionConsent();
});
$("analysis-position").addEventListener("change", updatePositionConsent);
followUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("follow-up-input");
  const question = input.value.trim();
  if (!question || !state.result?.ai || state.result.ai.status !== "completed") return;
  $("follow-up-error").textContent = "";
  input.value = "";
  state.followUpMessages.push({ role: "user", content: question });
  renderFollowUpThread({ answer: "等待 AI 回复…", evidence: [], limitations: [] }, true);
  $("follow-up-button").disabled = true;
  try {
    const response = await fetch("/api/ai/follow-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysisSessionId: state.result.analysisSessionId, messages: state.followUpMessages }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI 追问失败");
    state.followUpMessages.push({ role: "assistant", content: data.answer.answer });
    renderFollowUpThread(data.answer);
  } catch (error) {
    state.followUpMessages = state.followUpMessages.filter((message) => message.content !== question);
    renderFollowUpThread();
    $("follow-up-error").textContent = error instanceof Error ? error.message : String(error);
  } finally {
    $("follow-up-button").disabled = false;
  }
});
$("toggle-key").addEventListener("click", () => {
  const input = $("api-key");
  input.type = input.type === "password" ? "text" : "password";
  $("toggle-key").textContent = input.type === "password" ? "显示" : "隐藏";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  const selected = symbolSelect.selectedOptions[0];
  const custom = symbolSelect.value === "__custom__";
  const selectedWatchlist = custom ? undefined : state.watchlist.find((item) => String(item.id) === symbolSelect.value);
  const payload = {
    symbol: custom ? $("symbol").value.trim() : selectedWatchlist?.symbol,
    providerSymbol: custom ? $("provider-symbol").value.trim() : selectedWatchlist?.providerSymbol,
    timeframeMinutes: Number($("timeframe").value),
    lookbackDays: Number($("lookback").value),
    useAi: useAi.checked,
    apiKey: useAi.checked ? $("api-key").value : undefined,
    model: $("model").value.trim(),
    baseUrl: $("base-url").value.trim(),
    transport: $("ai-transport").value,
    positionId: $("analysis-position").value ? Number($("analysis-position").value) : null,
    sharePositionWithAi: useAi.checked && $("share-position-ai").checked,
    useTradingView: $("use-tradingview").checked,
  };
  if (!payload.symbol || !payload.providerSymbol) return showError("请填写股票代码和行情代码");
  if (payload.useAi && !payload.apiKey && !state.config.defaults.hasServerApiKey) {
    return showError("启用 AI 时需要填写 API Key，或先在本机配置密钥");
  }
  setLoading(true);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "分析请求失败");
    state.result = data;
    state.chartBars = data.chartBars;
    state.followUpMessages = [];
    renderFollowUpThread();
    renderResult(data);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    $("empty-state").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
});

for (const button of document.querySelectorAll("[data-open-dialog]")) {
  button.addEventListener("click", () => $(button.dataset.openDialog).showModal());
}
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}

watchlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    id: Number($("watchlist-id").value) || undefined,
    symbol: $("watchlist-symbol").value.trim(),
    providerSymbol: $("watchlist-provider-symbol").value.trim(),
    name: $("watchlist-name").value,
    market: $("watchlist-market").value,
    notes: $("watchlist-notes").value,
  };
  await saveManager("/api/watchlist", body, $("watchlist-error"), async () => {
    resetWatchlistForm();
    await refreshPortfolio();
  });
});
$("watchlist-reset").addEventListener("click", resetWatchlistForm);

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length < 1) return hideSymbolSearch();
  searchTimer = window.setTimeout(() => void searchSymbols(query), 350);
});

positionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const stopLoss = Number($("position-stop-loss").value);
  const targetPrice = Number($("position-target-price").value);
  const openedAt = $("position-opened-at").value;
  const body = {
    id: Number($("position-id").value) || undefined,
    watchlistItemId: Number($("position-watchlist-id").value),
    accountId: Number($("position-account-id").value),
    side: $("position-side").value,
    quantity: Number($("position-quantity").value),
    averageCost: Number($("position-average-cost").value),
    currency: $("position-currency").value.trim(),
    stopLoss: Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : null,
    targetPrice: Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
    thesis: $("position-thesis-input").value,
    openedAt: openedAt || null,
  };
  await saveManager("/api/positions", body, $("position-error"), async () => {
    resetPositionForm();
    await refreshPortfolio();
  });
});
$("position-reset").addEventListener("click", resetPositionForm);

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const equity = Number($("account-reported-equity").value);
  const riskBudget = Number($("account-risk-budget").value);
  const body = {
    id: Number($("account-id").value) || undefined,
    name: $("account-name").value.trim(),
    baseCurrency: $("account-base-currency").value.trim(),
    reportedEquity: Number.isFinite(equity) && equity > 0 ? equity : null,
    riskBudgetPercent: Number.isFinite(riskBudget) && riskBudget > 0 ? riskBudget : null,
    notes: $("account-notes").value,
  };
  await saveManager("/api/accounts", body, $("account-error"), async () => {
    resetAccountForm();
    await refreshPortfolio();
  });
});
$("account-reset").addEventListener("click", resetAccountForm);

cashForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    id: Number($("cash-id").value) || undefined,
    accountId: Number($("cash-account-id").value),
    currency: $("cash-currency").value.trim(),
    amount: Number($("cash-amount").value),
    notes: $("cash-notes").value,
  };
  await saveManager("/api/cash-balances", body, $("cash-error"), async () => {
    resetCashForm();
    await refreshPortfolio();
  });
});
$("cash-reset").addEventListener("click", resetCashForm);

function setLoading(active) {
  $("analyze-button").disabled = active;
  $("analyze-button").querySelector("span").textContent = active ? "分析进行中…" : "运行分析";
  $("loading-state").classList.toggle("hidden", !active);
  if (active) {
    $("empty-state").classList.add("hidden");
    $("results").classList.add("hidden");
  }
}

function showError(message) { errorBox.textContent = message; }

async function searchSymbols(query) {
  const sequence = ++searchSequence;
  searchResults.replaceChildren(appendText(searchResults, "p", "搜索中…", "symbol-search-status"));
  searchResults.classList.remove("hidden");
  try {
    const response = await fetch(`/api/symbol-search?q=${encodeURIComponent(query)}`);
    const data = await response.json().catch(() => ({}));
    if (sequence !== searchSequence) return;
    if (!response.ok) throw new Error(data.error || "代码搜索失败");
    renderSymbolSearchResults(data.results ?? []);
  } catch (error) {
    if (sequence !== searchSequence) return;
    searchResults.replaceChildren(appendText(
      searchResults, "p",
      `${error instanceof Error ? error.message : String(error)}。A股可手动填： SZ 002371.SZ / SS 600519.SS`,
      "symbol-search-status error",
    ));
  }
}

function renderSymbolSearchResults(results) {
  searchResults.replaceChildren();
  if (!results.length) {
    searchResults.append(appendText(searchResults, "p", "没有匹配结果，请手动填写显示代码和 Yahoo 代码。", "symbol-search-status"));
    return;
  }
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-search-option";
    appendText(button, "strong", result.name);
    appendText(button, "span", `${result.symbol}${result.exchange ? ` · ${result.exchange}` : ""}${result.quoteType ? ` · ${result.quoteType}` : ""}`);
    button.addEventListener("click", () => {
      searchInput.value = result.name;
      $("watchlist-provider-symbol").value = result.symbol;
      $("watchlist-symbol").value = result.displaySymbol || displaySymbolFromYahoo(result.symbol);
      $("watchlist-market").value = marketFromYahooSymbol(result.symbol, result.exchange);
      hideSymbolSearch();
    });
    searchResults.append(button);
  }
}

function hideSymbolSearch() {
  window.clearTimeout(searchTimer);
  searchSequence += 1;
  searchResults.classList.add("hidden");
  searchResults.replaceChildren();
}

function displaySymbolFromYahoo(symbol) {
  const match = symbol.match(/^(\d{5,6})\.(SS|SZ|BJ)$/i);
  if (!match) return symbol;
  const prefix = { SS: "SSE", SZ: "SZSE", BJ: "BSE" }[match[2].toUpperCase()];
  return `${prefix}:${match[1]}`;
}

function marketFromYahooSymbol(symbol, exchange) {
  if (/\.(SS|SZ|BJ)$/i.test(symbol)) return "A股";
  if (/\.(HK)$/i.test(symbol)) return "港股";
  if (exchange?.includes("NASDAQ") || exchange?.includes("NYSE") || exchange?.includes("AMEX")) return "美股";
  return exchange ?? "";
}

async function refreshPortfolio() {
  const [watchlistResponse, accountsResponse, positionsResponse] = await Promise.all([
    fetch("/api/watchlist"), fetch("/api/accounts"), fetch("/api/positions"),
  ]);
  if (!watchlistResponse.ok || !accountsResponse.ok || !positionsResponse.ok) {
    throw new Error("无法刷新自选股、账户和持仓");
  }
  state.watchlist = (await watchlistResponse.json()).items;
  state.accounts = (await accountsResponse.json()).accounts;
  state.positions = (await positionsResponse.json()).positions;
  renderSymbolSelect();
  renderWatchlistManager();
  renderPositionManager();
  renderAccountManager();
  renderPositionChoices();
  $("watchlist-count").textContent = String(state.watchlist.length);
  $("position-count").textContent = String(state.positions.length);
  $("account-count").textContent = String(state.accounts.length);
}

function renderSymbolSelect() {
  const previous = symbolSelect.value;
  symbolSelect.replaceChildren();
  for (const item of state.watchlist) {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = item.name ? `${item.name} · ${item.symbol}` : `${item.symbol} · ${item.providerSymbol}`;
    symbolSelect.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "＋ 自定义股票";
  symbolSelect.append(custom);
  const values = [...symbolSelect.options].map((option) => option.value);
  symbolSelect.value = values.includes(previous) ? previous : values[0] ?? "__custom__";
  customFields.classList.toggle("hidden", symbolSelect.value !== "__custom__");
  renderPositionChoices();
}

function renderPositionChoices() {
  const select = $("analysis-position");
  const previous = select.value;
  const watchlistId = symbolSelect.value === "__custom__" ? null : Number(symbolSelect.value);
  const positions = state.positions.filter((position) => position.watchlistItemId === watchlistId);
  select.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "不关联持仓";
  select.append(none);
  for (const position of positions) {
    const option = document.createElement("option");
    option.value = String(position.id);
    option.textContent = `${position.accountName} · ${position.side === "long" ? "多头" : "空头"} · ${position.quantity}`;
    select.append(option);
  }
  const values = [...select.options].map((option) => option.value);
  select.value = values.includes(previous) ? previous : "";
  $("analysis-position-field").classList.toggle("hidden", select.options.length <= 1);
  updatePositionConsent();
}

function renderWatchlistManager() {
  const container = $("watchlist-list");
  container.replaceChildren();
  if (!state.watchlist.length) return appendText(container, "p", "还没有自选股，先在左侧添加。", "manager-empty");
  for (const item of state.watchlist) {
    const row = document.createElement("article");
    row.className = "manager-item";
    const main = document.createElement("div");
    main.className = "manager-item-main";
    appendText(main, "strong", item.name || item.symbol);
    appendText(main, "span", `${item.symbol} · ${item.providerSymbol}${item.market ? ` · ${item.market}` : ""}`);
    if (item.notes) appendText(main, "small", item.notes);
    row.append(main, managerActions(() => editWatchlist(item), () => deleteRecord("/api/watchlist", item.id, refreshPortfolio)));
    container.append(row);
  }
}

function renderPositionManager() {
  renderWatchlistOptions();
  renderAccountOptions();
  const container = $("position-list");
  container.replaceChildren();
  if (!state.positions.length) return appendText(container, "p", "还没有持仓记录。", "manager-empty");
  for (const position of state.positions) {
    const row = document.createElement("article");
    row.className = "manager-item";
    const main = document.createElement("div");
    main.className = "manager-item-main";
    appendText(main, "strong", `${position.name || position.symbol} · ${position.accountName}`);
    appendText(main, "span", `${position.side === "long" ? "多头" : "空头"} ${position.quantity} @ ${formatPrice(position.averageCost)} ${position.currency}`);
    appendText(main, "small", [
      position.stopLoss ? `止损 ${formatPrice(position.stopLoss)}` : null,
      position.targetPrice ? `目标 ${formatPrice(position.targetPrice)}` : null,
      position.openedAt ? `建仓 ${position.openedAt}` : null,
    ].filter(Boolean).join(" · "));
    row.append(main, managerActions(() => editPosition(position), () => deleteRecord("/api/positions", position.id, refreshPortfolio)));
    container.append(row);
  }
}

function renderAccountManager() {
  renderAccountOptions();
  const container = $("account-list");
  container.replaceChildren();
  if (!state.accounts.length) return appendText(container, "p", "还没有账户。先创建账户，再添加现金或持仓。", "manager-empty");
  for (const account of state.accounts) {
    const card = document.createElement("article");
    card.className = "account-card";
    const heading = document.createElement("div");
    heading.className = "manager-item";
    const main = document.createElement("div");
    main.className = "manager-item-main";
    appendText(main, "strong", account.name);
    appendText(main, "span", `${account.baseCurrency} · ${account.positionCount} 个持仓 · ${account.cashBalances.length} 条现金`);
    if (account.reportedEquity !== null) appendText(main, "small", `参考净值 ${formatPrice(account.reportedEquity)} ${account.baseCurrency}`);
    heading.append(main, managerActions(() => editAccount(account), () => deleteRecord("/api/accounts", account.id, refreshPortfolio)));
    card.append(heading);
    const balances = document.createElement("div");
    balances.className = "cash-list";
    if (!account.cashBalances.length) appendText(balances, "span", "暂无现金余额");
    for (const cash of account.cashBalances) {
      const row = document.createElement("div");
      appendText(row, "strong", `${formatPrice(cash.amount)} ${cash.currency}`);
      if (cash.notes) appendText(row, "span", cash.notes);
      row.append(managerActions(() => editCash(cash), () => deleteRecord("/api/cash-balances", cash.id, refreshPortfolio)));
      balances.append(row);
    }
    card.append(balances);
    container.append(card);
  }
}

function renderWatchlistOptions() {
  const select = $("position-watchlist-id");
  const previous = select.value;
  select.replaceChildren();
  for (const item of state.watchlist) {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = item.name ? `${item.name} · ${item.symbol}` : item.symbol;
    select.append(option);
  }
  const values = [...select.options].map((option) => option.value);
  select.value = values.includes(previous) ? previous : values[0] ?? "";
}

function renderAccountOptions() {
  for (const id of ["position-account-id", "cash-account-id"]) {
    const select = $(id);
    const previous = select.value;
    select.replaceChildren();
    for (const account of state.accounts) {
      const option = document.createElement("option");
      option.value = String(account.id);
      option.textContent = `${account.name} · ${account.baseCurrency}`;
      select.append(option);
    }
    const values = [...select.options].map((option) => option.value);
    select.value = values.includes(previous) ? previous : values[0] ?? "";
  }
}

function managerActions(edit, remove) {
  const actions = document.createElement("div");
  actions.className = "manager-item-actions";
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "编辑";
  editButton.addEventListener("click", edit);
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", remove);
  actions.append(editButton, deleteButton);
  return actions;
}

function editWatchlist(item) {
  $("watchlist-id").value = String(item.id);
  $("watchlist-symbol").value = item.symbol;
  $("watchlist-provider-symbol").value = item.providerSymbol;
  $("watchlist-name").value = item.name ?? "";
  $("watchlist-market").value = item.market ?? "";
  $("watchlist-notes").value = item.notes ?? "";
  $("watchlist-dialog").showModal();
}

function editPosition(position) {
  $("position-id").value = String(position.id);
  renderWatchlistOptions();
  $("position-watchlist-id").value = String(position.watchlistItemId);
  renderAccountOptions();
  $("position-account-id").value = String(position.accountId);
  $("position-side").value = position.side;
  $("position-quantity").value = String(position.quantity);
  $("position-average-cost").value = String(position.averageCost);
  $("position-currency").value = position.currency;
  $("position-stop-loss").value = position.stopLoss === null ? "" : String(position.stopLoss);
  $("position-target-price").value = position.targetPrice === null ? "" : String(position.targetPrice);
  $("position-thesis-input").value = position.thesis ?? "";
  $("position-opened-at").value = position.openedAt ?? "";
  $("position-dialog").showModal();
}

function editAccount(account) {
  $("account-id").value = String(account.id);
  $("account-name").value = account.name;
  $("account-base-currency").value = account.baseCurrency;
  $("account-reported-equity").value = account.reportedEquity ?? "";
  $("account-risk-budget").value = account.riskBudgetPercent ?? "";
  $("account-notes").value = account.notes ?? "";
}

function editCash(cash) {
  $("cash-id").value = String(cash.id);
  renderAccountOptions();
  $("cash-account-id").value = String(cash.accountId);
  $("cash-currency").value = cash.currency;
  $("cash-amount").value = String(cash.amount);
  $("cash-notes").value = cash.notes ?? "";
}

function resetWatchlistForm() {
  watchlistForm.reset();
  $("watchlist-id").value = "";
}

function resetPositionForm() {
  positionForm.reset();
  $("position-id").value = "";
  renderWatchlistOptions();
  renderAccountOptions();
}

function resetAccountForm() {
  accountForm.reset();
  $("account-id").value = "";
  $("account-base-currency").value = "HKD";
}

function resetCashForm() {
  cashForm.reset();
  $("cash-id").value = "";
  renderAccountOptions();
  const account = state.accounts.find((item) => String(item.id) === $("cash-account-id").value);
  $("cash-currency").value = account?.baseCurrency ?? "HKD";
}

async function saveManager(url, body, errorNode, afterSave) {
  errorNode.textContent = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "保存失败");
    await afterSave();
  } catch (error) {
    errorNode.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function deleteRecord(url, id, refresh) {
  if (!window.confirm("确认删除这条记录？")) return;
  try {
    const response = await fetch(`${url}/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "删除失败");
    await refresh();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function renderResult(result) {
  const report = result.technicalAnalysis;
  const tech = report.technical;
  const judgement = report.judgement;
  $("empty-state").classList.add("hidden");
  $("results").classList.remove("hidden");
  $("result-meta").textContent = `${report.timeframe} · ${report.provider.toUpperCase()} · ${report.barCount} 根已确认 K 线`;
  $("result-symbol").textContent = report.symbol;
  $("result-summary").textContent = judgement.summary;
  $("technical-score").textContent = judgement.technicalScore;
  const bias = $("bias-badge");
  bias.className = `bias-${judgement.bias}`;
  bias.textContent = ({ bullish: "技术偏多", bearish: "技术偏空", neutral: "结构中性" })[judgement.bias];
  $("metric-close").textContent = formatPrice(tech.close);
  $("metric-time").textContent = formatDate(report.lastBarOpenTime);
  $("metric-rsi").textContent = tech.rsi14.toFixed(1);
  $("metric-rsi-label").textContent = tech.rsi14 >= 70 ? "偏热" : tech.rsi14 <= 30 ? "偏冷" : tech.rsi14 >= 55 ? "偏强" : tech.rsi14 <= 45 ? "偏弱" : "中性";
  $("metric-atr").textContent = formatPrice(tech.atr14);
  $("metric-volume").textContent = tech.volumeRatio20 === null ? "—" : `${tech.volumeRatio20.toFixed(2)}×`;
  renderLevels(report.structure);
  renderList($("evidence-list"), judgement.evidence);
  renderStats(report.structure.statistics);
  renderAi(result.ai);
  renderPosition(result.positionAnalysis);
  renderTradingView(result.tradingView);
  requestAnimationFrame(() => drawChart(result.chartBars, report.structure));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderLevels(structure) {
  const container = $("level-list");
  container.replaceChildren();
  const levels = [...structure.supports.map((x, i) => ({ ...x, label: `S${i + 1}` })), ...structure.resistances.map((x, i) => ({ ...x, label: `R${i + 1}` }))];
  if (!levels.length) return appendText(container, "p", "当前窗口没有仍然有效的结构位", "empty-level");
  for (const level of levels) {
    const item = document.createElement("article");
    item.className = `level-item ${level.kind}`;
    appendText(item, "span", `${level.label} · ${level.kind === "support" ? "支撑" : "压力"}`);
    appendText(item, "strong", formatPrice(level.price));
    appendText(item, "small", `确认 ${formatDate(level.confirmedAtMs)} · 触碰 ${level.touches} 次`);
    container.append(item);
  }
}

function renderStats(stats) {
  const values = [
    ["确认结构", stats.confirmed], ["仍有效", stats.active], ["已突破", stats.broken],
    ["确认即失效", stats.invalidated], ["总触碰", stats.touches],
    ["支撑突破率", formatRate(stats.supportBreakRate)], ["压力突破率", formatRate(stats.resistanceBreakRate)],
  ];
  const container = $("stats-grid"); container.replaceChildren();
  for (const [label, value] of values) {
    const item = document.createElement("div"); item.className = "stat";
    appendText(item, "strong", String(value)); appendText(item, "span", label); container.append(item);
  }
}

function renderAi(ai) {
  const card = $("ai-card");
  card.classList.toggle("hidden", ai.status === "disabled");
  if (ai.status === "disabled") return;
  $("ai-model-badge").textContent = `${ai.provider} · ${ai.model}`;
  const failed = ai.status === "failed";
  $("ai-error").classList.toggle("hidden", !failed);
  $("ai-content").classList.toggle("hidden", failed);
  if (failed) { $("ai-error").textContent = `AI 请求失败，但本地技术分析已完成：${ai.error}`; return; }
  const j = ai.judgement;
  $("ai-summary").textContent = j.summary;
  $("bullish-scenario").textContent = j.bullish_scenario;
  $("bearish-scenario").textContent = j.bearish_scenario;
  renderList($("ai-observations"), j.key_observations);
  renderList($("ai-risks"), [...j.risk_factors, ...j.invalidation_conditions, ...j.data_limitations]);
  const decision = j.portfolio_decision;
  const decisionCard = $("portfolio-decision");
  decisionCard.classList.toggle("hidden", decision.stance === "no_position" && decision.actions.length === 0);
  $("decision-stance").textContent = ({
    no_position: "无仓位观察", hold: "持有观察", watch: "条件观察",
    reduce_risk: "降低风险", add_on_confirmation: "确认后评估", exit_on_invalidation: "失效退出观察",
  })[decision.stance];
  $("decision-risk").textContent = `风险 ${decision.risk_level}`;
  $("position-assessment").textContent = decision.position_assessment;
  const actions = $("decision-actions");
  actions.replaceChildren();
  for (const action of [...decision.actions].sort((left, right) => left.priority - right.priority)) {
    const item = document.createElement("article");
    item.className = "decision-action";
    appendText(item, "strong", action.action);
    appendText(item, "span", `触发：${action.trigger}`);
    appendText(item, "small", action.rationale);
    actions.append(item);
  }
  renderFollowUpThread();
}

function renderFollowUpThread(answer, pending = false) {
  const container = $("follow-up-thread");
  container.replaceChildren();
  const questions = state.followUpMessages.filter((message) => message.role === "user");
  const answers = state.followUpMessages.filter((message) => message.role === "assistant");
  for (const [index, question] of questions.entries()) {
    appendFollowUp(container, { label: "你", text: question.content, className: "user" });
    const matched = answers[index];
    if (matched) {
      appendFollowUp(container, { label: "AI", text: matched.content });
    } else if (index === questions.length - 1 && answer) {
      appendFollowUp(container, {
        label: "AI", text: answer.answer, pending,
        evidence: answer.evidence ?? [], limitations: answer.limitations ?? [],
      });
    }
  }
  container.scrollTop = container.scrollHeight;
}

function appendFollowUp(container, { label, text, className = "", pending = false, evidence = [], limitations = [] }) {
  const item = document.createElement("article");
  item.className = `follow-up-message ${className}`.trim();
  appendText(item, "strong", pending ? `${label} · 正在思考` : label);
  appendText(item, "div", text);
  if (!pending && (evidence.length > 0 || limitations.length > 0)) {
    appendText(item, "small", [...evidence, ...limitations].join(" · "));
  }
  container.append(item);
}

function renderPosition(position) {
  const card = $("position-card");
  card.classList.toggle("hidden", position === null);
  if (position === null) return;
  $("position-account").textContent = position.accountName;
  const metrics = [
    ["方向", position.side === "long" ? "多头" : "空头"],
    ["数量", String(position.quantity)],
    ["成本", formatPrice(position.averageCost)],
    ["市值", formatPrice(position.marketValue)],
    ["浮盈亏", formatSigned(position.unrealizedPnl)],
    ["收益率", formatRate(position.unrealizedPnlPercent)],
    ["距止损", formatRate(position.distanceToStopPercent)],
    ["距目标", formatRate(position.distanceToTargetPercent)],
    ["风险回报", position.riskRewardRatio === null ? "—" : position.riskRewardRatio.toFixed(2)],
    ["仓位/净值", formatRate(position.positionWeightPercent)],
    ["止损风险/净值", formatRate(position.riskToStopPercentOfEquity)],
    ["账户持仓数", String(position.accountPositions?.length ?? 0)],
    ["账户现金", (position.accountCashBalances ?? []).map((cash) => `${formatPrice(cash.amount)} ${cash.currency}`).join(" / ") || "—"],
  ];
  const container = $("position-metrics");
  container.replaceChildren();
  for (const [label, value] of metrics) {
    const item = document.createElement("div");
    item.className = `position-metric${value?.startsWith("+") ? " positive" : value?.startsWith("-") ? " negative" : ""}`;
    appendText(item, "span", label);
    appendText(item, "strong", value ?? "—");
    container.append(item);
  }
  $("position-thesis-output").textContent = position.thesis || "未填写";
}

function updatePositionConsent() {
  const hasPosition = Boolean($("analysis-position").value);
  $("share-position-row").classList.toggle("hidden", !useAi.checked || !hasPosition);
  if (!hasPosition) $("share-position-ai").checked = false;
}

function renderTradingView(tradingView) {
  const node = $("tradingview-status");
  if (!tradingView || tradingView.status === "disabled") {
    node.textContent = "TradingView 指标：未启用";
    node.className = "source-status muted";
    return;
  }
  if (tradingView.status === "unavailable") {
    node.textContent = `TradingView 指标：读取失败，已使用本地行情降级 · ${tradingView.error}`;
    node.className = "source-status warning";
    return;
  }
  const alignment = tradingView.alignment;
  node.textContent = `TradingView Pine v${tradingView.snapshot.scriptVersion} · ${alignment.quality === "matched" ? "数据已对齐" : "数据存在偏差"} · 收盘价差 ${(alignment.closeDifferencePercent * 100).toFixed(2)}%`;
  node.className = `source-status ${alignment.quality === "matched" ? "matched" : "warning"}`;
}

function renderList(container, items) {
  container.replaceChildren();
  for (const text of items) appendText(container, "li", text);
}

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className; parent.append(node); return node;
}

function formatRate(value) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function formatPrice(value) { return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 }); }
function formatSigned(value) { return `${value >= 0 ? "+" : ""}${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }
function formatDate(value) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

function ema(values, length) {
  const result = Array(values.length).fill(null); if (values.length < length) return result;
  let seed = 0; for (let i = 0; i < length; i++) seed += values[i];
  result[length - 1] = seed / length; const k = 2 / (length + 1);
  for (let i = length; i < values.length; i++) result[i] = (values[i] - result[i - 1]) * k + result[i - 1];
  return result;
}

function drawChart(allBars, structure) {
  const canvas = $("price-chart"); const stage = canvas.parentElement;
  const bars = allBars.filter(b => [b.open,b.high,b.low,b.close].every(Number.isFinite)).slice(-160);
  if (!bars.length) return;
  const dpr = window.devicePixelRatio || 1; const width = stage.clientWidth; const height = stage.clientHeight;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d"); ctx.scale(dpr,dpr); ctx.clearRect(0,0,width,height);
  const pad = { left: 12, right: 64, top: 16, bottom: 30 }; const chartW = width-pad.left-pad.right; const chartH = height-pad.top-pad.bottom;
  const levelValues = [...structure.supports,...structure.resistances].map(x=>x.price);
  let min = Math.min(...bars.map(b=>b.low),...levelValues); let max = Math.max(...bars.map(b=>b.high),...levelValues); const range = Math.max(max-min,.0001); min-=range*.06; max+=range*.06;
  const y = value => pad.top + (max-value)/(max-min)*chartH; const step = chartW/bars.length; const x = index => pad.left+(index+.5)*step;
  ctx.strokeStyle="rgba(155,190,174,.09)"; ctx.fillStyle="#71877d"; ctx.font="10px system-ui"; ctx.textAlign="left";
  for(let i=0;i<=5;i++){const yy=pad.top+chartH*i/5;ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(width-pad.right,yy);ctx.stroke();ctx.fillText((max-(max-min)*i/5).toFixed(2),width-pad.right+8,yy+3)}
  drawLevels(ctx, structure.supports, "#5ee0a3", "S", y, width, pad);
  drawLevels(ctx, structure.resistances, "#ff7b76", "R", y, width, pad);
  const closes=bars.map(b=>b.close); drawSeries(ctx,ema(closes,20),"#f0bd68",x,y); drawSeries(ctx,ema(closes,50),"#75b8ff",x,y);
  const body=Math.max(1,Math.min(6,step*.58));
  bars.forEach((bar,i)=>{const up=bar.close>=bar.open;ctx.strokeStyle=up?"#5ee0a3":"#ff7b76";ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x(i),y(bar.high));ctx.lineTo(x(i),y(bar.low));ctx.stroke();const top=y(Math.max(bar.open,bar.close));const h=Math.max(1,Math.abs(y(bar.open)-y(bar.close)));ctx.fillRect(x(i)-body/2,top,body,h)});
  ctx.fillStyle="#71877d";ctx.textAlign="center";for(let i=0;i<5;i++){const n=Math.round((bars.length-1)*i/4);ctx.fillText(new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit"}).format(new Date(bars[n].openTimeMs)),x(n),height-10)}
  canvas.onmousemove = event => { const rect=canvas.getBoundingClientRect(); const index=Math.max(0,Math.min(bars.length-1,Math.floor((event.clientX-rect.left-pad.left)/step))); const bar=bars[index]; const tip=$("chart-tooltip"); tip.textContent=`${formatDate(bar.openTimeMs)}  O ${formatPrice(bar.open)}  H ${formatPrice(bar.high)}  L ${formatPrice(bar.low)}  C ${formatPrice(bar.close)}`; tip.classList.remove("hidden"); tip.style.left=`${Math.min(width-tip.offsetWidth-8,Math.max(8,event.clientX-rect.left+12))}px`;tip.style.top=`${Math.max(8,event.clientY-rect.top-38)}px`; };
  canvas.onmouseleave=()=>$("chart-tooltip").classList.add("hidden");
}

function drawSeries(ctx, values, color, x, y){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.4;let started=false;values.forEach((v,i)=>{if(v===null)return;if(!started){ctx.moveTo(x(i),y(v));started=true}else ctx.lineTo(x(i),y(v))});ctx.stroke()}
function drawLevels(ctx,levels,color,prefix,y,width,pad){ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([5,5]);ctx.font="bold 9px system-ui";levels.forEach((level,i)=>{const yy=y(level.price);ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(width-pad.right,yy);ctx.stroke();ctx.fillText(`${prefix}${i+1} ${formatPrice(level.price)}`,pad.left+5,yy-4)});ctx.restore()}

window.addEventListener("resize", () => { if (state.result) drawChart(state.chartBars, state.result.technicalAnalysis.structure); });
