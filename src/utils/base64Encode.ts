import * as fs from 'fs'
import { CliHelper } from './CliHelper'

const encode = (str: string) => Buffer.from(str).toString('base64')
const decode = (str: string) => Buffer.from(str, 'base64').toString('ascii')

function base64Encode(plainText: string, encodeMode: string): string {

    if (encodeMode === 'encode') {
        return encode(plainText)
    } else if (encodeMode === 'decode') {
        return decode(plainText)
    } else {
        throw new Error(`Unknown encode mode ${encodeMode}`)
    }

}

let plainText = CliHelper.getArgValue('plainText')
const plainTextFile = CliHelper.getArgValue('file')
let encodeMode = CliHelper.getArgValue('encodeMode')

if (encodeMode === '') {
    encodeMode = 'encode'
}

if (encodeMode !== 'encode' && encodeMode !== 'decode') {
    throw new Error('encodeMode must either be encode or decode. Omit to default to encode.')
}

if (plainText !== '' && plainTextFile !== '') {
    throw new Error('You cannot specify both plainText and file params')
}

if (plainText === '' && plainTextFile === '') {
    throw new Error('Please specify either plainText or file param')
}

if (plainTextFile !== '') {
    // read from from file
    plainText = fs.readFileSync(plainTextFile, 'binary')
}

const base64Result = base64Encode(plainText, encodeMode)
// eslint-disable-next-line no-console
console.log(`Result:`)
// eslint-disable-next-line no-console
console.log(base64Result)