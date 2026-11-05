declare module 'pako' {
  export function inflate(data: Uint8Array, opts?: { raw?: boolean }): Uint8Array
}
