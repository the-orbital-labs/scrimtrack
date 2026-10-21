type SummaryStatCardProps = {
  detail: string
  isEmpty?: boolean
  label: string
  value: string
}

export function SummaryStatCard({
  detail,
  isEmpty = false,
  label,
  value,
}: SummaryStatCardProps) {
  return (
    <article className={`summary-stat-card ${isEmpty ? 'is-empty' : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="summary-card-detail">{detail}</span>
    </article>
  )
}
