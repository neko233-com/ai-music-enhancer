declare module '@breezystack/lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, rate: number, bitrate: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}
