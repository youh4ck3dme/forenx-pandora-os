import { getBlogPost, getAllBlogSlugs, generateBlogMetadata } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Clock, ArrowLeft, Share2 } from 'lucide-react'
import type { Metadata } from 'next'

interface PageProps {
    params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
    return getAllBlogSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params
    const post = getBlogPost(slug)
    if (!post) return { title: 'Článok nenájdený' }
    return generateBlogMetadata(post)
}

export default async function BlogPostPage({ params }: PageProps) {
    const { slug } = await params
    const post = getBlogPost(slug)

    if (!post) {
        notFound()
    }

    return (
        <main className="min-h-svh bg-black">
            {/* Header */}
            <div className="py-12 px-4 border-b border-border bg-linear-to-b from-purple-500/5 to-transparent">
                <div className="max-w-3xl mx-auto">
                    {/* Back Link */}
                    <Link
                        href="/blog"
                        className="inline-flex items-center gap-2 text-foreground/60 hover:text-foreground transition-colors mb-8"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Späť na blog
                    </Link>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {post.tags.map((tag) => (
                            <span
                                key={tag}
                                className="text-xs px-3 py-1 bg-purple-500/10 text-purple-400 rounded-full"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                        {post.title}
                    </h1>

                    {/* Meta */}
                    <div className="flex items-center gap-4 text-sm text-foreground/60">
                        <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {new Date(post.publishedAt).toLocaleDateString('sk-SK', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                            })}
                        </span>
                        <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {post.readingTime} min čítania
                        </span>
                    </div>
                </div>
            </div>

            {/* Content */}
            <article className="max-w-3xl mx-auto px-4 py-12">
                <div className="prose prose-invert prose-purple max-w-none">
                    {/* Simple markdown-like rendering */}
                    {post.content.split('\n').map((line, i) => {
                        if (line.startsWith('# ')) {
                            return <h1 key={i} className="text-3xl font-bold mt-8 mb-4 text-foreground">{line.slice(2)}</h1>
                        }
                        if (line.startsWith('## ')) {
                            return <h2 key={i} className="text-2xl font-semibold mt-6 mb-3 text-foreground">{line.slice(3)}</h2>
                        }
                        if (line.startsWith('- ')) {
                            return <li key={i} className="text-foreground/80 ml-4">{line.slice(2)}</li>
                        }
                        if (line.trim()) {
                            return <p key={i} className="text-foreground/80 mb-4">{line}</p>
                        }
                        return null
                    })}
                </div>

                {/* Share */}
                <div className="mt-12 pt-8 border-t border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                                <span className="text-purple-400 font-bold text-sm">H4</span>
                            </div>
                            <div>
                                <p className="text-foreground font-medium">{post.author.name}</p>
                                <p className="text-foreground/40 text-sm">Autor</p>
                            </div>
                        </div>
                        <button className="flex items-center gap-2 px-4 py-2 bg-foreground/5 border border-border rounded-lg hover:bg-foreground/10 transition-colors text-foreground/60 hover:text-foreground">
                            <Share2 className="w-4 h-4" />
                            Zdieľať
                        </button>
                    </div>
                </div>
            </article>
        </main>
    )
}
