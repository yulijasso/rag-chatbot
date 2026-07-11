import Papa from "papaparse";
import type { MetricsSource, Platform, RawRow } from "./types";

/**
 * CSV ingestion source. Parses an uploaded CSV export into raw rows.
 *
 * SHELL: parsing is wired up; the platform-specific column mapping/normalizing
 * lives in `./normalizer.ts` (TODO). A future `TikTokApiSource` implements the
 * same `MetricsSource` interface so downstream code is unchanged.
 */
export class CsvSource implements MetricsSource {
  readonly platform: Platform;
  private readonly csv: string;

  constructor(csv: string, platform: Platform) {
    this.csv = csv;
    this.platform = platform;
  }

  fetch(): Promise<RawRow[]> {
    return new Promise((resolve, reject) => {
      Papa.parse<RawRow>(this.csv, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (result) => resolve(result.data),
        error: (err: unknown) => reject(err),
      });
    });
  }
}
