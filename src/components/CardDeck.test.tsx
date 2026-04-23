import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEventModule from '@testing-library/user-event'
import { CardDeck } from './CardDeck'
import { CARD_VALUES } from '../lib/types'

// React 19's default @testing-library/user-event import is a namespace with
// .default, so handle both shapes.
const userEvent = (userEventModule as unknown as { default?: typeof userEventModule }).default ?? userEventModule

describe('<CardDeck />', () => {
  it('renders all fibonacci cards plus the question mark', () => {
    render(<CardDeck onSelect={() => {}} onClear={() => {}} />)
    for (const v of CARD_VALUES) {
      expect(screen.getByTestId(`card-${v}`)).toBeInTheDocument()
    }
  })

  it('calls onSelect when clicking an unselected card', async () => {
    const onSelect = vi.fn()
    render(<CardDeck onSelect={onSelect} onClear={() => {}} />)
    await userEvent.click(screen.getByTestId('card-5'))
    expect(onSelect).toHaveBeenCalledWith('5')
  })

  it('clicking the already-selected card clears the vote', async () => {
    const onSelect = vi.fn()
    const onClear = vi.fn()
    render(<CardDeck selected="5" onSelect={onSelect} onClear={onClear} />)
    await userEvent.click(screen.getByTestId('card-5'))
    expect(onClear).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks the selected card via aria-pressed', () => {
    render(<CardDeck selected="8" onSelect={() => {}} onClear={() => {}} />)
    expect(screen.getByTestId('card-8')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('card-5')).toHaveAttribute('aria-pressed', 'false')
  })
})
