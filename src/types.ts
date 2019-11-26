import _ from 'lodash';
import {Ydb} from "../proto/bundle";
import 'reflect-metadata';

import Type = Ydb.Type;
import IType = Ydb.IType;
import IStructMember = Ydb.IStructMember;
import IValue = Ydb.IValue;
import IColumn = Ydb.IColumn;
import ITypedValue = Ydb.ITypedValue;
import IResultSet = Ydb.IResultSet;


export const typeMetadataKey = Symbol('type');

export function declareType(type: IType) {
    return Reflect.metadata(typeMetadataKey, type);
}

const primitiveTypeToValue: Record<number, string> = {
    [Type.PrimitiveTypeId.BOOL]: 'boolValue',
    [Type.PrimitiveTypeId.INT8]: 'int32Value',
    [Type.PrimitiveTypeId.UINT8]: 'uint32Value',
    [Type.PrimitiveTypeId.INT16]: 'int32Value',
    [Type.PrimitiveTypeId.UINT16]: 'uint32Value',
    [Type.PrimitiveTypeId.INT32]: 'int32Value',
    [Type.PrimitiveTypeId.UINT32]: 'uint32Value',
    [Type.PrimitiveTypeId.INT64]: 'int64Value',
    [Type.PrimitiveTypeId.UINT64]: 'uint64Value',
    [Type.PrimitiveTypeId.FLOAT]: 'floatValue',
    [Type.PrimitiveTypeId.DOUBLE]: 'doubleValue',
    [Type.PrimitiveTypeId.STRING]: 'bytesValue',
    [Type.PrimitiveTypeId.UTF8]: 'textValue',
    [Type.PrimitiveTypeId.YSON]: 'bytesValue',
    [Type.PrimitiveTypeId.JSON]: 'textValue',
    [Type.PrimitiveTypeId.UUID]: 'textValue',

    [Type.PrimitiveTypeId.DATE]: 'uint32Value',
    [Type.PrimitiveTypeId.DATETIME]: 'uint32Value',
    [Type.PrimitiveTypeId.TIMESTAMP]: 'uint64Value',
    [Type.PrimitiveTypeId.INTERVAL]: 'uint64Value',
    [Type.PrimitiveTypeId.TZ_DATE]: 'uint32Value',
    [Type.PrimitiveTypeId.TZ_DATETIME]: 'uint32Value',
    [Type.PrimitiveTypeId.TZ_TIMESTAMP]: 'uint64Value',
};

const valueToNativeConverters: Record<string, (input: string) => any> = {
    'boolValue': (input) => Boolean(input),
    'int32Value': (input) => Number(input),
    'uint32Value': (input) => Number(input),
    'int64Value': (input) => Number(input),
    'uint64Value': (input) => Number(input),
    'floatValue': (input) => Number(input),
    'doubleValue': (input) => Number(input),
    'bytesValue': (input) => input,
    'textValue': (input) => input,
};
function convertPrimitiveValueToNative(value: IValue) {
    let label, input;
    for ([label, input] of Object.entries(value)) {
        if (label !== 'items' && label !== 'pairs') {
            break;
        }
    }
    if (!label) {
        throw new Error(`Expected a primitive value, got ${value} instead!`);
    }
    return valueToNativeConverters[label](input);
}

