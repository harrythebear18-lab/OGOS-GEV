declare module 'pngjs' {
  export class PNG {
    static sync: {
      read(buf: Buffer): { width: number; height: number; data: Buffer }
    }
  }
}
