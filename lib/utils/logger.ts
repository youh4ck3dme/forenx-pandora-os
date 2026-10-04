type LogLevel = "info" | "warn" | "error" | "debug"

interface LogEntry {
  level: LogLevel
  message: string
  data?: unknown
  timestamp: string
}

class Logger {
  private isDev = process.env.NODE_ENV === "development"
  private logs: LogEntry[] = []
  private maxLogs = 100

  private log(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    }

    // Store in memory (for debugging)
    this.logs.unshift(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs.pop()
    }

    // Console output
    const prefix = `[PΛND0RΛ] [${level.toUpperCase()}]`

    switch (level) {
      case "info":
        if (this.isDev) console.log(prefix, message, data ?? "")
        break
      case "warn":
        console.warn(prefix, message, data ?? "")
        break
      case "error":
        console.error(prefix, message, data ?? "")
        // Future: send to Sentry/LogRocket
        break
      case "debug":
        if (this.isDev) console.debug(prefix, message, data ?? "")
        break
    }
  }

  info(message: string, data?: unknown) {
    this.log("info", message, data)
  }

  warn(message: string, data?: unknown) {
    this.log("warn", message, data)
  }

  error(message: string, error?: unknown) {
    this.log("error", message, error)
  }

  debug(message: string, data?: unknown) {
    this.log("debug", message, data)
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  clearLogs() {
    this.logs = []
  }
}

export const logger = new Logger()
