import { beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './msw-setup'

// onUnhandledRequest=error catches any real-network leakage in tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
