import { CARD_VALUES, type CardValue } from '../lib/types'

interface Props {
  selected?: CardValue
  onSelect: (v: CardValue) => void
  onClear: () => void
}

export function CardDeck({ selected, onSelect, onClear }: Props) {
  return (
    <div className="deck" role="group" aria-label="Pick a card">
      {CARD_VALUES.map((value, idx) => {
        const isSelected = selected === value
        return (
          <button
            key={value}
            type="button"
            className={`card ${isSelected ? 'card-selected' : ''}`}
            style={{ ['--card-idx' as string]: idx }}
            onClick={() => (isSelected ? onClear() : onSelect(value))}
            data-testid={`card-${value}`}
            aria-pressed={isSelected}
            aria-label={`Card ${value}`}
          >
            <span className="card-corner tl">{value}</span>
            <span className="card-value">{value}</span>
            <span className="card-corner br">{value}</span>
          </button>
        )
      })}
    </div>
  )
}
