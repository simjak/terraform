export enum ThalloRegion {
    EU_WEST_1 = 'eu-west-1',
    US_EAST_1 = 'us-east-1',
}

export interface ThalloAccountRegistryConfig {
    management: string
    workloads: {
        secaudit: {
            exchange: string
            bridge: string
        }
        demo: {
            exchange: string
            bridge?: string
        }
        development: {
            exchange: string
            bridge: string
        }
        staging: {
            exchange: string
            bridge: string
        }
        production: {
            exchange: string
            bridge: string
        }
    }
    infrastructure: {
        sharedServices: string
    }
    aft: {
        aftManagement: string
    }
    security: {
        audit: string
        logArchive: string
    }
}

export const ThalloAccountRegistry: ThalloAccountRegistryConfig = {
    management: '000000000000',
    workloads: {
        secaudit: {
            exchange: '000000000000',
            bridge: '000000000000',
        },
        demo: {
            exchange: '000000000000',
        },
        development: {
            exchange: '000000000000',
            bridge: '000000000000',
        },
        staging: {
            exchange: '000000000000',
            bridge: '000000000000',
        },
        production: {
            exchange: '000000000000',
            bridge: '000000000000',
        },
    },
    infrastructure: {
        sharedServices: '000000000000',
    },
    aft: {
        aftManagement: '000000000000',
    },
    security: {
        audit: '000000000000',
        logArchive: '000000000000',
    },
}
