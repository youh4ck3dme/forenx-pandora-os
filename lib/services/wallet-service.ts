import { ethers } from 'ethers'

// Public RPC endpoints
const ETHEREUM_RPC = 'https://eth.llamarpc.com'
const POLYGON_RPC = 'https://polygon-rpc.com'

export interface WalletBalance {
  address: string
  eth: string
  matic: string
  ethUsd: string
  maticUsd: string
  totalUsd: string
  lastUpdated: number
}

export interface TokenPrice {
  eth: number
  matic: number
}

export interface Transaction {
  id: string
  type: 'send' | 'receive' | 'swap' | 'nft'
  asset: string
  amount: string
  from: string
  to: string
  timestamp: number
  status: 'confirmed' | 'pending' | 'failed'
  network: 'ethereum' | 'polygon'
  hash: string
}

// Simple price cache (in production, use a proper caching mechanism)
let priceCache: TokenPrice = { eth: 0, matic: 0 }
let priceCacheTime = 0
const PRICE_CACHE_DURATION = 60000 // 1 minute

export class WalletService {
  private ethProvider: ethers.JsonRpcProvider
  private polygonProvider: ethers.JsonRpcProvider

  constructor() {
    this.ethProvider = new ethers.JsonRpcProvider(ETHEREUM_RPC)
    this.polygonProvider = new ethers.JsonRpcProvider(POLYGON_RPC)
  }

  public isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address)
    } catch {
      return false
    }
  }

  public shortenAddress(address: string): string {
    if (!address || address.length < 10) return address
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  public async getBalances(address: string): Promise<WalletBalance | null> {
    if (!this.isValidAddress(address)) {
      console.warn('[WalletService] Invalid address:', address)
      return null
    }

    try {
      // Fetch balances in parallel
      const [ethBalance, maticBalance, prices] = await Promise.all([
        this.ethProvider.getBalance(address),
        this.polygonProvider.getBalance(address),
        this.getPrices()
      ])

      const ethValue = parseFloat(ethers.formatEther(ethBalance))
      const maticValue = parseFloat(ethers.formatEther(maticBalance))

      const ethUsd = ethValue * prices.eth
      const maticUsd = maticValue * prices.matic
      const totalUsd = ethUsd + maticUsd

      return {
        address,
        eth: ethValue.toFixed(6),
        matic: maticValue.toFixed(4),
        ethUsd: `$${ethUsd.toFixed(2)}`,
        maticUsd: `$${maticUsd.toFixed(2)}`,
        totalUsd: `$${totalUsd.toFixed(2)}`,
        lastUpdated: Date.now()
      }
    } catch (error) {
      console.error('[WalletService] Error fetching balances:', error)
      return null
    }
  }

  private async getPrices(): Promise<TokenPrice> {
    // Check cache
    if (Date.now() - priceCacheTime < PRICE_CACHE_DURATION && priceCache.eth > 0) {
      return priceCache
    }

    try {
      // Use CoinGecko simple price API (free, no key required)
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,matic-network&vs_currencies=usd'
      )

      if (!response.ok) {
        throw new Error('Price fetch failed')
      }

      const data = await response.json()
      priceCache = {
        eth: data.ethereum?.usd || 2500, // Fallback price
        matic: data['matic-network']?.usd || 0.5 // Fallback price
      }
      priceCacheTime = Date.now()

      return priceCache
    } catch (error) {
      console.warn('[WalletService] Using fallback prices:', error)
      // Return fallback prices if API fails
      return priceCache.eth > 0 ? priceCache : { eth: 2500, matic: 0.5 }
    }
  }

  public async refreshBalance(address: string): Promise<WalletBalance | null> {
    return this.getBalances(address)
  }

  public async getTransactions(address: string): Promise<Transaction[]> {
    if (!this.isValidAddress(address)) return []

    // For simulation, we generate deterministic transactions based on address
    const seed = address.toLowerCase()
    const txs: Transaction[] = []
    const networks: ('ethereum' | 'polygon')[] = ['ethereum', 'polygon']
    const types: ('send' | 'receive' | 'swap' | 'nft')[] = ['send', 'receive', 'swap', 'nft']
    const assets = ['ETH', 'MATIC', 'USDC', 'WETH', 'LINK']

    for (let i = 0; i < 12; i++) {
        const network = networks[i % 2]
        const type = types[(seed.charCodeAt(i % 10) + i) % types.length]
        const amount = ((seed.charCodeAt(i % 5) * (i + 1)) / 100).toFixed(4)
        const timestamp = Date.now() - (i * 3600000 * 24) - (seed.charCodeAt(i % 8) * 60000)

        txs.push({
            id: `tx-${i}-${seed.slice(2, 8)}`,
            type,
            asset: assets[i % assets.length],
            amount,
            from: type === 'receive' ? '0x' + seed.slice(-10).padStart(40, 'a') : address,
            to: type === 'send' ? '0x' + seed.slice(2, 12).padStart(40, 'b') : address,
            timestamp,
            status: i === 0 ? 'confirmed' : 'confirmed', // keep it simple
            network,
            hash: '0x' + (i * 12345678).toString(16).padEnd(64, 'f')
        })
    }

    return txs
  }
}

// Singleton instance
export const walletService = new WalletService()
