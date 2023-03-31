import {
    DeploymentMode,
    Environment,
    ThalloApplicationConfigInput,
    ThalloProduct,
    ThalloService,
} from '../../../constructs/thallo/ThalloApplicationConfig'

/** ENVIRONMENT VARIABLES needed:
 * TF_RUN_MODE: DeploymentMode
 * NODE_ENV: Environment
 * IMAGE_TAG: string
 * DOMAIN_PREFIX: string, optional
 */

const currentDeploymentMode: DeploymentMode = process.env.TF_RUN_MODE as DeploymentMode
const isLocal = currentDeploymentMode === DeploymentMode.LOCAL

const currentEnvironment: Environment = process.env.NODE_ENV as Environment
export const isProduction = currentEnvironment === Environment.PRODUCTION

export const exchangeConfigInput: ThalloApplicationConfigInput = {
    productName: ThalloProduct.EXCHANGE,
    serviceName: ThalloService.EXCHANGE_BE,
    domainPrefix: process.env.DOMAIN_PREFIX || 'market.api',
    shortName: 'exch',
    deploymentMode: currentDeploymentMode,
    environment: currentEnvironment,
    aws: {
        profile: isLocal ? process.env.AWS_PROFILE : undefined,
    },
    application: {
        imageTag: process.env.IMAGE_TAG || 'main',
        port: isProduction ? 3030 : 3003,
    },
    database: {
        name: '',
        masterUsername: '',
        port: 5432,
    },
    secretsLocation: {
        vpc: '',
        bucket: '',
        rds: '',
        deployment: '',
    },
    tags: {
        service: ThalloService.EXCHANGE_BE,
        environment: currentEnvironment,
    },
}
