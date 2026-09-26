'use client'

import { Download } from 'lucide-react'
import { useBrowserStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { List } from 'react-window'
import { AutoSizer } from 'react-virtualized-auto-sizer'

export function DownloadsPanel() {
    const { downloads } = useBrowserStore()

    const Row = ({ index, style, ariaAttributes }: any) => {
        const item = downloads[index]
        return (
            <div style={style} {...ariaAttributes} className="px-1">
                <div
                    key={item.id}
                    className="group p-2 rounded-lg hover:bg-foreground/5 cursor-pointer flex flex-col gap-2 h-full"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            <Download className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate" title={item.fileName}>{item.fileName}</p>
                            <div className="flex items-center gap-2 text-xs text-foreground/40">
                                <span>{item.fileSize}</span>
                                <span>•</span>
                                <span className={item.status === 'completed' ? 'text-green-500' : item.status === 'failed' ? 'text-red-500' : 'text-yellow-500'}>
                                    {item.status}
                                </span>
                            </div>
                        </div>
                    </div>
                    {/* Progress Bar */}
                    {item.status === 'in-progress' && item.totalBytes && item.totalBytes > 0 && (
                        <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                            <div
                                className="bg-primary h-full transition-all duration-300"
                                style={{ width: `${(item.receivedBytes / item.totalBytes) * 100}%` }}
                            />
                        </div>
                    )}
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
            {downloads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-foreground/40 space-y-2">
                    <Download className="w-8 h-8 opacity-20" />
                    <p className="text-sm">No downloads yet</p>
                </div>
            ) : (
                <div className="flex-1 min-h-0">
                    <AutoSizer
                        renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
                            <List
                                style={{ height: height || 0, width: width || 0 } as any}
                                rowCount={downloads.length}
                                rowHeight={70}
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
