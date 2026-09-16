export function normalizeProviderSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export function canonicalSymbol(displaySymbol: string, providerSymbol: string, exchange?: string | null): string {
  const explicit = displaySymbol.trim().toUpperCase();
  if (/^[^:\s]+:[^:\s]+$/.test(explicit)) return normalizeExplicit(explicit);
  const provider = normalizeProviderSymbol(providerSymbol);
  const mainland = provider.match(/^(\d{6})\.(SS|SZ|BJ)$/);
  if (mainland !== null) {
    const prefix = { SS: "SSE", SZ: "SZSE", BJ: "BSE" }[mainland[2]!]!;
    return `${prefix}:${mainland[1]}`;
  }
  const hongKong = provider.match(/^(\d{1,5})\.HK$/);
  if (hongKong !== null) return `HKEX:${Number(hongKong[1])}`;
  const normalizedExchange = exchange?.trim().toUpperCase();
  if (normalizedExchange?.includes("NASDAQ")) return `NASDAQ:${provider}`;
  if (normalizedExchange?.includes("NYSE")) return `NYSE:${provider}`;
  if (normalizedExchange?.includes("AMEX")) return `AMEX:${provider}`;
  return explicit || `YAHOO:${provider}`;
}

function normalizeExplicit(value: string): string {
  const [exchange, ticker] = value.split(":", 2) as [string, string];
  if (exchange === "HKEX" && /^0*\d+$/.test(ticker)) return `${exchange}:${Number(ticker)}`;
  return `${exchange}:${ticker}`;
}
