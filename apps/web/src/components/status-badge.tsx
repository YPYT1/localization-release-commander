export function StatusBadge({ value }: { value: string }) {
  const tone = value.includes("BLOCK") || value.includes("FAILED") || value === "EXPIRED"
    ? "danger"
    : value.includes("HUMAN") || value.includes("APPROVAL") || value === "EXPIRING"
      ? "warning"
      : value.includes("PASSED") || value.includes("COMPLETE") || value === "VALID"
        ? "success"
        : "neutral";
  return <span className={`status-badge ${tone}`}>{value.replaceAll("_", " ")}</span>;
}
