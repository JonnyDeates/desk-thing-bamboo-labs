// Merged with DeskThing's default esbuild config.
// mqtt pulls in net/tls/crypto/stream/etc — must be external so Node provides them at runtime.
// NOTE: do NOT externalize "process" — readable-stream's shim does require("process/") which
// Node can't resolve at runtime; the "process" npm package is bundled so esbuild inlines it.
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
    "string_decoder",
    "punycode",
  ],
};
