import { Component } from 'react'
import { BUILD_ID, recordCrash, formatCrashLog, clearCrashLog } from '../lib/crashLog'
import { APP_NAME } from '../lib/brand'

const detailBtn = {
  background: 'none', border: 'none', color: '#C4A2AE',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, showDetails: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info)
    recordCrash('render', error, info?.componentStack?.trim().split('\n').slice(0, 6).join('\n'))
    this.setState({ info })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, info: null, showDetails: false })
    this.props.onRetry?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, info, showDetails } = this.state
    const detail = [
      `build ${BUILD_ID}`,
      error?.message || String(error || 'Unknown error'),
      info?.componentStack?.trim(),
      formatCrashLog() && '── recent errors ──\n' + formatCrashLog(),
    ].filter(Boolean).join('\n\n')

    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, background: '#FFF5F7', textAlign: 'center',
        overflowY: 'auto',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22,
          background: 'linear-gradient(135deg, #FEE2E2, #FEF2F2)',
          border: '1.5px solid #FCA5A5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, marginBottom: 20, flexShrink: 0,
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
          {APP_NAME} ran into a problem on this page. Your data is safe.
        </div>
        <button
          onClick={this.handleRetry}
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

        {/* Details — collapsed by default, so a crash on a phone is still
            reportable without a debugger attached */}
        <button
          onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
          style={{
            marginTop: 18, background: 'none', border: 'none',
            color: '#C4A2AE', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </button>
        {showDetails && (
          <>
          <pre style={{
            marginTop: 10, maxWidth: '100%', maxHeight: 220, overflow: 'auto',
            background: '#fff', border: '1px solid #F3D4DD', borderRadius: 12,
            padding: 12, fontSize: 11, lineHeight: 1.5, color: '#6B7280',
            textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{detail}</pre>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              onClick={() => { navigator.clipboard?.writeText(detail).catch(() => {}) }}
              style={detailBtn}
            >Copy</button>
            <button
              onClick={() => { clearCrashLog(); this.forceUpdate() }}
              style={detailBtn}
            >Clear log</button>
          </div>
          </>
        )}
      </div>
    )
  }
}
