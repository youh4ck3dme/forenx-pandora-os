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
            const normalized = (url || "").trim();
            if (
                !normalized ||
                normalized === "newtab" ||
                normalized.startsWith("pandora://") ||
                normalized.startsWith("about:") ||
                normalized.startsWith("chrome://") ||
                normalized.startsWith("edge://")
            ) {
                return ""; // No favicon for internal or special pages
            }

            let parsed: URL;
            try {
                parsed = new URL(normalized);
            } catch {
                return "";
            }

            // Only http and https protocols are eligible for external favicon resolution
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return "";
            }

            const domain = parsed.hostname.toLowerCase();

            // Don't query external favicon service for local domains or IP addresses
            const isIp =
                /^(\d{1,3}\.){3}\d{1,3}$/.test(domain) ||
                domain.includes(":") ||
                domain.endsWith(".local") ||
                domain.endsWith(".internal");

            if (
                domain === "localhost" ||
                domain === "127.0.0.1" ||
                domain === "0.0.0.0" ||
                domain === "[::1]" ||
                !domain.includes(".") ||
                isIp
            ) {
                return "";
            }

            // Primary: Google S2 Converter
            return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
        } catch {
            return "";
        }
    }

    /**
     * Get a placeholder icon component or path
     */
    public static getPlaceholder(): string {
        return '/icons/globe.svg';
    }
}
