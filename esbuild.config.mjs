// Merged with DeskThing's default esbuild config.
// mqtt pulls in net/tls/crypto/stream/etc — must be external so Node provides them at runtime.
// NOTE: do NOT externalize "process" or "string_decoder" — readable-stream's shims do
// require("process/") and require("string_decoder/") (trailing slash points to the npm
// polyfill packages, not Node builtins). Those npm packages are installed and bundled so
// esbuild inlines them; externalizing would make Node fail to resolve the slashed names.
export default {
  external: [
    "net",
    "tls",
    "url",
    "events",
    "stream",
    "crypto",
    "http",
    "https",
    "buffer",
    "util",
    "querystring",
    "os",
    "zlib",
    "dns",
    "assert",
    "punycode",
  ],
};
