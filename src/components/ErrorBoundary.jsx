import { Component } from 'react'
import { recordError } from '../lib/crashReporting'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info)
    // The process survives a render throw, so Crashlytics never sees it unless
    // we say so — otherwise this is a blank screen we only hear about if the
    // user happens to tell us.
    recordError(error, 'ErrorBoundary: ' + String(info && info.componentStack || '').slice(0, 500))
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, background: '#FFF5F7', textAlign: 'center',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22,
          background: 'linear-gradient(135deg, #FEE2E2, #FEF2F2)',
          border: '1.5px solid #FCA5A5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, marginBottom: 20,
        }}>
          ⚠️
        </div>
        <div style={{
          fontSize: 20, fontWeight: 800, color: '#0D0C1D',
          fontFamily: 'Sora, sans-serif', marginBottom: 10,
        }}>
          Something went wrong
        </div>
        <div style={{
          fontSize: 14, color: '#6B7280', lineHeight: 1.6,
          marginBottom: 28, maxWidth: 300,
        }}>
          Famora ran into a problem on this page. Your data is safe.
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{
            padding: '13px 28px', borderRadius: 14,
            background: 'linear-gradient(135deg, #951345, #720D35)',
            border: 'none', color: '#fff', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(149,19,69,0.35)',
            marginBottom: 12,
          }}
        >
          Try Again
        </button>
        <button
          onClick={() => window.location.href = '/'}
          style={{
            background: 'none', border: 'none',
            color: '#9C6B7A', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Go to Home
        </button>
      </div>
    )
  }
}