function typeToValue(type: IType | null | undefined, value: any): IValue {
    if (!type) {
        if (value) {
            throw new Error(`Got no type while the value is ${value}`);
        } else {
            throw new Error('Both type and value are empty');
        }
    } else if (type.typeId) {
        const valueLabel = primitiveTypeToValue[type.typeId];
        if (valueLabel) {
            return {[valueLabel]: value};
        } else {
            throw new Error(`Unknown PrimitiveTypeId: ${type.typeId}`);
        }
    } else if (type.decimalType) {
        throw new Error('DecimalType is not implemented yet!')
    } else if (type.optionalType) {
        const innerType = type.optionalType.item;
        if (value) {
            return typeToValue(innerType, value);
        } else {
            return {
                nestedValue: value
            };
        }
    } else if (type.listType) {
        const listType = type.listType;
        return {
            items: _.map(value, (item) => typeToValue(listType.item, item))
        };
    } else if (type.tupleType) {
        const elements = type.tupleType.elements as IType[];
        return {
            items: _.map(value, (item, index: number) => typeToValue(elements[index], item))
        };
    } else if (type.structType) {
        const members = type.structType.members as IStructMember[];
        return {
            items: _.map(value, (item, index: number) => {
                const type = members[index].type;
                return typeToValue(type, item);
            })
        };
    } else if (type.dictType) {
        const keyType = type.dictType.key as IType;
        const payloadType = type.dictType.payload as IType;
        return {
            pairs: _.map(_.entries(value), ([key, value]) => ({
                key: typeToValue(keyType, key),
                payload: typeToValue(payloadType, value)
            }))
        }
    } else if (type.variantType) {
        throw new Error('VariantType is not implemented yet!');
    } else {
        throw new Error(`Unknown type ${type}`);
    }
}

function camelToSnake(propertyName: string): string {
    const reBoundary = /^([a-z]+)([A-Z])(.*)$/;
    let processed = '';
    let unProcessed = propertyName;
    while (unProcessed > '') {
        const match = reBoundary.exec(unProcessed);
        if (match) {
            processed += match[1] + '_' + match[2].toLowerCase();
            unProcessed = match[3];
        } else {
            processed += unProcessed;
            unProcessed = '';
        }
    }
    return processed;
}

function snakeToCamel(propertyName?: string|null): string {
    if (!propertyName) {
        return '';
    }
    const parts = _.filter(propertyName.split('_'), Boolean);
    return _.map(parts, (part, index) => {
        return index > 0 ? part[0].toUpperCase() + part.slice(1) : part;
    }).join('');
}

export class TypedData {
    [property: string]: any;

    constructor(data: Record<string, any>) {
        _.assign(this, data);
    }


    getType(propertyKey: string): IType {
        const typeMeta = Reflect.getMetadata(typeMetadataKey, this, propertyKey);
        if (!typeMeta) {
            throw new Error(`Property ${propertyKey} should be decorated with @declareType!`);
        }
        return typeMeta;
    }

    getValue(propertyKey: string, value: any): IValue {
        const type = this.getType(propertyKey);
        return typeToValue(type, value);
    }

    getTypedValue(propertyKey: string, value: any): ITypedValue {
        return {
            type: this.getType(propertyKey),
            value: this.getValue(propertyKey, value)
        };
    }

    get typedProperties(): string[] {
        return _.filter(Reflect.ownKeys(this), (key) => (
            typeof key === 'string' && Reflect.hasMetadata(typeMetadataKey, this, key)
        )) as string[];
    }

    getRowType() {
        return {
            structType: {
                members: _.map(this.typedProperties, (propertyKey) => ({
                    name: camelToSnake(propertyKey),
                    type: this.getType(propertyKey)
                }))
            }
        };
    }

    getRowValue() {
        return {
            items: _.map(this.typedProperties, (propertyKey: string) => {
                return this.getValue(propertyKey, this[propertyKey])
            })
        }
    }

    static createNativeObjects(resultSet: IResultSet): TypedData[] {
        const {rows, columns} = resultSet;
        if (!columns) {
            return [];
        }
        return _.map(rows, (row) => {
            const obj = _.reduce(row.items, (acc: Record<string, any>, value, index) => {
                const column = columns[index] as IColumn;
                acc[snakeToCamel(column.name)] = convertPrimitiveValueToNative(value);
                return acc;
            }, {});
            return new this(obj);
        })
    }

    static asTypedCollection(collection: TypedData[]) {
        return {
            type: {
                listType: {
                    item: collection[0].getRowType()
                }
            },
            value: {
                items: collection.map((item) => item.getRowValue())
            }
        }
    }
}