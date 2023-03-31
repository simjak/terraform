import { ExchangeSnsStack } from './components/ExchangeSnsStack'
import { ExchangeInitialsSecretStack } from './components/ExchangeInitialSecretStack'
import { App } from 'cdktf'
import { ExchangeVpcStack } from './components/ExchangeVpcStack'
import { ExchangeBastionStack } from './components/ExchangeBastionStack'
import { ExchangeBucketStack } from './components/ExchangeBucketStack'
import { ExchangeRdsStack } from './components/ExchangeRdsStack'
import { ExchangeApplicationStack } from './ExchangeApplicationStack'

const app = new App()

/*
 * Components
 */
new ExchangeInitialsSecretStack(app, 'exchange-initial-secret') //NOTE: run manually before first deployment and after update values in deployment secret
new ExchangeVpcStack(app, 'exchange-vpc')

// Stacks can be run in parallel
// cdktf deploy exchange-bastion exchange-sns exchange-bucket exchange-rds --auto-approve
new ExchangeBastionStack(app, 'exchange-bastion')
new ExchangeSnsStack(app, 'exchange-sns')
new ExchangeBucketStack(app, 'exchange-bucket')

// RDS stacks
new ExchangeRdsStack(app, 'exchange-rds') 

// Application stack
new ExchangeApplicationStack(app, 'exchange-ecs') //NOTE: initial manual step: update secret values
app.synth()

// SES setup. Manual step , request production per workload account, create configuration set Sent_from_Thallo_platform