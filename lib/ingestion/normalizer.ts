import type {
  MetricType,
  NormalizedMetric,
  Normalizer,
  Platform,
  RawRow,
} from "./types";

/**
 * Maps each platform's raw export columns → NormalizedMetric.
 *
 * Real TikTok exports vary in column naming, so instead of a brittle fixed map
 * we match headers heuristically (case/spacing/punctuation-insensitive, with
 * common aliases). The OUTPUT shape (`NormalizedMetric`) stays stable so
 * analytics/dashboard never change. A future column-mapping UI can override
 * these matches per upload.
 */

// --- header + value helpers ------------------------------------------------

/** Normalize a header for fuzzy matching: lowercase, strip non-alphanumerics. */
function canon(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Find the first row key whose canonical form matches any alias. */
function findKey(row: RawRow, aliases: string[]): string | undefined {
  const wanted = aliases.map(canon);
  for (const key of Object.keys(row)) {
    const c = canon(key);
    if (wanted.some((w) => c === w || c.includes(w))) {
      return key;
    }
  }
  return undefined;
}

function num(row: RawRow, key: string | undefined): number | undefined {
  if (!key) {
    return undefined;
  }
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }
  // Strip currency symbols, thousands separators, percent signs.
  const cleaned =
    typeof raw === "number" ? raw : Number(String(raw).replace(/[$,%\s]/g, ""));
  return Number.isFinite(cleaned) ? cleaned : undefined;
}

/** Parse a variety of date formats → ISO yyyy-mm-dd, or undefined. */
function isoDate(row: RawRow, key: string | undefined): string | undefined {
  if (!key) {
    return undefined;
  }
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  return d.toISOString().slice(0, 10);
}

// --- shared value mapping --------------------------------------------------

const DATE_ALIASES = ["date", "day", "reportdate", "statisticsdate"];
const DIMENSION_ALIASES: Record<
  Exclude<NormalizedMetric["dimension"], "none">,
  string[]
> = {
  product: ["productname", "product", "itemname", "sku"],
  creator: ["creator", "creatorname", "handle", "username", "affiliate"],
  campaign: ["campaign", "campaignname", "adgroup", "adname"],
};

/** Detect which dimension (if any) a row is broken down by, + its label. */
function detectDimension(row: RawRow): {
  dimension: NormalizedMetric["dimension"];
  dimensionName?: string;
} {
  for (const dim of ["product", "creator", "campaign"] as const) {
    const key = findKey(row, DIMENSION_ALIASES[dim]);
    if (key) {
      const label = row[key];
      return {
        dimension: dim,
        dimensionName: label == null ? undefined : String(label),
      };
    }
  }
  return { dimension: "none" };
}

/** Map one raw row → NormalizedMetric (shared across platforms). */
function mapRow(
  row: RawRow,
  ctx: { clientId: string; platform: Platform },
  metricType: MetricType
): NormalizedMetric | null {
  const date = isoDate(row, findKey(row, DATE_ALIASES));
  if (!date) {
    // A row with no resolvable date can't join the daily fact table.
    return null;
  }

  const { dimension, dimensionName } = detectDimension(row);

  const metric: NormalizedMetric = {
    clientId: ctx.clientId,
    date,
    platform: ctx.platform,
    metricType,
    dimension,
    dimensionName,
    revenue: num(row, findKey(row, ["revenue", "salesamount", "totalsales"])),
    gmv: num(row, findKey(row, ["gmv", "grossmerchandisevalue"])),
    spend: num(row, findKey(row, ["spend", "cost", "adspend", "budgetspent"])),
    roas: num(row, findKey(row, ["roas", "returnonadspend"])),
    orders: num(row, findKey(row, ["orders", "ordercount", "skuorders"])),
    units: num(
      row,
      findKey(row, ["units", "unitssold", "quantity", "itemssold"])
    ),
    impressions: num(row, findKey(row, ["impressions", "impr", "videoviews"])),
    clicks: num(row, findKey(row, ["clicks", "linkclicks"])),
    commission: num(row, findKey(row, ["commission", "estcommission"])),
    engagementRate: num(row, findKey(row, ["engagementrate", "engagement"])),
  };

  return metric;
}

// --- per-platform normalizers ----------------------------------------------

/** Each platform maps to a default metricType; column mapping is shared. */
const PLATFORM_METRIC_TYPE: Record<Platform, MetricType> = {
  seller_center: "sales",
  ads_manager: "ads",
  affiliate_center: "affiliate",
  business_suite: "engagement",
  other: "sales",
};

function makeNormalizer(platform: Platform): Normalizer {
  const metricType = PLATFORM_METRIC_TYPE[platform];
  return (rows, ctx) =>
    rows
      .map((r) => mapRow(r, ctx, metricType))
      .filter((m): m is NormalizedMetric => m !== null);
}

export const normalizers: Record<Platform, Normalizer> = {
  seller_center: makeNormalizer("seller_center"),
  ads_manager: makeNormalizer("ads_manager"),
  affiliate_center: makeNormalizer("affiliate_center"),
  business_suite: makeNormalizer("business_suite"),
  other: makeNormalizer("other"),
};

export function normalize(
  platform: Platform,
  rows: Parameters<Normalizer>[0],
  ctx: Parameters<Normalizer>[1]
): NormalizedMetric[] {
  return normalizers[platform](rows, ctx);
}
