"use client";

import {
  Wallet,
  Plus,
  Trash2,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Copy,
  Check,
  QrCode,
  Repeat,
  Image as ImageIcon,
  History,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useBrowserStore } from "@/lib/store";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { walletService, Transaction } from "@/lib/services";
import { QRCodeSVG } from "qrcode.react";

export function WalletPanel() {
  const {
    wallets,
    activeWallet,
    walletBalances,
    addWallet,
    removeWallet,
    setActiveWallet,
    updateWalletBalance,
  } = useBrowserStore();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Fetch balances for all wallets on mount and when wallets change
  const fetchBalances = useCallback(async () => {
    if (wallets.length === 0) return;
    setIsLoading(true);

    for (const address of wallets) {
      try {
        const balance = await walletService.getBalances(address);
        if (balance) {
          updateWalletBalance(address, {
            eth: balance.eth,
            matic: balance.matic,
            ethUsd: balance.ethUsd,
            maticUsd: balance.maticUsd,
            totalUsd: balance.totalUsd,
            lastUpdated: balance.lastUpdated,
          });
        }
      } catch (e) {
        console.error("Failed to fetch balance for", address, e);
      }
    }

    setIsLoading(false);
  }, [wallets, updateWalletBalance]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    if (activeWallet) {
        setTxLoading(true);
        walletService.getTransactions(activeWallet).then(txs => {
            setTransactions(txs);
            setTxLoading(false);
        });
    } else {
        setTransactions([]);
    }
  }, [activeWallet]);

  const handleAdd = () => {
    const address = input.trim();
    if (!address) return;

    if (!walletService.isValidAddress(address)) {
      setError("Invalid Ethereum address");
      return;
    }

    if (wallets.includes(address)) {
      setError("Wallet already added");
      return;
    }

    addWallet(address);
    setInput("");
    setError(null);
  };

  const handleCopy = async () => {
    if (!activeWallet) return;
    await navigator.clipboard.writeText(activeWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calculate total portfolio value
  const totalValue = Object.values(walletBalances).reduce((sum: number, b) => {
    const value = parseFloat(b.totalUsd.replace("$", "").replace(",", ""));
    return sum + (isNaN(value) ? 0 : value);
  }, 0);

  const activeBalance = activeWallet ? walletBalances[activeWallet] : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-auto p-3 no-scrollbar flex flex-col gap-4 font-mono"
    >
      {/* Portfolio Card */}
      <div className="bg-linear-to-br from-purple-500/10 to-blue-500/5 rounded-xl p-4 border border-purple-500/20 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-50 transition-opacity">
          <TrendingUp size={48} />
        </div>
        <div className="relative z-10">
          <p className="text-[9px] text-gray-400 uppercase tracking-[0.2em] mb-1">
            Portfolio Value
          </p>
          <h2 className="text-xl font-bold text-white mb-1">
            $
            {totalValue.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">
              {wallets.length} wallet{wallets.length !== 1 ? "s" : ""} connected
            </span>
            <button
              onClick={fetchBalances}
              disabled={isLoading}
              className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={cn(isLoading && "animate-spin")}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Active Wallet Details */}
      {activeWallet && activeBalance && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[9px] text-gray-500 font-bold uppercase tracking-[0.2em]">
              Active Wallet
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1.5 hover:bg-white/10 rounded text-gray-500 hover:text-white transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <Copy size={12} />
                )}
              </button>
              <button
                onClick={() => setShowQR(!showQR)}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  showQR
                    ? "bg-white/10 text-white"
                    : "hover:bg-white/10 text-gray-500 hover:text-white"
                )}
                title="Show QR code"
              >
                <QrCode size={12} />
              </button>
            </div>
          </div>

          <div className="bg-black/30 rounded-lg p-3 border border-white/5">
            <p className="text-[9px] text-purple-400 font-mono truncate">
              {activeWallet}
            </p>
            <p className="text-[15px] font-bold text-white mt-1">
              {activeBalance.totalUsd}
            </p>
          </div>

          {/* QR Code */}
          <AnimatePresence>
            {showQR && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex justify-center p-4 bg-white rounded-xl"
              >
                <QRCodeSVG value={activeWallet} size={160} level="H" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Balances */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded-lg p-3 border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-[8px] font-bold text-purple-400">
                  E
                </div>
                <span className="text-xs text-gray-400">Ethereum</span>
              </div>
              <p className="text-sm font-bold text-white">
                {activeBalance.eth} ETH
              </p>
              <p className="text-xs text-gray-500">{activeBalance.ethUsd}</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3 border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-[8px] font-bold text-purple-400">
                  M
                </div>
                <span className="text-xs text-gray-400">Polygon</span>
              </div>
              <p className="text-sm font-bold text-white">
                {activeBalance.matic} MATIC
              </p>
              <p className="text-xs text-gray-500">{activeBalance.maticUsd}</p>
            </div>
          </div>

          {/* Transactions History */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between px-1">
                <h3 className="text-[9px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                    <History size={10} className="text-purple-400" />
                    Transaction History
                </h3>
            </div>

            <div className="space-y-1">
                {txLoading ? (
                    <div className="py-8 flex flex-col items-center gap-2 text-gray-700">
                        <RefreshCw size={16} className="animate-spin" />
                        <span className="text-[8px] uppercase tracking-widest font-bold">Syncing ledger...</span>
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="py-8 text-center border border-dashed border-white/5 rounded-lg">
                        <p className="text-[10px] text-gray-700 italic">No transactions found</p>
                    </div>
                ) : (
                    transactions.map((tx: Transaction) => (
                        <div key={tx.id} className="bg-white/5 border border-white/5 rounded-lg p-2.5 flex items-center gap-3 group hover:border-purple-500/20 transition-all">
                            <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                tx.type === 'receive' ? "bg-green-500/10 text-green-500" :
                                tx.type === 'send' ? "bg-red-500/10 text-red-500" :
                                tx.type === 'swap' ? "bg-blue-500/10 text-blue-500" :
                                "bg-purple-500/10 text-purple-500"
                            )}>
                                {tx.type === 'receive' ? <ArrowDownLeft size={14} /> :
                                 tx.type === 'send' ? <ArrowUpRight size={14} /> :
                                 tx.type === 'swap' ? <Repeat size={14} /> :
                                 <ImageIcon size={14} />}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] font-bold text-gray-200 capitalize">{tx.type} {tx.asset}</span>
                                    <span className={cn(
                                        "text-[11px] font-bold",
                                        tx.type === 'receive' ? "text-green-400" : "text-white"
                                    )}>
                                        {tx.type === 'receive' ? '+' : '-'}{tx.amount}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[8px] text-gray-500 uppercase tracking-tighter">
                                        {new Date(tx.timestamp).toLocaleDateString()}
                                    </span>
                                    <span className={cn(
                                        "text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border",
                                        tx.network === 'ethereum' ? "text-blue-400 border-blue-400/20 bg-blue-400/5" : "text-purple-400 border-purple-400/20 bg-purple-400/5"
                                    )}>
                                        {tx.network}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
          </div>
        </div>
      )}

      {/* Wallets List */}
      <div className="space-y-2">
        <h3 className="text-[9px] text-gray-500 font-bold uppercase tracking-[0.2em] pl-1">
          Connected Wallets
        </h3>
        <div className="space-y-2">
          {wallets.length === 0 ? (
            <div className="py-4 border border-dashed border-white/10 rounded-lg text-center">
              <p className="text-[10px] text-gray-600 italic">No wallets connected</p>
            </div>
          ) : (
            wallets.map((wallet: string) => {
              const balance = walletBalances[wallet];
              const isActive = wallet === activeWallet;
              return (
                <div
                  key={wallet}
                  onClick={() => setActiveWallet(wallet)}
                  className={cn(
                    "bg-white/5 border rounded-lg p-2 flex items-center gap-2 group cursor-pointer transition-all",
                    isActive
                      ? "border-purple-500/50 bg-purple-500/5"
                      : "border-white/5 hover:bg-white/10"
                  )}
                >
                  <div
                    className={cn(
                      "p-1.5 rounded",
                      isActive
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-white/5 text-gray-400"
                    )}
                  >
                    <Wallet size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate font-mono">
                      {walletService.shortenAddress(wallet)}
                    </p>
                    {balance && (
                      <p className="text-[10px] text-gray-500">
                        {balance.totalUsd}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      removeWallet(wallet);
                    }}
                    className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded text-gray-600 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Add Wallet */}
      <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
        {error && <p className="text-xs text-red-400 px-1">{error}</p>}
        <div className="flex gap-2">
          <input
            id="wallet-address-input"
            name="walletAddress"
            type="text"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="0x..."
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder:text-gray-700 outline-none focus:border-purple-500/50 transition-colors font-mono"
            onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && handleAdd()}
          />
          <button
            onClick={handleAdd}
            className="p-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg transition-colors disabled:opacity-50"
            disabled={!input.trim()}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
