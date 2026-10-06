/**
 * Negative Market product catalogue.
 *
 * Stored profiles use short keys (`Cfd`, `Futures`, …). Configuration documents use
 * `*NegativeMarket` suffix keys. Missing stored key ≠ NotBlocked — it means the product is not
 * gated by that regulation's document.
 */

import type { ConfigDocument, LoadedNegativeMarketProduct, NegativeMarketProductConfig, NegativeMarketRule } from './types';

const CATALOG: ReadonlyArray<{
  storedKey: string;
  configKey: keyof ConfigDocument;
  label: string;
  shortLabel: string;
}> = [
  { storedKey: 'Cfd', configKey: 'CfdNegativeMarket', label: 'CFD / leveraged', shortLabel: 'CFD' },
  {
    storedKey: 'Futures',
    configKey: 'FuturesNegativeMarket',
    label: 'Exchange-traded futures',
    shortLabel: 'Futures',
  },
  {
    storedKey: 'Margin',
    configKey: 'MarginNegativeMarket',
    label: 'Stock margin (SMT)',
    shortLabel: 'Margin',
  },
  { storedKey: 'Crypto', configKey: 'CryptoNegativeMarket', label: 'Crypto', shortLabel: 'Crypto' },
  {
    storedKey: 'ExperimentalCrypto',
    configKey: 'ExperimentalCryptoNegativeMarket',
    label: 'Experimental crypto overlay',
    shortLabel: 'Exp. crypto',
  },
  {
    storedKey: 'Ers',
    configKey: 'ErsNegativeMarket',
    label: 'Elevated-risk securities',
    shortLabel: 'ERS',
  },
  { storedKey: 'Etf', configKey: 'EtfNegativeMarket', label: 'ETF (CAR)', shortLabel: 'ETF' },
];

export function negativeMarketProductsFromDocument(doc: ConfigDocument): LoadedNegativeMarketProduct[] {
  const products: LoadedNegativeMarketProduct[] = [];
  for (const entry of CATALOG) {
    const config = doc[entry.configKey] as NegativeMarketProductConfig | null | undefined;
    if (!config?.Rules?.length) continue;
    products.push({
      storedKey: entry.storedKey,
      configKey: entry.configKey,
      label: entry.label,
      shortLabel: entry.shortLabel,
      config,
    });
  }
  return products;
}

export function formatAutoRelease(rule: NegativeMarketRule): string | null {
  if (!rule.HasAutoRelease || !rule.AutoReleaseCondition) return null;
  const { DaysFromFtd, AmountOfClosedTradingPosition } = rule.AutoReleaseCondition;
  return `${DaysFromFtd} days from FTD and ${AmountOfClosedTradingPosition} closed trades`;
}
