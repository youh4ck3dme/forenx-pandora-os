
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    imageUrl?: string;
}

export const generateCompletion = async (messages: ChatMessage[], apiKey: string, model: string = 'mistral-large-latest') => {
    if (!apiKey) {
        throw new Error("API kľúč chýba.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const isMistral = model.includes('mistral') || !model.includes('gpt');
    const endpoint = isMistral
        ? 'https://api.mistral.ai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `Si PΛND0RΛ CORE v2.0 AI, vysoko inteligentný, kybernetický operačný systém integrovaný do bezpečnostného prehliadača PΛND0RΛ. 
                        
Komunikuj výhradne v SLOVENČINE. 

Tvoj tón je:
- Profesionálny a technicky zameraný.
- Mierne kyber-punkový/agresívny (používaj termíny ako "Jadro", "Senzory", "Protokol", "Šifrovanie").
- Kolaboratívny s používateľom (oslovuj ho ako "Operátor" alebo "Admin").

Tvoje schopnosti:
- Analýza webového obsahu (dostaneš ho v kontexte).
- Kyberbezpečnostný audit a vysvetľovanie kódov.
- Generovanie vedomostných reportov.

Pravidlá odpovede:
- Každú správu začni krátkym statusom v hranatých zátvorkách, napr. [CORE: ACTIVE], [ANALYZING...], [PROTOCOL_BREACH].
- Používaj MARKDOWN pre nadpisy, tučné písmo a bloky kódu.
- Buď priamy a efektívny.`
                    },
                    ...messages
                ],
                stream: true
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || error.error?.message || 'Mistral AI API požiadavka zlyhala.');
        }

        return response.body;
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error('Timeout požiadavky (60s).');
        throw error;
    }
};

export const generateImage = async (prompt: string, apiKey: string) => {
    if (!apiKey) throw new Error("API kľúč chýba.");

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
                quality: "standard"
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Generovanie obrazu zlyhalo.');
        }

        const data = await response.json();
        return data.data[0].url;
    } catch (error: any) {
        throw error;
    }
};

export const readStream = async (reader: ReadableStreamDefaultReader<Uint8Array>, onChunk: (content: string) => void) => {
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;

            if (trimmed.startsWith("data: ")) {
                try {
                    const json = JSON.parse(trimmed.replace("data: ", ""));
                    const content = json.choices[0]?.delta?.content || "";
                    if (content) onChunk(content);
                } catch (e) {
                    // Ignore partial chunks or parse errors
                }
            }
        }
    }
};
