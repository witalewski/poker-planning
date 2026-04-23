import { summarize } from '../lib/state'
import type { Round, SessionState } from '../lib/types'

interface Props {
  round: Round
  state: SessionState
}

export function RevealedSummary({ round, state }: Props) {
  const summary = summarize(round)
  const max = Math.max(...summary.distribution.map((d) => d.count), 1)

  return (
    <div className="summary" data-testid="summary">
      <div className="summary-cards">
        {Object.entries(round.votes).map(([pid, value]) => {
          const name = state.participants[pid]?.name ?? 'Ghost'
          return (
            <div key={pid} className="revealed-card" data-testid={`revealed-card-${pid}`}>
              <div className="revealed-card-inner">
                <span className="revealed-card-value">{value}</span>
                <span className="revealed-card-name">{name}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="summary-stats">
        <div className="stat-block">
          <span className="stat-label">Average</span>
          <span className="stat-value" data-testid="summary-average">
            {summary.average !== null ? summary.average : '—'}
          </span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Median</span>
          <span className="stat-value" data-testid="summary-median">
            {summary.median !== null ? summary.median : '—'}
          </span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Mode</span>
          <span className="stat-value" data-testid="summary-mode">
            {summary.mode ?? '—'}
          </span>
        </div>
        <div className="stat-block">
          <span className="stat-label">Votes</span>
          <span className="stat-value" data-testid="summary-count">
            {summary.count}
          </span>
        </div>
      </div>

      <div className="summary-verdict" data-testid="summary-verdict">
        {summary.consensus && <><span className="badge badge-green">Consensus</span> Everyone landed on {summary.mode}. Ship it.</>}
        {!summary.consensus && summary.distribution.length > 1 && (
          <>
            <span className="badge badge-amber">Spread</span>
            {' '}Lowest {summary.distribution[summary.distribution.length - 1].value}, highest {summary.distribution[0].value}. Discuss?
          </>
        )}
        {summary.questionCount > 0 && (
          <>
            {' '}
            <span className="badge badge-pink">?×{summary.questionCount}</span>
          </>
        )}
      </div>

      <div className="summary-histogram" aria-hidden="true">
        {summary.distribution.map((d) => (
          <div key={d.value} className="histogram-bar">
            <div className="bar-fill" style={{ height: `${(d.count / max) * 100}%` }} />
            <div className="bar-label">{d.value}</div>
            <div className="bar-count">{d.count}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
