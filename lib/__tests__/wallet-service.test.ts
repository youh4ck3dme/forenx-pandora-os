import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletService } from '../services/wallet-service'
import { ethers } from 'ethers'

// Mock ethers
vi.mock('ethers', () => {
  return {
    ethers: {
      JsonRpcProvider: vi.fn(function() {
        return {
          getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000'))
        }
      }),
      isAddress: vi.fn((addr: string) => addr.startsWith('0x') && addr.length === 42),
      formatEther: vi.fn((val: bigint) => (Number(val) / 1e18).toString())
    }
  }
})

describe('WalletService', () => {
    let service: WalletService

    beforeEach(async () => {
        vi.resetModules()
        vi.clearAllMocks()
        global.fetch = vi.fn()
        const { WalletService: WS } = await import('../services/wallet-service')
        service = new WS()
    })

    describe('isValidAddress', () => {
        it('should validate correct eth addresses', () => {
            expect(service.isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true)
        })

        it('should reject invalid addresses', () => {
            expect(service.isValidAddress('invalid')).toBe(false)
            expect(service.isValidAddress('0x123')).toBe(false)
        })
    })

    describe('shortenAddress', () => {
        it('should shorten address correctly', () => {
            const addr = '0x1234567890123456789012345678901234567890'
            expect(service.shortenAddress(addr)).toBe('0x1234...7890')
        })
    })

    describe('getBalances', () => {
        it('should return null for invalid address', async () => {
            const result = await service.getBalances('bad')
            expect(result).toBeNull()
        })

        it('should fetch balance and prices correctly', async () => {
            const mockAddress = '0x1234567890123456789012345678901234567890'

            // Mock price API
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: async () => ({
                    ethereum: { usd: 2000 },
                    'matic-network': { usd: 1 }
                })
            } as any)

            const result = await service.getBalances(mockAddress)

            expect(result).not.toBeNull()
            expect(result?.eth).toBe('1.000000')
            expect(result?.totalUsd).toBe('$2001.00')
        })

        it('should handle API failure with fallbacks', async () => {
             const mockAddress = '0x1234567890123456789012345678901234567891'
             vi.mocked(fetch).mockRejectedValue(new Error('API Down'))

             const result = await service.getBalances(mockAddress)
             expect(result).not.toBeNull()
             // Fallback ETH price is 2500, Matic is 0.5
             expect(result?.totalUsd).toBe('$2500.50')
        })
    })

    describe('getTransactions', () => {
        it('should return deterministic transactions for an address', async () => {
            const mockAddress = '0x1234567890123456789012345678901234567890'
            const txs = await service.getTransactions(mockAddress)

            expect(txs.length).toBeGreaterThan(0)
            expect(txs[0]).toHaveProperty('id')
            expect(txs[0]).toHaveProperty('type')
            expect(txs[0]).toHaveProperty('amount')
            expect(txs[0].timestamp).toBeLessThan(Date.now())

            // Verify deterministic nature - call again, should be same
            const txs2 = await service.getTransactions(mockAddress)
            expect(txs2[0].id).toBe(txs[0].id)
        })
    })
})
