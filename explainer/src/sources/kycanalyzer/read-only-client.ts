/**
 * A KYCAnalyzer client that cannot write.
 *
 * This is not a stylistic preference. Read and write sit one verb apart on both routes this
 * app needs:
 *
 *   GET   /api/v1/kycanalyzer/clientRiskProfile/{gcid}                 read one profile
 *   POST  /api/v1/kycanalyzer/clientRiskProfile/{gcid}                 RECALCULATES and overwrites it
 *   GET   /api/v1/kycanalyzer/ClientRiskProfileConfiguration/{reg}     read configs
 *   POST  /api/v1/kycanalyzer/ClientRiskProfileConfiguration/{reg}     adds a config version
 *   PATCH /…/{reg}/{formulaConfigurationType}                          CHANGES THE LIVE FORMULA
 *                                                                      for an entire regulation
 *
 * A PATCH with `formulaConfigurationType = Suitability` re-scores every user under that
 * regulation. Neither controller declares `[Authorize]` — access is enforced upstream — so
 * this app, once it holds a route to the service, is a channel straight to those endpoints.
 *
 * Hence the shape below: the module exports exactly one function, `get`, and the fetch call
 * hardcodes its method. There is no code path here that can emit anything else, so a retry
 * helper, a health probe or a generated client cannot accidentally supply one. "We just
 * don't call POST" is the version of this that fails eventually.
 */

import { SourceNotConfigured } from '../types';

export interface ClientConfig {
  baseUrl: string;
  /** Optional bearer token. Never reaches the browser — this module is server-only. */
  token?: string;
  timeoutMs: number;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`KYCAnalyzer ${status} on ${path}: ${body.slice(0, 400)}`);
    this.name = 'UpstreamError';
  }
}

export function readClientConfig(): ClientConfig | null {
  const baseUrl = process.env.KYCANALYZER_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) return null;
  return {
    baseUrl,
    token: process.env.KYCANALYZER_TOKEN,
    timeoutMs: Number(process.env.KYCANALYZER_TIMEOUT_MS ?? 10_000),
  };
}

export function requireClientConfig(sourceId: string): ClientConfig {
  const config = readClientConfig();
  if (!config) throw new SourceNotConfigured(sourceId, ['KYCANALYZER_BASE_URL']);
  return config;
}

/**
 * The only way this module talks to the network.
 *
 * Returns `null` on 404 so "no profile" is a value rather than an exception — a user who has
 * never been scored is a normal case, not an error.
 */
export async function get<T>(path: string, config: ClientConfig): Promise<T | null> {
  const url = `${config.baseUrl}/${path.replace(/^\/+/, '')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new UpstreamError(response.status, path, await response.text());
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
