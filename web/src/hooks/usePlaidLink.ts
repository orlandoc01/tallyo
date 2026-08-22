import { useCallback, useEffect, useRef, useState } from 'react'
import {
  usePlaidLink as useReactPlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from 'react-plaid-link'
import { useMutation } from 'urql'
import { COMPLETE_LINK_UPDATE_MUTATION, CREATE_LINK_TOKEN_MUTATION, CREATE_UPDATE_LINK_TOKEN_MUTATION, EXCHANGE_PUBLIC_TOKEN_MUTATION } from '../graphql/mutations'
import type { CompleteLinkUpdatePayload, ExchangePublicTokenPayload } from '../types/graphql'

interface LinkRequest {
  mode: 'create'
  credentialId: number
  ownerId: string
}

interface UpdateLinkRequest {
  mode: 'update'
  itemId: string
}

type PlaidLinkRequest = LinkRequest | UpdateLinkRequest

interface CreateLinkTokenResult {
  createLinkToken: {
    linkToken: string
    expiration: string
  }
}

interface CreateUpdateLinkTokenResult {
  createUpdateLinkToken: {
    linkToken: string
    expiration: string
  }
}

interface ExchangePublicTokenResult {
  exchangePublicToken: ExchangePublicTokenPayload
}

interface CompleteLinkUpdateResult {
  completeLinkUpdate: CompleteLinkUpdatePayload
}

export function usePlaidLink({ onSuccess, onUpdateSuccess }: { onSuccess?: (payload: ExchangePublicTokenPayload) => void; onUpdateSuccess?: (payload: CompleteLinkUpdatePayload) => void } = {}) {
  const [request, setRequest] = useState<PlaidLinkRequest | null>(null)
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [openedToken, setOpenedToken] = useState<string | null>(null)
  const [isCreatingToken, setIsCreatingToken] = useState(false)
  const [isExchanging, setIsExchanging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, createLinkToken] = useMutation<CreateLinkTokenResult, { input: { credentialId: number; ownerId: string } }>(CREATE_LINK_TOKEN_MUTATION)
  const [, createUpdateLinkToken] = useMutation<CreateUpdateLinkTokenResult, { itemId: string }>(CREATE_UPDATE_LINK_TOKEN_MUTATION)
  const [, exchangePublicToken] = useMutation<
    ExchangePublicTokenResult,
    { input: { credentialId: number; ownerId: string; publicToken: string; institutionId?: string; institutionName?: string } }
  >(EXCHANGE_PUBLIC_TOKEN_MUTATION)
  const [, completeLinkUpdate] = useMutation<CompleteLinkUpdateResult, { itemId: string }>(COMPLETE_LINK_UPDATE_MUTATION)

  const reset = useCallback(() => {
    setRequest(null)
    setLinkToken(null)
    setOpenedToken(null)
    setIsCreatingToken(false)
    setIsExchanging(false)
  }, [])

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      if (!request) return

      setIsExchanging(true)
      setError(null)

      if (request.mode === 'update') {
        const result = await completeLinkUpdate({ itemId: request.itemId })
        setIsExchanging(false)

        if (result.error) {
          setError(result.error.message)
          return
        }

        if (result.data?.completeLinkUpdate) {
          onUpdateSuccess?.(result.data.completeLinkUpdate)
        }

        reset()
        return
      }

      const institution = metadata.institution
      const result = await exchangePublicToken({
        input: {
          credentialId: request.credentialId,
          ownerId: request.ownerId,
          publicToken,
          institutionId: institution?.institution_id,
          institutionName: institution?.name,
        },
      })

      setIsExchanging(false)

      if (result.error) {
        setError(result.error.message)
        return
      }

      if (result.data?.exchangePublicToken) {
        onSuccess?.(result.data.exchangePublicToken)
      }

      reset()
    },
    [completeLinkUpdate, exchangePublicToken, onSuccess, onUpdateSuccess, request, reset],
  )

  const handleExit = useCallback<PlaidLinkOnExit>(() => {
    reset()
  }, [reset])

  const { open, ready } = useReactPlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: handleExit,
  })
  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!linkToken || !ready || openedToken === linkToken) return

    setOpenedToken(linkToken)
    openRef.current()
  }, [linkToken, openedToken, ready])

  const startLink = useCallback(
    async (credentialId: number, ownerId: string) => {
      const nextRequest: LinkRequest = { mode: 'create', credentialId, ownerId }
      setRequest(nextRequest)
      setLinkToken(null)
      setOpenedToken(null)
      setIsCreatingToken(true)
      setError(null)

      const result = await createLinkToken({ input: { credentialId, ownerId } })
      setIsCreatingToken(false)

      if (result.error) {
        setError(result.error.message)
        setRequest(null)
        return
      }

      setLinkToken(result.data?.createLinkToken.linkToken ?? null)
    },
    [createLinkToken],
  )

  const startUpdateLink = useCallback(
    async (itemId: string) => {
      setRequest({ mode: 'update', itemId })
      setLinkToken(null)
      setOpenedToken(null)
      setIsCreatingToken(true)
      setError(null)

      const result = await createUpdateLinkToken({ itemId })
      setIsCreatingToken(false)

      if (result.error) {
        setError(result.error.message)
        setRequest(null)
        return
      }

      setLinkToken(result.data?.createUpdateLinkToken.linkToken ?? null)
    },
    [createUpdateLinkToken],
  )

  return {
    startLink,
    startUpdateLink,
    reset,
    error,
    isLoading: isCreatingToken || isExchanging || Boolean(linkToken && !ready),
  }
}
