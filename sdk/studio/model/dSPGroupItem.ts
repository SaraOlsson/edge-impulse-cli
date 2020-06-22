/**
 * Edge Impulse API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 1.0.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { DSPGroupItemSelectOptions } from './dSPGroupItemSelectOptions';

export class DSPGroupItem {
    'name': string;
    'value': string;
    'type': string;
    'help': string;
    'param': string;
    'selectOptions'?: Array<DSPGroupItemSelectOptions>;

    static discriminator: string | undefined = undefined;

    static attributeTypeMap: Array<{name: string, baseName: string, type: string}> = [
        {
            "name": "name",
            "baseName": "name",
            "type": "string"
        },
        {
            "name": "value",
            "baseName": "value",
            "type": "string"
        },
        {
            "name": "type",
            "baseName": "type",
            "type": "string"
        },
        {
            "name": "help",
            "baseName": "help",
            "type": "string"
        },
        {
            "name": "param",
            "baseName": "param",
            "type": "string"
        },
        {
            "name": "selectOptions",
            "baseName": "selectOptions",
            "type": "Array<DSPGroupItemSelectOptions>"
        }    ];

    static getAttributeTypeMap() {
        return DSPGroupItem.attributeTypeMap;
    }
}

