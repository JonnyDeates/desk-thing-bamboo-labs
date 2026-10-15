// Merged with DeskThing's default esbuild config.
// mqtt pulls in net/tls/crypto/stream/etc — must be external so Node provides them at runtime.
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
    "process",
    "assert",
    "string_decoder",
    "punycode",
  ],
};
