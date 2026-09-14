const state = { config: null, result: null, chartBars: [] };
const $ = (id) => document.getElementById(id);
const form = $("analysis-form");
const symbolSelect = $("symbol-select");
const customFields = $("custom-symbol-fields");
const useAi = $("use-ai");
const aiFields = $("ai-fields");
const errorBox = $("form-error");

boot().catch((error) => showError(error.message));

async function boot() {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("无法读取本地配置");
  state.config = await response.json();
  symbolSelect.replaceChildren();
  for (const item of state.config.symbols) {
    const option = document.createElement("option");
    option.value = item.providerSymbol;
    option.dataset.symbol = item.symbol;
    option.textContent = `${item.symbol} · ${item.providerSymbol}`;
    symbolSelect.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "＋ 自定义股票";
  symbolSelect.append(custom);
  $("timeframe").value = String(state.config.defaults.timeframeMinutes);
  $("lookback").value = String(state.config.defaults.lookbackDays);
  $("model").value = state.config.defaults.model;
  $("base-url").value = state.config.defaults.baseUrl;
}

symbolSelect.addEventListener("change", () => customFields.classList.toggle("hidden", symbolSelect.value !== "__custom__"));
useAi.addEventListener("change", () => aiFields.classList.toggle("hidden", !useAi.checked));
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
  const payload = {
    symbol: custom ? $("symbol").value.trim() : selected.dataset.symbol,
    providerSymbol: custom ? $("provider-symbol").value.trim() : selected.value,
    timeframeMinutes: Number($("timeframe").value),
    lookbackDays: Number($("lookback").value),
    useAi: useAi.checked,
    apiKey: useAi.checked ? $("api-key").value : undefined,
    model: $("model").value.trim(),
    baseUrl: $("base-url").value.trim(),
  };
  if (!payload.symbol || !payload.providerSymbol) return showError("请填写股票代码和行情代码");
  if (payload.useAi && !payload.apiKey) return showError("启用 AI 时需要填写 API Key");
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
    renderResult(data);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    $("empty-state").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
});

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
