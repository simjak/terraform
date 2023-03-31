import { App } from 'cdktf'
import { ControlTowerAFStack } from './ControlTowerAFStack'

const app = new App()
new ControlTowerAFStack(app, 'thallo-ct')
app.synth()
