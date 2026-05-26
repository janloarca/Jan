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
      return (
        <div data-card-id={this.props.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
          <p className="text-xs text-red-400/80">
            {this.props.id}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-1 text-xs text-slate-500 hover:text-white"
          >
            Retry
          </button>
        </div>
      )
    }
    return <div data-card-id={this.props.id}>{this.props.children}</div>
  }
}
