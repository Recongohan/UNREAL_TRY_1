// Binary files (.glb models, .hdr probes) as URLs a loader can open.
//
// On a normal server the file is used as it is. The claude.ai Artifact host only
// serves standard web types, so tools/artifact.mjs ships each binary as
// <name>.json holding its bytes in base64, and sets window.__packed; here those
// are turned back into blob: URLs.

const cache = new Map();

export function binaryUrl(path) {
  if (!window.__packed) return Promise.resolve(path);
  if (!cache.has(path)) {
    cache.set(path, (async () => {
      const { b64, type } = await (await fetch(path + '.json')).json();
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    })());
  }
  return cache.get(path);
}
