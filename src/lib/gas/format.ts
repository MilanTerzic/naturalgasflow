const nfMcm = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const nfMwh = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nfPct = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const nfTemp = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const fmtMcm = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "-" : nfMcm.format(v);

export const fmtMwh = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "-" : nfMwh.format(v);

export const fmtPct = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "N/A" : `${nfPct.format(v)}%`;

export const fmtTemp = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "-" : `${nfTemp.format(v)}°C`;

export const fmtPrice = (v: number | null | undefined, ccy: string) =>
  v == null || Number.isNaN(v) ? "-" : `${v < 0.01 ? v.toExponential(2) : v.toFixed(5)} ${ccy}`;

export const fmtShortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
};

export const fmtShortDateYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const fmtMonthYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
