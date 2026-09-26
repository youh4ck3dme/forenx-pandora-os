'use client'

import { Globe, Trash2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { HistoryItem } from '@/lib/storage'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useBrowserStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { List, ListImperativeAPI } from 'react-window'
import { AutoSizer } from 'react-virtualized-auto-sizer'

type FlatItem =
  | { type: 'header'; label: string; id: string }
  | { type: 'item'; data: HistoryItem }

export function HistoryPanel() {
  const { history, deleteHistoryItem, clearHistory, loadHistory, updateTab, activeTabId, historyLoaded } = useBrowserStore()
  const listRef = useRef<ListImperativeAPI>(null)

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleNavigate = (url: string) => {
    if (activeTabId) {
      updateTab(activeTabId, { url, title: url, isLoading: true })
    }
  }

  const flatHistory = useMemo(() => {
    const grouped = history.reduce((acc, item) => {
      const date = new Date(item.visitedAt)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      let group: string
      if (date.toDateString() === today.toDateString()) group = "Today"
      else if (date.toDateString() === yesterday.toDateString()) group = "Yesterday"
      else group = "Older"

      if (!acc[group]) acc[group] = []
      acc[group].push(item)
      return acc
    }, {} as Record<string, HistoryItem[]>)

    const flat: FlatItem[] = []
    const groups = ["Today", "Yesterday", "Older"]

    groups.forEach(group => {
      if (grouped[group] && grouped[group].length > 0) {
        flat.push({ type: 'header', label: group, id: `header-${group}` })
        grouped[group].forEach(item => {
          flat.push({ type: 'item', data: item })
        })
      }
    })

    return flat
  }, [history])

  const getItemSize = (index: number) => {
    return flatHistory[index].type === 'header' ? 40 : 52
  }

  const Row = ({ index, style, ariaAttributes }: any) => {
    const item = flatHistory[index]

    if (item.type === 'header') {
      return (
        <div style={style} {...ariaAttributes} className="flex items-center justify-between px-3 mt-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/40">{item.label}</p>
          {item.label === "Today" && (
            <button
              onClick={() => clearHistory()}
              className="text-[10px] font-bold text-foreground/30 hover:text-red-500 transition-colors uppercase"
            >
              Wipe Today
            </button>
          )}
        </div>
      )
    }

    const data = item.data
    return (
      <div style={style} {...ariaAttributes} className="px-1">
        <div
          className="group flex items-center gap-2 p-2 rounded-lg hover:bg-foreground/5 cursor-pointer h-full"
          onClick={() => handleNavigate(data.url)}
        >
          <Globe className="w-4 h-4 text-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{data.title}</p>
            <p className="text-xs text-foreground/40 truncate">{data.url}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              deleteHistoryItem(data.id)
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-foreground/10 rounded transition-opacity"
          >
            <Trash2 className="w-3 h-3 text-foreground/40" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col min-h-0"
    >
      {!historyLoaded ? (
        <div className="space-y-4 p-2">
          {[1, 2].map((g) => (
            <div key={g} className="space-y-2">
              <Skeleton className="h-4 w-16 ml-2" />
              <div className="space-y-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2 p-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : history.length === 0 ? (
        <p className="text-foreground/40 text-sm text-center py-8">No history yet</p>
      ) : (
        <div className="flex-1 min-h-0">
          <AutoSizer
            renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
              <List
                listRef={listRef}
                style={{ height: height || 0, width: width || 0 } as any}
                rowCount={flatHistory.length}
                rowHeight={getItemSize}
                rowComponent={Row}
                rowProps={{} as any}
                className="no-scrollbar"
              />
            )}
          />
        </div>
      )}
    </motion.div>
  )
}
