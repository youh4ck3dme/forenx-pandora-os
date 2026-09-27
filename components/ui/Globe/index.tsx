import React, { lazy, Suspense, useState, useEffect } from 'react';

const GlobeCanvas = lazy(() =>
    import('./GlobeCanvas').then((mod) => ({ default: mod.GlobeCanvas }))
);

export const Globe = ({ hovering = false }: { hovering?: boolean }) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || typeof window === 'undefined') {
        return null;
    }

    return (
        <Suspense fallback={null}>
            <GlobeCanvas hovering={hovering} />
        </Suspense>
    );
};
