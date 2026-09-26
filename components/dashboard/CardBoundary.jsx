'use client'

import { Component } from 'react'

export default class CardBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error(`[Card:${this.props.id}]`, error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      // Clases fijas de Tailwind para un color dinámico (regla que CLAUDE.md ya
      // prohíbe): `text-red-400/80` medía 2.77:1 en tema claro, bajo el piso AA
      // de 4.5:1 — el id de la card apenas se leía justo cuando algo se rompió.
      // Tokens de alerta, el mismo trío que ya usan el resto de los avisos de
      // error de la app (bg/border/icon).
      return (
        <div data-card-id={this.props.id} className="rounded-2xl p-4 text-center"
          style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)' }}>
          <p className="text-xs" style={{ color: 'var(--alert-error-icon)' }}>
            {this.props.id}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-1 text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            Retry
          </button>
        </div>
      )
    }
    return <div data-card-id={this.props.id} className={this.props.className}>{this.props.children}</div>
  }
}
