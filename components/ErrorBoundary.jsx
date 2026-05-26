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
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">
            {lang === 'es' ? 'Algo salió mal en esta sección' : 'Something went wrong in this section'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 text-xs text-slate-400 hover:text-white underline"
          >
            {lang === 'es' ? 'Reintentar' : 'Retry'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
