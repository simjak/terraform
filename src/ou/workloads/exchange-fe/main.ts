import { ExchangeFrontendStack } from './ExchangeFrontendStack'
import { App } from 'cdktf'

const app = new App()
new ExchangeFrontendStack(app, 'exchange-frontend')
app.synth()
