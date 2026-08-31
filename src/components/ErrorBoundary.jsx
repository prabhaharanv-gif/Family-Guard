import { Component } from 'react'
import { recordError } from '../lib/crashReporting'
import { APP_NAME } from '../lib/brand'

// Stamped in by vite.config.js, so the screen can say which build it is —
// the fastest way to tell a real bug from a stale APK on a device.
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

const detailBtn = {
  background: 'none', border: 'none', color: '#C4A2AE',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null, showDetails: false }
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
    this.setState({ info })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, info, showDetails } = this.state
    const detail = [
      `build ${BUILD_ID}`,
      error?.message || String(error || 'Unknown error'),
      error?.stack?.split('\n').slice(0, 6).join('\n'),
      info?.componentStack?.trim().split('\n').slice(0, 8).join('\n'),
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
          {APP_NAME} ran into a problem on this page. Your data is safe.
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null, info: null, showDetails: false })}
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
          onClick={() => this.setState(st => ({ showDetails: !st.showDetails }))}
          style={{ ...detailBtn, marginTop: 18 }}
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
            <button
              onClick={() => { navigator.clipboard?.writeText(detail).catch(() => {}) }}
              style={{ ...detailBtn, marginTop: 8 }}
            >Copy</button>
          </>
        )}
      </div>
    )
  }
}
