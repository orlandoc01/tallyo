import { graphql, HttpResponse } from 'msw'
import { server } from '../mocks/server'

type Data = Record<string, unknown>
type CapturedVariables<T extends Data> = Data & { input?: T }

export function mockQuery(name: string, data: Data) {
  server.use(graphql.link('/query').query(name, () => HttpResponse.json({ data })))
}

export function mockMutation(name: string, data: Data) {
  server.use(graphql.link('/query').mutation(name, () => HttpResponse.json({ data })))
}

export function captureQuery(name: string, data: Data | ((calls: number) => Data)) {
  let calls = 0

  server.use(
    graphql.link('/query').query(name, () => {
      calls += 1
      return HttpResponse.json({ data: typeof data === 'function' ? data(calls) : data })
    }),
  )

  return { get calls() { return calls } }
}

export function mockGraphqlError(
  name: string,
  message: string,
  options: { kind?: 'query' | 'mutation'; status?: number } = {},
) {
  const responseOptions = options.status === undefined ? undefined : { status: options.status }

  if (options.kind === 'mutation') {
    server.use(graphql.link('/query').mutation(name, () => HttpResponse.json({ errors: [{ message }] }, responseOptions)))
    return
  }

  server.use(graphql.link('/query').query(name, () => HttpResponse.json({ errors: [{ message }] }, responseOptions)))
}

export function captureMutation<T extends Data = Data>(name: string, data: Data) {
  let variables: CapturedVariables<T> | undefined

  server.use(
    graphql.link('/query').mutation<Data, CapturedVariables<T>>(name, ({ variables: nextVariables }) => {
      variables = nextVariables
      return HttpResponse.json({ data })
    }),
  )

  return {
    get variables() {
      return variables
    },
    get input() {
      return variables?.input
    },
    get called() {
      return variables !== undefined
    },
  }
}
