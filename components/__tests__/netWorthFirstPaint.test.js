import React from 'react'
import { render, screen } from '@testing-library/react'
import NetWorthCard from '../dashboard/NetWorthCard'

// FASE SB (A2): el primer pintado con la cifra del cache y la real usan el
// MISMO componente en el mismo lugar, asi que al asentar cambia la cifra y
// desaparece la marca, sin esqueleto entre medio.
const base = { lang: 'es', convert: (v) => v, items: [], cashTotal: null, returnYTD: 2.38, ytdChange: 508.29, dailyChange: null }

test('con cache se ve la ultima cifra y la marca de actualizando', () => {
  render(<NetWorthCard {...base} netWorth={27292.25} updating />)
  expect(screen.getByRole('status').textContent).toMatch(/actualizando/)
})

test('al asentar el mismo nodo pierde la marca (sin desmontar)', () => {
  const { rerender, container } = render(<NetWorthCard {...base} netWorth={27292.25} updating />)
  const card = container.firstChild
  rerender(<NetWorthCard {...base} netWorth={27350.1} />)
  expect(container.firstChild).toBe(card)
  expect(screen.queryByText(/actualizando/)).toBeNull()
})
