import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

async function enableStubApi() {
  if (import.meta.env.VITE_STUB_API !== 'true') return
  const { startStubApi } = await import('./mocks/browser')
  await startStubApi()
}

void enableStubApi().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
