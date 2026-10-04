import React, { useState } from 'react';
import { Save, Loader2, Download } from 'lucide-react';

interface ExportBuildButtonProps {
    addLog: (message: string) => void;
}

export const ExportBuildButton = ({ addLog }: ExportBuildButtonProps) => {
    const [loading, setLoading] = useState(false);

    const handleClick = async () => {
        setLoading(true);
        addLog('> Initiating Export & Build sequence...');
        try {
            const resp = await fetch('/api/export-build', { method: 'POST' });
            const data = await resp.json();

            if (resp.ok) {
                addLog(`> ✅ Success: ${data.message}`);
                addLog(`> Artifacts available in ~/Downloads`);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (err) {
            console.error(err);
            addLog(`> ❌ Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 hover:border-green-500/50 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
            title="Export project to ZIP and build native binaries"
        >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="hidden md:inline">{loading ? 'Packaging...' : 'Export & Build'}</span>
        </button>
    );
};
