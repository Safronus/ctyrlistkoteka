declare module "heic-convert" {
  type Output = "JPEG" | "PNG";
  interface Options {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: Output;
    quality?: number;
  }
  const heicConvert: (opts: Options) => Promise<ArrayBuffer>;
  export default heicConvert;
}
