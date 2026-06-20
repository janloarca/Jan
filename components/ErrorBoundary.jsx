'use client'

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    const cardId = this.props.cardId || 'unknown'
    console.error(`[ErrorBoundary:${cardId}]`, error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const lang = this.props.lang || 'es'
      return (
        <div className="card-glass rounded-xl p-4 text-center" style={{ borderColor: 'rgba(248,113,113,0.15)' }}>
          <p className="text-sm" style={{ color: 'var(--accent-red)' }}>
            {lang === 'es' ? 'Algo salió mal en esta sección' : 'Something went wrong in this section'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="btn-ghost mt-2 text-xs"
          >
            {lang === 'es' ? 'Reintentar' : 'Retry'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
