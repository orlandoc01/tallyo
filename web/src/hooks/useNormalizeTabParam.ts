import { useEffect } from 'react'
import { useNavigate } from 'react-router'

export function useNormalizeTabParam<T extends string>(id: string | undefined, rawParam: string | undefined, isValid: (param: string) => param is T, pathForId: (id: string) => string) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!id || rawParam === undefined || isValid(rawParam)) return
    navigate(pathForId(id), { replace: true })
  }, [id, isValid, navigate, pathForId, rawParam])
}
