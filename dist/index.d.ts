import FlatQueue from 'flatqueue';
declare type AnyArray = Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array | Float32Array | Float64Array;
declare type AnyArrayConstructor = Int8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor;
declare type FilterFn = (index: number) => boolean;
export default class Flatbush {
    nodeSize: number;
    numItems: number;
    data: ArrayBuffer;
    pos: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    queue: FlatQueue<number>;
    readonly boxes: AnyArray;
    readonly indices: AnyArray;
    readonly ArrayType: AnyArrayConstructor;
    readonly IndexArrayType: AnyArrayConstructor;
    readonly levelBounds: number[];
    static from(data: ArrayBuffer): Flatbush;
    constructor(numItems: number, nodeSize?: number, ArrayType?: AnyArrayConstructor, data?: ArrayBuffer);
    add(minX: number, minY: number, maxX: number, maxY: number): number;
    finish(): void;
    search(minX: number, minY: number, maxX: number, maxY: number, filterFn?: FilterFn): number[];
    neighbors(x: number, y: number, maxResults?: number, maxDistance?: number, filterFn?: FilterFn): number[];
}
export {};
