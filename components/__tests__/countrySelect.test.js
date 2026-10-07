/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import CountrySelect from '../ui/CountrySelect'
import { ASSET_COUNTRY_OPTIONS } from '../dashboard/utils'

describe('CountrySelect (FASE PT)', () => {
  test('agrupa por region con optgroup y conserva todas las opciones', () => {
    const { container } = render(<CountrySelect value="" onChange={() => {}} options={ASSET_COUNTRY_OPTIONS} lang="es" />)
    const groups = [...container.querySelectorAll('optgroup')].map(g => g.label)
    expect(groups[0]).toBe('Latinoamérica')
    expect(groups).toContain('Europa')
    // 1 opcion vacia + todas las de la lista
    expect(container.querySelectorAll('option')).toHaveLength(ASSET_COUNTRY_OPTIONS.length + 1)
  })

  test('los rotulos siguen el idioma', () => {
    const { container } = render(<CountrySelect value="" onChange={() => {}} options={ASSET_COUNTRY_OPTIONS} lang="en" />)
    const groups = [...container.querySelectorAll('optgroup')].map(g => g.label)
    expect(groups).toContain('Latin America')
    expect(screen.getByText(/Germany/)).toBeTruthy()
  })

  test('un valor guardado fuera de la lista se antepone y no se pierde', () => {
    const { container } = render(<CountrySelect value="FR" onChange={() => {}} options={ASSET_COUNTRY_OPTIONS} lang="es" />)
    expect(container.querySelector('select').value).toBe('FR')
  })

  test('onChange entrega el valor, no el evento', () => {
    const spy = jest.fn()
    const { container } = render(<CountrySelect value="" onChange={spy} options={ASSET_COUNTRY_OPTIONS} lang="es" />)
    fireEvent.change(container.querySelector('select'), { target: { value: 'GT' } })
    expect(spy).toHaveBeenCalledWith('GT')
  })
})
