/**
 * Pluggable ingestion. Phase 1 is CSV upload; Phase 2 swaps in the real TikTok
 * APIs behind this SAME interface, so nothing downstream (normalizer, analytics,
 * dashboard) changes.
 */

export type Platform =
  | "seller_center"
  | "ads_manager"
  | "affiliate_center"
  | "business_suite"
  | "other";

export type MetricType =
  | "sales"
  | "ads"
  | "affiliate"
  | "creator"
  | "content"
  | "engagement";

/** A raw, un-normalized record as it comes off a source (CSV row / API object). */
export type RawRow = Record<string, string | number | null | undefined>;

/** A normalized row ready to insert into `MetricsDaily`. */
export type NormalizedMetric = {
  clientId: string;
  date: string; // ISO yyyy-mm-dd
  platform: Platform;
  metricType: MetricType;
  dimension: "product" | "creator" | "campaign" | "none";
  dimensionName?: string;
  revenue?: number;
  spend?: number;
  roas?: number;
  orders?: number;
  units?: number;
  impressions?: number;
  clicks?: number;
  gmv?: number;
  commission?: number;
  engagementRate?: number;
};

/** Anything that can produce rows for ingestion (CSV now, TikTok API later). */
export type MetricsSource = {
  readonly platform: Platform;
  fetch(): Promise<RawRow[]>;
};

/** Maps a platform's raw rows into normalized metrics. */
export type Normalizer = (
  rows: RawRow[],
  ctx: { clientId: string; platform: Platform }
) => NormalizedMetric[];
