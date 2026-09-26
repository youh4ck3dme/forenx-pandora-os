/**
 * Favicon Service
 * Helper to get favicon URLs from domains using various providers (Google, DuckDuckGo, etc.)
 */

export class FaviconService {
    /**
     * Get a high-quality favicon URL for a given domain/URL
     * @param url The full URL or domain
     * @param size Size in pixels (default 32)
     */
    public static getFaviconUrl(url: string, size: number = 32): string {
        try {
            if (!url || url.startsWith('pandora://') || url.startsWith('about:')) {
                return ''; // No favicon for internal pages
            }

            const parsed = new URL(url);
            const domain = parsed.hostname;

            // Don't query Google S2 favicon service for local domains (avoids 404 from t3.gstatic.com)
            if (
                domain === 'localhost' ||
                domain === '127.0.0.1' ||
                domain === '0.0.0.0' ||
                domain === '[::1]' ||
                !domain.includes('.')
            ) {
                return '';
            }

            // Primary: Google S2 Converter
            // format: https://www.google.com/s2/favicons?domain=${domain}&sz=${size}
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
        } catch (e) {
            return '';
        }
    }

    /**
     * Get a placeholder icon component or path
     */
    public static getPlaceholder(): string {
        return '/icons/globe.svg';
    }
}
