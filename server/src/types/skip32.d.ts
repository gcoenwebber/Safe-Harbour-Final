declare module 'skip32' {
    class Skip32 {
        constructor(key: Buffer);
        encrypt(input: number): number;
        decrypt(input: number): number;
    }
    export = Skip32;
}
