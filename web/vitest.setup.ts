import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './src/mocks/server'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

const nativeFetch = globalThis.fetch
let interceptedFetch: typeof fetch

Object.defineProperties(HTMLElement.prototype, {
  clientHeight: { configurable: true, value: 480 },
  clientWidth: { configurable: true, value: 640 },
})

HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    bottom: 480,
    height: 480,
    left: 0,
    right: 640,
    top: 0,
    width: 640,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  }
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  interceptedFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    if (!init?.signal) return interceptedFetch(input, init)

    const initWithoutSignal = { ...init }
    delete initWithoutSignal.signal
    return interceptedFetch(input, initWithoutSignal)
  }
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
afterAll(() => {
  server.close()
  globalThis.fetch = nativeFetch
})
