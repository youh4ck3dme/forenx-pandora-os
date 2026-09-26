"use client";

import React from 'react';
import dynamic from 'next/dynamic';

const ForgeStudio = dynamic(() => import('@/components/features/forge/ForgeStudio'), {
    ssr: false,
    loading: () => <div className="h-screen w-full bg-[#050508] flex items-center justify-center">
        <div className="animate-pulse text-blue-500 font-bold tracking-tighter text-2xl">FORGE...</div>
    </div>
});

import { ErrorBoundary } from '@/components/ui/error-boundary';

export default function ForgePage() {
    return (
        <div className="h-screen w-full bg-black overflow-hidden">
            <ErrorBoundary name="Forge Studio">
                <ForgeStudio />
            </ErrorBoundary>
        </div>
    );
}
