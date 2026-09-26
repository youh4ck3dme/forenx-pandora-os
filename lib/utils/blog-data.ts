import type { Metadata } from 'next'

export interface BlogPost {
    slug: string
    title: string
    excerpt: string
    content: string
    coverImage: string
    author: {
        name: string
        avatar: string
    }
    publishedAt: string
    readingTime: number
    tags: string[]
}

// Demo blog posts data
export const blogPosts: BlogPost[] = [
    {
        slug: 'bezpecnost-v-modernom-prehliadaci',
        title: 'Bezpečnosť v modernom prehliadači: Čo musíte vedieť',
        excerpt: 'Preskúmajte najnovšie bezpečnostné funkcie a ako PΛND0RΛ Browser chráni vaše súkromie online.',
        content: `
# Bezpečnosť v modernom prehliadači

V dnešnej digitálnej ére je bezpečnosť prehliadania internetu kriticky dôležitá. PΛND0RΛ Browser prináša revolučný prístup k ochrane vášho súkromia.

## Biometrická autentifikácia

Naša implementácia WebAuthn umožňuje bezpečné prihlásenie pomocou odtlačku prsta alebo Face ID. Žiadne heslá, žiadne riziká.

## Blokovanie trackerov

Automaticky blokujeme sledovacie cookies a skripty, ktoré zbierajú vaše dáta bez súhlasu.

## Šifrovaná komunikácia

Všetka komunikácia prebieha cez HTTPS s additional security layers.
    `,
        coverImage: '/icons/icon.svg',
        author: { name: 'PΛND0RΛ Team', avatar: '/icons/icon.svg' },
        publishedAt: '2026-01-07',
        readingTime: 5,
        tags: ['bezpečnosť', 'súkromie', 'webauthn']
    },
    {
        slug: 'webauthn-buducnost-autentifikacie',
        title: 'WebAuthn: Budúcnosť autentifikácie bez hesiel',
        excerpt: 'Zistite, prečo sú passkeys a biometrická autentifikácia bezpečnejšie ako tradičné heslá.',
        content: `
# WebAuthn: Budúcnosť autentifikácie

Heslá sú minulosťou. WebAuthn štandard prináša novú éru bezpečnej autentifikácie.

## Ako to funguje

WebAuthn využíva kryptografické kľúče uložené v bezpečnom úložisku vášho zariadenia.

## Výhody oproti heslám

- Nie je možné hacknúť cez phishing
- Žiadne slabé alebo opakovane použité heslá
- Rýchlejšie prihlásenie

## Implementácia v PΛND0RΛ

Náš prehliadač plne podporuje WebAuthn na všetkých platformách.
    `,
        coverImage: '/icons/icon.svg',
        author: { name: 'PΛND0RΛ Team', avatar: '/icons/icon.svg' },
        publishedAt: '2026-01-05',
        readingTime: 7,
        tags: ['webauthn', 'passkeys', 'autentifikácia']
    },
    {
        slug: 'pwa-vs-nativne-aplikacie',
        title: 'PWA vs. Natívne aplikácie: Prečo sme si vybrali PWA',
        excerpt: 'Pochopte výhody Progressive Web Apps a prečo je to budúcnosť webových aplikácií.',
        content: `
# PWA vs. Natívne aplikácie

Progressive Web Apps kombinujú to najlepšie z webových a natívnych aplikácií.

## Výhody PWA

- Inštalovateľné bez app store
- Fungujú offline
- Automatické aktualizácie
- Menšia veľkosť

## Prečo PΛND0RΛ ako PWA

Chceli sme dosiahnuť maximálnu dostupnosť na všetkých platformách bez kompromisov v kvalite.

## Service Worker magia

Náš service worker zabezpečuje plynulý offline zážitok a rýchle načítanie.
    `,
        coverImage: '/icons/icon.svg',
        author: { name: 'PΛND0RΛ Team', avatar: '/icons/icon.svg' },
        publishedAt: '2026-01-03',
        readingTime: 6,
        tags: ['pwa', 'vývoj', 'technológie']
    }
]

export function getBlogPost(slug: string): BlogPost | undefined {
    return blogPosts.find(post => post.slug === slug)
}

export function getAllBlogSlugs(): string[] {
    return blogPosts.map(post => post.slug)
}

export function generateBlogMetadata(post: BlogPost): Metadata {
    return {
        title: `${post.title} | PΛND0RΛ Blog`,
        description: post.excerpt,
        keywords: post.tags,
        authors: [{ name: post.author.name }],
        openGraph: {
            title: post.title,
            description: post.excerpt,
            type: 'article',
            publishedTime: post.publishedAt,
            authors: [post.author.name],
            tags: post.tags,
        },
        twitter: {
            card: 'summary_large_image',
            title: post.title,
            description: post.excerpt,
        }
    }
}
