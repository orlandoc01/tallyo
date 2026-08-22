export type ParamCodec<T> = {
  key: string
  keys?: readonly string[]
  read(params: URLSearchParams): T
  write(params: URLSearchParams, value: T): void
}

type ParamCodecs = Record<string, ParamCodec<unknown>>
type ParamValues<C extends ParamCodecs> = {
  [K in keyof C]: C[K] extends ParamCodec<infer T> ? T : never
}
type DateRangeCodecs<T> = {
  granularity: ParamCodec<T>
  dateFrom: ParamCodec<string>
  dateTo: ParamCodec<string>
}
type DateRangeValue = { dateFrom: string; dateTo: string }

export function listParam(key: string): ParamCodec<string[]> {
  return {
    key,
    read: (params) => params.get(key)?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
    write(params, value) {
      if (value.length) params.set(key, value.join(','))
      else params.delete(key)
    },
  }
}

export function optionalListParam(key: string): ParamCodec<string[] | null | undefined> {
  const list = listParam(key)
  return {
    key,
    read(params) {
      const value = list.read(params)
      return value.length ? value : undefined
    },
    write(params, value) {
      list.write(params, value ?? [])
    },
  }
}

export function stringParam(key: string): ParamCodec<string | null | undefined>
export function stringParam(key: string, fallback: string): ParamCodec<string>
export function stringParam(key: string, fallback?: string) {
  return {
    key,
    read: (params: URLSearchParams) => params.get(key) ?? fallback,
    write(params: URLSearchParams, value: string | null | undefined) {
      if (value) params.set(key, value)
      else params.delete(key)
    },
  }
}

export function numberParam(key: string): ParamCodec<number | null | undefined> {
  return {
    key,
    read(params) {
      const value = params.get(key)
      return value === null ? undefined : Number(value)
    },
    write(params, value) {
      if (value === null || value === undefined) params.delete(key)
      else params.set(key, String(value))
    },
  }
}

export function boolParam(key: string): ParamCodec<boolean | null | undefined> {
  return {
    key,
    read: (params) => params.get(key) === '1' ? true : undefined,
    write(params, value) {
      if (value) params.set(key, '1')
      else params.delete(key)
    },
  }
}

export function enumParam<T extends string>(key: string, values: readonly T[], fallback: T, omitFallback = false): ParamCodec<T> {
  return {
    key,
    read(params) {
      const value = params.get(key)
      return isOneOf(values, value) ? value : fallback
    },
    write(params, value) {
      if (omitFallback && value === fallback) params.delete(key)
      else params.set(key, value)
    },
  }
}

export function readParams<C extends ParamCodecs>(codecs: C, params: URLSearchParams): ParamValues<C> {
  const result = {} as ParamValues<C>
  for (const key of Object.keys(codecs) as Array<keyof C>) {
    result[key] = codecs[key].read(params) as ParamValues<C>[typeof key]
  }
  return result
}

export function paramUpdate<T>(codec: ParamCodec<T>, value: T): Record<string, string | null> {
  return paramUpdates({ value: codec }, { value })
}

export function dateRangeParamUpdates<T>(codecs: DateRangeCodecs<T>, granularity: T, dateRange: DateRangeValue): Record<string, string | null> {
  return paramUpdates(codecs, { granularity, dateFrom: dateRange.dateFrom, dateTo: dateRange.dateTo })
}

export function paramUpdates<C extends ParamCodecs>(codecs: C, values: Partial<ParamValues<C>>, includeMissing = false): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  const names = includeMissing ? Object.keys(codecs) : Object.keys(values)
  for (const name of names as Array<keyof C>) {
    const codec = codecs[name]
    const params = new URLSearchParams()
    codec.write(params, values[name] as never)
    for (const key of codecKeys(codec)) result[key] = params.get(key)
  }
  return result
}

export function clearParamUpdates<C extends ParamCodecs>(codecs: C): Record<string, null> {
  return Object.fromEntries(paramKeys(codecs).map((key) => [key, null]))
}

function paramKeys<C extends ParamCodecs>(codecs: C): string[] {
  return Object.values(codecs).flatMap(codecKeys)
}

function codecKeys(codec: ParamCodec<unknown>) {
  return codec.keys ?? [codec.key]
}

export function isOneOf<T extends string>(values: readonly T[], value: string | null | undefined): value is T {
  return value !== null && value !== undefined && values.includes(value as T)
}
