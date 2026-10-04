
import { useState, useCallback, useRef, useEffect } from 'react';
import { useBrowserStore } from '@/lib/store';
import { generateImage, generateCompletion, readStream, ChatMessage } from '@/lib/services';
import { electron, isElectron } from '@/lib/api';

export function useCopilotChat() {
    const { mistralApiKey, openaiApiKey, copilotModel, tabs, activeTabId } = useBrowserStore();
    const [messages, setMessages] = useState<ChatMessage[]>([
        { role: 'assistant', content: 'Ahoj! Som ForenX Copilot (Mistral AI). Pomôžem ti s analýzou spisov, prepojeniami subjektov a vyšetrovaním.' }
    ]);
    const [isLoading, setIsLoading] = useState(false);
    const messagesRef = useRef<ChatMessage[]>([]); // Ref for event listeners

    // Keep ref in sync
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    // Cleanup old listeners on mount/unmount to avoid duplicates
    // We'll attach transient listeners per request or global ones?
    // Global approach is safer for Electron events.
    useEffect(() => {
        if (!isElectron()) return;

        const handleChunk = ({ chunk }: { chunk: string }) => {
            setMessages((prev) => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.imageUrl) {
                    newMsgs[newMsgs.length - 1] = { ...lastMsg, content: lastMsg.content + chunk };
                }
                return newMsgs;
            });
        };

        const handleDone = () => {
            setIsLoading(false);
        };

        const handleError = ({ message }: { message: string }) => {
            setMessages((prev) => [...prev, { role: 'system', content: `[CRITICAL_ERR]: ${message}` }]);
            setIsLoading(false);
        };

        electron.on('ai:chunk', handleChunk);
        electron.on('ai:done', handleDone);
        electron.on('ai:error', handleError);
        return () => {
            electron.off('ai:chunk', handleChunk);
            electron.off('ai:done', handleDone);
            electron.off('ai:error', handleError);
        };

    }, []);

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content };
        setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);

        const lowerContent = content.toLowerCase().trim();

        // --- Image Generation Detect ---
        if (lowerContent.startsWith('/imagine ') || lowerContent.startsWith('/genpic ') || lowerContent.startsWith('generuj ') || lowerContent.startsWith('generate ')) {
            if (!openaiApiKey && isElectron()) {
                // Even for simulation, let's complain about key if logic demands it, or just use Electron
            }

            try {
                const prompt = content.replace(/^\/imagine |^\/genpic |^generuj |^generate /i, '');
                const assistantMsg: ChatMessage = { role: 'assistant', content: `[CORE: GENERATING] - "${prompt}"...` };
                setMessages((prev) => [...prev, assistantMsg]);

                let imageUrl: string | undefined;
                if (isElectron()) {
                    imageUrl = await electron.invoke('ai:generate-image', { prompt, apiKey: openaiApiKey }) as string | undefined;
                } else {
                    // Fallback for web mode
                    imageUrl = await generateImage(prompt, openaiApiKey || '');
                }

                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.content.includes('[CORE: GENERATING]')) {
                        const newMsgs = [...prev];
                        newMsgs[newMsgs.length - 1] = { ...last, content: `Syntetizácia obrazu dokončená.`, imageUrl };
                        return newMsgs;
                    }
                    return prev;
                });
            } catch (err: any) {
                setMessages((prev) => [...prev, { role: 'system', content: `[ERR: GENERATOR_FAIL]: ${err.message}` }]);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // --- Context Gathering ---
        let context = "";
        try {
            if (isElectron()) {
                const liveContent = await electron.invoke('tab:getContent') as { content?: string; title?: string } | null;
                if (liveContent?.content) {
                    context = `OBSAH AKTUÁLNEJ STRÁNKY ("${liveContent.title || 'Neznáma'}"):\n\n${liveContent.content.substring(0, 8000)}`;
                } else {
                    // Fallback to history if live fail
                    const tab = tabs.find(t => t.id === activeTabId);
                    if (tab?.url) {
                        const doc = await electron.invoke('history:getContent', tab.url) as { content?: string } | null;
                        if (doc?.content) {
                            context = `OBSAH AKTUÁLNEJ STRÁNKY ("${tab.title || 'Neznáma'}"):\n\n${doc.content.substring(0, 5000)}`;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to get tab context", e);
        }

        const historyWithContext: ChatMessage[] = context
            ? [{ role: 'system', content: context }, ...messages, userMsg]
            : [...messages, userMsg];

        // --- Chat Request ---
        const effectiveKey = mistralApiKey || openaiApiKey;

        if (isElectron()) {
            // Prepare UI for stream
            const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
            setMessages((prev) => [...prev, assistantMsg]);

            electron.send('ai:chat', {
                messages: historyWithContext,
                apiKey: effectiveKey,
                model: copilotModel === 'gemini-pro' ? 'gemini-pro' : 'gpt-4o'
            });
        } else {
            // Web Mode: Real Mistral API streaming
            if (!effectiveKey) {
                setTimeout(() => {
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: 'assistant',
                            content: 'Pre aktiváciu Copilota vlož svoj Mistral API kľúč v nastaveniach Copilota (ikona ⚙️ hore). Kľúč je uložený výhradne lokálne vo vašom prehliadači.'
                        }
                    ]);
                    setIsLoading(false);
                }, 300);
                return;
            }

            try {
                const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
                setMessages((prev) => [...prev, assistantMsg]);

                const stream = await generateCompletion(
                    historyWithContext,
                    effectiveKey,
                    copilotModel || 'mistral-large-latest'
                );

                if (stream) {
                    const reader = stream.getReader();
                    await readStream(reader, (chunk: string) => {
                        setMessages((prev) => {
                            const newMsgs = [...prev];
                            const lastMsg = newMsgs[newMsgs.length - 1];
                            if (lastMsg && lastMsg.role === 'assistant') {
                                newMsgs[newMsgs.length - 1] = {
                                    ...lastMsg,
                                    content: lastMsg.content + chunk
                                };
                            }
                            return newMsgs;
                        });
                    });
                }
            } catch (err: any) {
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: `[MISTRAL CHYBA]: ${err.message || 'Nepodarilo sa pripojiť k Mistral AI API.'}` }
                ]);
            } finally {
                setIsLoading(false);
            }
        }

    }, [mistralApiKey, openaiApiKey, copilotModel, messages, tabs, activeTabId]);

    const clearChat = useCallback(() => {
        setMessages([{ role: 'assistant', content: 'Pamäť vymazaná. Copilot s Mistral AI je pripravený.' }]);
    }, []);

    const summarizePage = useCallback(async () => {
        sendMessage("Urob mi stručný a prehľadný súhrn tejto stránky. Zameraj sa na kľúčové informácie.");
    }, [sendMessage]);

    return {
        messages,
        sendMessage,
        summarizePage,
        isLoading,
        clearChat
    };
}
