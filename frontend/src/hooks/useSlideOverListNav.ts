import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

/**
 * Previous / next navigation for a right-hand detail slide-over bound to a paginated list.
 *
 * Lists are newest-first (top row = latest). Arrow / chrome directions follow time, not list index:
 * - Left (Prev) → older (down the list / next page)
 * - Right (Next) → newer / latest (up the list / previous page)
 *
 * So opening the top row means you can only move left.
 */
export function useSlideOverListNav<T>(opts: {
  items: T[]
  loading?: boolean
  refreshing?: boolean
  getKey: (item: T) => string
  selectedKey: string | null
  onSelect: (item: T) => void
  page: number
  setPage: Dispatch<SetStateAction<number>>
  pageSize: number
  totalCount: number
}) {
  const {
    items,
    loading = false,
    refreshing = false,
    getKey,
    selectedKey,
    onSelect,
    page,
    setPage,
    pageSize,
    totalCount,
  } = opts

  const itemsRef = useRef(items)
  itemsRef.current = items
  const getKeyRef = useRef(getKey)
  getKeyRef.current = getKey
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const pendingNavRef = useRef<'first' | 'last' | null>(null)
  const waitForFetchRef = useRef(false)

  useEffect(() => {
    if (!pendingNavRef.current) return
    if (loading || refreshing) {
      waitForFetchRef.current = false
      return
    }
    if (waitForFetchRef.current) return
    const nav = pendingNavRef.current
    pendingNavRef.current = null
    const list = itemsRef.current
    if (!list.length) return
    onSelectRef.current(nav === 'first' ? list[0] : list[list.length - 1])
  }, [items, loading, refreshing])

  const index = selectedKey ? items.findIndex((item) => getKey(item) === selectedKey) : -1
  // Left = older: further down the newest-first list, or next page
  const hasPrev =
    Boolean(selectedKey) &&
    ((index >= 0 && index < items.length - 1) || page * pageSize < totalCount)
  // Right = newer: toward top of list / previous page
  const hasNext = Boolean(selectedKey) && (index > 0 || page > 1)
  const navLabel =
    selectedKey && index >= 0 && totalCount > 0
      ? `${(page - 1) * pageSize + index + 1} of ${totalCount}`
      : undefined

  /** Older (left): move down the list, then onto the next page. */
  const goPrev = useCallback(() => {
    const list = itemsRef.current
    const key = selectedKey
    const idx = key ? list.findIndex((item) => getKeyRef.current(item) === key) : -1
    if (idx >= 0 && idx < list.length - 1) {
      onSelectRef.current(list[idx + 1])
      return
    }
    if (page * pageSize < totalCount) {
      pendingNavRef.current = 'first'
      waitForFetchRef.current = true
      setPage((p) => p + 1)
    }
  }, [selectedKey, page, pageSize, totalCount, setPage])

  /** Newer (right): move up the list, then onto the previous page. */
  const goNext = useCallback(() => {
    const list = itemsRef.current
    const key = selectedKey
    const idx = key ? list.findIndex((item) => getKeyRef.current(item) === key) : -1
    if (idx > 0) {
      onSelectRef.current(list[idx - 1])
      return
    }
    if (page > 1) {
      pendingNavRef.current = 'last'
      waitForFetchRef.current = true
      setPage((p) => p - 1)
    }
  }, [selectedKey, page, setPage])

  return { hasPrev, hasNext, navLabel, goPrev, goNext }
}
