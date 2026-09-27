import { blogPosts } from '@/lib/utils'
import Link from 'next/link'
import { Calendar, Clock, ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Blog | PΛND0RΛ Browser',
    description: 'Najnovšie články o bezpečnosti, súkromí a technológiách prehliadačov.',
    openGraph: {
        title: 'Blog | PΛND0RΛ Browser',
        description: 'Najnovšie články o bezpečnosti, súkromí a technológiách prehliadačov.',
        type: 'website',
    }
}

export default function BlogPage() {
    return (
        <main className="min-h-svh bg-black">
            {/* Header */}
            <div className="py-16 px-4 border-b border-border bg-linear-to-b from-purple-500/5 to-transparent">
                <div className="max-w-6xl mx-auto text-center">
                    <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
                        PΛND0RΛ <span className="text-transparent bg-clip-text bg-linear-to-r from-purple-500 to-cyan-400">Blog</span>
                    </h1>
                    <p className="text-foreground/60 text-lg max-w-2xl mx-auto">
                        Najnovšie články o bezpečnosti, súkromí a technológiách prehliadačov.
                    </p>
                </div>
            </div>

            {/* Blog Grid */}
            <div className="max-w-6xl mx-auto px-4 py-12">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {blogPosts.map((post) => (
                        <Link
                            key={post.slug}
                            href={`/blog/${post.slug}`}
                            className="group block bg-foreground/5 border border-border rounded-xl overflow-hidden hover:border-purple-500/50 hover:bg-foreground/10 transition-all"
                        >
                            {/* Cover Image */}
                            <div className="aspect-video bg-linear-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
                                <div className="w-16 h-16 text-foreground/20">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                    </svg>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-5">
                                {/* Tags */}
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {post.tags.slice(0, 2).map((tag) => (
                                        <span
                                            key={tag}
                                            className="text-xs px-2 py-1 bg-purple-500/10 text-purple-400 rounded-full"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>

                                {/* Title */}
                                <h2 className="text-lg font-semibold text-foreground mb-2 group-hover:text-purple-400 transition-colors line-clamp-2">
                                    {post.title}
                                </h2>

                                {/* Excerpt */}
                                <p className="text-foreground/60 text-sm mb-4 line-clamp-2">
                                    {post.description}
                                </p>

                                {/* Meta */}
                                <div className="flex items-center justify-between text-xs text-foreground/40">
                                    <div className="flex items-center gap-3">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(post.publishedAt).toLocaleDateString('sk-SK')}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {post.readingTime} min
                                        </span>
                                    </div>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-purple-400" />
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Back Link */}
            <div className="text-center pb-12">
                <Link
                    href="/"
                    className="text-foreground/60 hover:text-foreground transition-colors"
                >
                    ← Späť na hlavnú stránku
                </Link>
            </div>
        </main>
    )
}
