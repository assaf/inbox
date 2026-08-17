declare module "http_ece" {
  import type { ECDH } from "node:crypto";

  export interface DecryptOptions {
    version?: "aes128gcm" | "aesgcm";
    privateKey: ECDH;
    authSecret?: string;
  }

  export function decrypt(buffer: Buffer, options: DecryptOptions): Buffer;
}
