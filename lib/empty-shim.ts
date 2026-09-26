// Empty shim for node modules in browser / client builds
export const readdir = async () => [];
export const stat = async () => ({ size: 0, mtime: new Date() });
export const readFile = async () => "";
export const writeFile = async () => {};
export const basename = (p: string) => p.split(/[\\/]/).pop() || "";
export const extname = (p: string) => {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx) : "";
};
export const resolve = (...args: string[]) => args.join("/");
export const relative = (from: string, to: string) => to;
export const isAbsolute = (p: string) => p.startsWith("/") || /^[a-zA-Z]:/.test(p);
export const sep = "/";

export default {
  readdir,
  stat,
  readFile,
  writeFile,
  basename,
  extname,
  resolve,
  relative,
  isAbsolute,
  sep,
};
