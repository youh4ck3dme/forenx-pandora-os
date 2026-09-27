export type Rgba = {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
};

export type ContrastResult = {
  readonly ratio: number;
  readonly formattedRatio: string;
  readonly passesNormalAa: boolean;
  readonly passesLargeAa: boolean;
  readonly passesAaAaa: boolean;
};

function parseHexByte(value: string): number {
  const parsed = Number.parseInt(value, 16);
  if (Number.isNaN(parsed)) {
    throw new Error(`Neplatný hexadecimálny kanál farby: ${value}`);
  }
  return parsed;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function expandedHexChannel(source: string, index: number): number {
  const digit = source.charAt(index);
  if (!/^[\da-f]$/.test(digit)) {
    throw new Error(`Neplatný hexadecimálny kanál farby: ${source}`);
  }
  return parseHexByte(digit.repeat(2));
}

function parseRgbChannel(value: string, color: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Neplatný RGB kanál farby: ${color}`);
  }
  return clamp(parsed, 0, 255);
}

export function parseRgba(value: string): Rgba {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/);
  if (hex?.[1]) {
    const source = hex[1];
    if (source.length === 3 || source.length === 4) {
      return {
        red: expandedHexChannel(source, 0),
        green: expandedHexChannel(source, 1),
        blue: expandedHexChannel(source, 2),
        alpha: source.length === 4 ? expandedHexChannel(source, 3) / 255 : 1,
      };
    }
    return {
      red: parseHexByte(source.slice(0, 2)),
      green: parseHexByte(source.slice(2, 4)),
      blue: parseHexByte(source.slice(4, 6)),
      alpha: source.length === 8 ? parseHexByte(source.slice(6, 8)) / 255 : 1,
    };
  }

  const rgb = normalized.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/,
  );
  if (!rgb?.[1] || !rgb[2] || !rgb[3]) {
    throw new Error(`Nepodporovaný formát farby: ${value}`);
  }
  const alpha = rgb[4] === undefined ? 1 : Number.parseFloat(rgb[4]);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Neplatná alpha hodnota farby: ${value}`);
  }
  return {
    red: parseRgbChannel(rgb[1], value),
    green: parseRgbChannel(rgb[2], value),
    blue: parseRgbChannel(rgb[3], value),
    alpha,
  };
}

export function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function linearChannel(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  );
}

export function evaluateContrast(
  foreground: string,
  background: string,
  backgroundBase = "#000000",
): ContrastResult {
  const base = parseRgba(backgroundBase);
  const resolvedBackground = composite(parseRgba(background), base);
  const resolvedForeground = composite(parseRgba(foreground), resolvedBackground);
  const foregroundLuminance = relativeLuminance(resolvedForeground);
  const backgroundLuminance = relativeLuminance(resolvedBackground);
  const ratio =
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

  return {
    ratio,
    formattedRatio: `${ratio.toFixed(2)}:1`,
    passesNormalAa: ratio >= 4.5,
    passesLargeAa: ratio >= 3,
    passesAaAaa: ratio >= 7,
  };
}
