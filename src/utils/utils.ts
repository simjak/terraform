import { DataAwsSecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/data-aws-secretsmanager-secret-version'
import { Fn } from 'cdktf'
import { parseDomain, ParseResultListed, ParseResultType } from 'parse-domain'

export const getRootDomain = (inputDomain: string): string => {
    const parseResult = parseDomain(inputDomain)

    if (parseResult.type == ParseResultType.Invalid) {
        throw new Error('Invalid domain')
    }

    let { domain, topLevelDomains, subDomains } = parseResult as ParseResultListed

    // remove the first subdomain if present
    if (subDomains.length > 0) {
        subDomains.shift()
    }

    return `${subDomains.join('.')}${
        subDomains.length > 0 ? '.' : ''
    }${domain}.${topLevelDomains.join('.')}`
}

export const uid = () => {
    return 'xxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0,
            v = c == 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

export const truncateString = (str: string, num: number): string => {
    // If the length of str is less than or equal to num
    // just return str--don't truncate it.
    if (str.length <= num) {
        return str
    }
    // Return str truncated
    return str.slice(0, num)
}

export const readJSONSecretKey = (secret: DataAwsSecretsmanagerSecretVersion, key: string) => {
    const json = Fn.jsondecode(secret.secretString)
    // Fail secure: providing the default value of "undefined" will cause Fn.lookup to fail if the requested key
    // is not present in the underlying secret. Any other default value will simply be returned back to the caller.
    return Fn.lookup(json, key, undefined)
}
