// fflate 0.8.2 UMD 构建的最小类型声明（只声明本项目用到的部分）
export declare function zipSync(
  files: Record<string, Uint8Array>,
  opts?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; mem?: number },
): Uint8Array
export declare function unzipSync(files: Uint8Array, opts?: Record<string, unknown>): Record<string, Uint8Array>
export declare function strToU8(str: string, latin1?: boolean): Uint8Array
export declare function strFromU8(bytes: Uint8Array, latin1?: boolean): string
